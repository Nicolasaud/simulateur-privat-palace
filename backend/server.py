"""
Backend Python qui mime les Netlify Functions du Simulateur Palace Comedy.
- Stockage : MongoDB (collection 'blobs' clé/valeur, équivalent Netlify Blobs)
- Auth     : cookie de session HTTP-only signé (HMAC SHA-256)
- Endpoints: /api/auth, /api/me, /api/logout
             /api/params, /api/bdd-items, /api/formules, /api/formules-v2,
             /api/types-internes, /api/paliers
             /api/fiches, /api/fiches/{id}
             /api/crm, /api/crm/{id}
"""
import os
import json
import hmac
import hashlib
import base64
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from pathlib import Path

from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Cookie
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# === Config ===
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
ACCESS_CODE = os.environ.get('ACCESS_CODE', 'PALACE2026')
SESSION_SECRET = os.environ.get('SESSION_SECRET', 'dev-secret-not-for-prod-please-change')
COOKIE_NAME = 'palace_session'
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 jours

# === Mongo ===
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
blobs = db.palace_blobs  # une seule collection, clé sémantique

# === FastAPI ===
app = FastAPI(title="Palace Comedy Simulateur — Preview Backend")
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("palace")


# ============================================================
#  Helpers : session signée
# ============================================================
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode('ascii').rstrip('=')


