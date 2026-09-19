// CRUD fiches devis :
//   GET    /api/fiches          → renvoie l'index léger (dashboard + calendrier)
//   GET    /api/fiches/:id      → renvoie la fiche complète
//   PUT    /api/fiches/:id      → crée ou remplace (last-write-wins)
//   DELETE /api/fiches/:id      → supprime + retire de l'index
//
// Stockage :
//   - 1 blob par fiche : clé `fiches/<id>`
//   - 1 blob d'index   : clé `fiches/_index` = tableau d'entrées légères
//
// Traçabilité :
//   - À la première écriture : created_at, created_by (prénom depuis le cookie)
//   - À chaque écriture       : updated_at, updated_by
//   - Le `body.created_by` / `body.updated_by` envoyé par le client est ignoré.
//
// Concurrence : last-write-wins (aucun ETag).

import {
  requireAuth, readJsonBody, jsonResponse, methodNotAllowed
} from '../lib/auth-guard.js';
import { readJson, writeJson, deleteKey } from '../lib/blobs.js';

const INDEX_KEY = 'fiches/_index';
const ficheKey = id => `fiches/${id}`;

// Champs de l'index — restent légers pour la liste/dashboard/calendrier.
// On expose en plus margeBrute, tauxMarge et formulesTypes pour les KPIs
// du dashboard mensuel sans avoir à recharger chaque fiche complète.
function buildIndexEntry(fiche) {
  const blocs = fiche.config?.formules;
  let formulesTypes = null;
  if (Array.isArray(blocs) && blocs.length > 0) {
    formulesTypes = blocs.map(b => b.typeId || b.type || null).filter(Boolean);
  } else if (fiche.config?.format) {
    formulesTypes = [fiche.config.format];
  }
  const snap = fiche.resultsSnapshot || {};
  return {
    id: fiche.id,
    nomFiche: fiche.nomFiche || '',
    client: fiche.client || '',
    dateEvent: fiche.dateEvent || '',
    statut: fiche.statut || 'brouillon',
    totalHT: snap.totalHT ?? null,
    margeBrute: snap.margeBrute ?? null,
    tauxMarge: snap.tauxMarge ?? null,
    formulesTypes,
    updated_at: fiche.updated_at,
    updated_by: fiche.updated_by
  };
}

async function getIndex() {
  return (await readJson(INDEX_KEY, [])) || [];
}

async function upsertIndex(entry) {
  const index = await getIndex();
  const i = index.findIndex(e => e.id === entry.id);
  if (i >= 0) index[i] = entry; else index.push(entry);
  await writeJson(INDEX_KEY, index);
}

async function removeFromIndex(id) {
  const index = await getIndex();
  await writeJson(INDEX_KEY, index.filter(e => e.id !== id));
}

// Parse l'éventuel :id dans l'URL.
// La redirection /api/* → /.netlify/functions/:splat fait que
// /api/fiches/abc devient /.netlify/functions/fiches/abc.
function extractId(req) {
  const path = new URL(req.url).pathname;
  // [.netlify, functions, fiches, (id?)]
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf('fiches');
  if (idx < 0 || idx === parts.length - 1) return null;
  return decodeURIComponent(parts[idx + 1]);
}

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  const id = extractId(req);
  const method = req.method;

  // === LIST ===
  if (method === 'GET' && !id) {
    const index = await getIndex();
    return jsonResponse(200, index);
  }

  // === GET ONE ===
  if (method === 'GET' && id) {
    const fiche = await readJson(ficheKey(id), null);
    if (!fiche) return jsonResponse(404, { error: 'not_found' });
    return jsonResponse(200, fiche);
  }

  // === PUT (create or replace) ===
  if (method === 'PUT' && id) {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) {
      return jsonResponse(400, { error: 'expected_object' });
    }

    const now = new Date().toISOString();
    const existing = await readJson(ficheKey(id), null);

    // Copie défensive + force l'id depuis l'URL (jamais depuis le body).
    const fiche = { ...parsed.body, id };

    // Traçabilité : prénom toujours depuis le cookie.
    fiche.updated_at = now;
    fiche.updated_by = auth.nom;
    if (existing) {
      fiche.created_at = existing.created_at || now;
      fiche.created_by = existing.created_by || auth.nom;
    } else {
      fiche.created_at = now;
      fiche.created_by = auth.nom;
    }

    await writeJson(ficheKey(id), fiche);
    await upsertIndex(buildIndexEntry(fiche));

    return jsonResponse(existing ? 200 : 201, fiche);
  }

  // === DELETE ===
  if (method === 'DELETE' && id) {
    const existing = await readJson(ficheKey(id), null);
    if (!existing) return jsonResponse(404, { error: 'not_found' });
    await deleteKey(ficheKey(id));
    await removeFromIndex(id);
    return jsonResponse(200, { ok: true });
  }

  return methodNotAllowed(['GET', 'PUT', 'DELETE']);
};