def _ub64(s: str) -> bytes:
    pad = '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_session(payload: dict) -> str:
    """Sérialise + HMAC SHA-256."""
    body = _b64(json.dumps(payload, separators=(',', ':')).encode())
    sig = _b64(hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_session(token: str) -> Optional[dict]:
    if not token or '.' not in token:
        return None
    body, sig = token.split('.', 1)
    expected = _b64(hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        return json.loads(_ub64(body).decode())
    except Exception:
        return None


def require_session(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    s = verify_session(token) if token else None
    if not s or 'nom' not in s:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return s


# ============================================================
#  Helpers : blob store (clé sémantique → JSON dans Mongo)
# ============================================================
async def blob_get(key: str, fallback: Any = None):
    doc = await blobs.find_one({"_id": key})
    return doc['value'] if doc and 'value' in doc else fallback


async def blob_set(key: str, value: Any):
    await blobs.update_one({"_id": key}, {"$set": {"value": value}}, upsert=True)


async def blob_delete(key: str):
    await blobs.delete_one({"_id": key})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================
#  AUTH
# ============================================================
@api.post("/auth")
async def auth_login(request: Request, response: Response):
    body = await request.json()
    code = (body.get('code') or '').strip()
    nom = (body.get('nom') or '').strip()
    nom_autre = (body.get('nomAutre') or '').strip()

    if code != ACCESS_CODE:
        raise HTTPException(status_code=401, detail="invalid_code")
    final_nom = nom_autre if nom == 'Autre' else nom
    if not final_nom:
        raise HTTPException(status_code=400, detail="missing_nom")

    token = sign_session({'nom': final_nom, 'iat': now_iso()})
    response = JSONResponse({"ok": True, "nom": final_nom})
    response.set_cookie(
        key=COOKIE_NAME, value=token,
        max_age=COOKIE_MAX_AGE, httponly=True, secure=True, samesite='lax', path='/'
    )
    return response


@api.get("/me")
async def auth_me(request: Request):
    sess = require_session(request)
    return {"nom": sess['nom']}


@api.post("/logout")
async def auth_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE_NAME, path='/')
    return response


# ============================================================
#  Endpoints "simples" : params / bdd-items / formules / etc.
#  Pattern : GET = lire, PUT = remplacer
# ============================================================
SIMPLE_BLOBS = {
    'params':          ('params',          {}),  # objet
    'bdd-items':       ('bdd-items',       []),
    'formules':        ('formules',        []),
    'formules-v2':     ('formules-v2',     []),
    'types-internes':  ('types-internes',  []),
    'paliers':         ('paliers',         []),
}

for url_key, (blob_key, default) in SIMPLE_BLOBS.items():
    async def _make_get(request: Request, _k=blob_key, _d=default):
        require_session(request)
        return await blob_get(_k, _d)

    async def _make_put(request: Request, _k=blob_key):
        require_session(request)
        body = await request.json()
        await blob_set(_k, body)
        return {"ok": True}

    api.add_api_route(f"/{url_key}", _make_get, methods=["GET"])
    api.add_api_route(f"/{url_key}", _make_put, methods=["PUT"])


# ============================================================
#  FICHES devis : LIST + GET/PUT/DELETE par id, avec traçabilité
# ============================================================
def fiche_index_entry(f: dict) -> dict:
    blocs = (f.get('config') or {}).get('formules')
    formules_types = None
    if isinstance(blocs, list) and blocs:
        formules_types = [b.get('typeId') or b.get('type') for b in blocs if (b.get('typeId') or b.get('type'))]
    elif (f.get('config') or {}).get('format'):
        formules_types = [f['config']['format']]
    return {
        'id': f.get('id'),
        'nomFiche': f.get('nomFiche') or '',
        'client': f.get('client') or '',
        'dateEvent': f.get('dateEvent') or '',
        'statut': f.get('statut') or 'brouillon',
        'totalHT': (f.get('resultsSnapshot') or {}).get('totalHT'),
        'formulesTypes': formules_types,
        'updated_at': f.get('updated_at'),
        'updated_by': f.get('updated_by'),
    }


@api.get("/fiches")
async def fiches_list(request: Request):
    require_session(request)
    return await blob_get('fiches/_index', [])


@api.get("/fiches/{fid}")
async def fiches_get(request: Request, fid: str):
    require_session(request)
    f = await blob_get(f'fiches/{fid}')
    if not f:
        raise HTTPException(status_code=404, detail="not_found")
    return f


@api.put("/fiches/{fid}")
async def fiches_put(request: Request, fid: str):
    sess = require_session(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="expected_object")

    existing = await blob_get(f'fiches/{fid}')
    now = now_iso()
    fiche = {**body, 'id': fid}
    fiche['updated_at'] = now
    fiche['updated_by'] = sess['nom']
    if existing:
        fiche['created_at'] = existing.get('created_at') or now
        fiche['created_by'] = existing.get('created_by') or sess['nom']
    else:
        fiche['created_at'] = now
        fiche['created_by'] = sess['nom']

    await blob_set(f'fiches/{fid}', fiche)
    # Upsert dans l'index
    index = await blob_get('fiches/_index', []) or []
    entry = fiche_index_entry(fiche)
    i = next((k for k, e in enumerate(index) if e.get('id') == fid), -1)
    if i >= 0:
        index[i] = entry
    else:
        index.append(entry)
    await blob_set('fiches/_index', index)
    return fiche


@api.delete("/fiches/{fid}")
async def fiches_delete(request: Request, fid: str):
    require_session(request)
    existing = await blob_get(f'fiches/{fid}')
    if not existing:
        raise HTTPException(status_code=404, detail="not_found")
    await blob_delete(f'fiches/{fid}')
    index = await blob_get('fiches/_index', []) or []
    await blob_set('fiches/_index', [e for e in index if e.get('id') != fid])
    return {"ok": True}


# ============================================================
#  CRM prospects : même pattern que fiches
# ============================================================
def crm_index_entry(p: dict) -> dict:
    return {
        'id': p.get('id'),
        'societe': p.get('societe') or '',
        'contactNom': p.get('contactNom') or '',
        'contactEmail': p.get('contactEmail') or '',
        'contactTel': p.get('contactTel') or '',
        'source': p.get('source') or '',
        'typeEvenement': p.get('typeEvenement') or '',
        'nbPersonnes': p.get('nbPersonnes'),
        'dateEnvisagee': p.get('dateEnvisagee') or '',
        'budgetAnnonce': p.get('budgetAnnonce'),
        'statut': p.get('statut') or 'a_contacter',
        'dateProchainContact': p.get('dateProchainContact') or '',
        'nbFichesLiees': len(p.get('fichesIds') or []),
        'updated_at': p.get('updated_at'),
        'updated_by': p.get('updated_by'),
    }


@api.get("/crm")
async def crm_list(request: Request):
    require_session(request)
    return await blob_get('crm/_index', [])


@api.get("/crm/{pid}")
async def crm_get(request: Request, pid: str):
    require_session(request)
    p = await blob_get(f'crm/{pid}')
    if not p:
        raise HTTPException(status_code=404, detail="not_found")
    return p


@api.put("/crm/{pid}")
async def crm_put(request: Request, pid: str):
    sess = require_session(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="expected_object")

    existing = await blob_get(f'crm/{pid}')
    now = now_iso()
    prospect = {**body, 'id': pid}
    # sanitize fichesIds
    if not isinstance(prospect.get('fichesIds'), list):
        prospect['fichesIds'] = []
    prospect['fichesIds'] = [x for x in prospect['fichesIds'] if isinstance(x, str)]

    prospect['updated_at'] = now
    prospect['updated_by'] = sess['nom']
    if existing:
        prospect['created_at'] = existing.get('created_at') or now
        prospect['created_by'] = existing.get('created_by') or sess['nom']
    else:
        prospect['created_at'] = now
        prospect['created_by'] = sess['nom']

    await blob_set(f'crm/{pid}', prospect)
    index = await blob_get('crm/_index', []) or []
    entry = crm_index_entry(prospect)
    i = next((k for k, e in enumerate(index) if e.get('id') == pid), -1)
    if i >= 0:
        index[i] = entry
    else:
        index.append(entry)
    await blob_set('crm/_index', index)
    return prospect


@api.delete("/crm/{pid}")
async def crm_delete(request: Request, pid: str):
    require_session(request)
    existing = await blob_get(f'crm/{pid}')
    if not existing:
        raise HTTPException(status_code=404, detail="not_found")
    await blob_delete(f'crm/{pid}')
    index = await blob_get('crm/_index', []) or []
    await blob_set('crm/_index', [e for e in index if e.get('id') != pid])
    return {"ok": True}


# ============================================================
#  Healthcheck
# ============================================================
@api.get("/")
async def root():
    return {"ok": True, "app": "Palace Comedy Simulateur — Preview"}


app.include_router(api)


@app.on_event("shutdown")
async def shutdown():
    client.close()
