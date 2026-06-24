// Stockage de la programmation artistique mensuelle.
//
//   GET  /api/programmation           → liste des mois ayant des données
//   GET  /api/programmation/YYYY-MM   → programmation du mois (objet)
//   PUT  /api/programmation/YYYY-MM   → remplace intégralement le mois
//
// STOCKAGE
//   1 blob par mois : clé `programmation/YYYY-MM`
//   1 blob d'index  : clé `programmation/_index` = tableau ["YYYY-MM", ...]
//
// STRUCTURE attendue dans le body PUT (objet, pas tableau) :
//   {
//     "YYYY-MM-DD": [
//       { "heure": "19h", "artistes": ["NOM 1", "NOM 2"], "notes": "", "manuelle": true? }
//     ],
//     ...
//   }
// Chaque clé doit appartenir au mois ciblé (validation côté serveur).

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const INDEX_KEY = 'programmation/_index';
const moisKey = (mois) => `programmation/${mois}`;
const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function extractMois(req) {
  const path = new URL(req.url).pathname;
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf('programmation');
  if (idx < 0 || idx === parts.length - 1) return null;
  return decodeURIComponent(parts[idx + 1]);
}

async function getIndex() {
  const idx = await readJson(INDEX_KEY, []);
  return Array.isArray(idx) ? idx : [];
}

async function addToIndex(mois) {
  const idx = await getIndex();
  if (!idx.includes(mois)) {
    idx.push(mois);
    idx.sort();
    await writeJson(INDEX_KEY, idx);
  }
}

// Validation : chaque clé date du body doit appartenir au mois ciblé,
// et chaque valeur doit être un tableau de créneaux.
function validateBody(body, mois) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'expected_object' };
  }
  for (const [dateKey, creneaux] of Object.entries(body)) {
    if (!DATE_RE.test(dateKey)) {
      return { ok: false, error: 'invalid_date_key', detail: dateKey };
    }
    if (!dateKey.startsWith(mois + '-')) {
      return { ok: false, error: 'date_not_in_month', detail: `${dateKey} hors ${mois}` };
    }
    if (!Array.isArray(creneaux)) {
      return { ok: false, error: 'creneaux_must_be_array', detail: dateKey };
    }
    for (const c of creneaux) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        return { ok: false, error: 'creneau_must_be_object', detail: dateKey };
      }
      if (typeof c.heure !== 'string') {
        return { ok: false, error: 'creneau_heure_must_be_string', detail: dateKey };
      }
      if (!Array.isArray(c.artistes) || c.artistes.some(a => typeof a !== 'string')) {
        return { ok: false, error: 'creneau_artistes_must_be_string_array', detail: dateKey };
      }
      if (c.notes !== undefined && typeof c.notes !== 'string') {
        return { ok: false, error: 'creneau_notes_must_be_string', detail: dateKey };
      }
    }
  }
  return { ok: true };
}

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  const mois = extractMois(req);
  const method = req.method;

  // === LIST des mois ===
  if (method === 'GET' && !mois) {
    const idx = await getIndex();
    return jsonResponse(200, idx);
  }

  // À partir d'ici, mois requis et au format YYYY-MM
  if (!MOIS_RE.test(mois)) {
    return jsonResponse(400, { error: 'invalid_month_format', detail: 'expected YYYY-MM' });
  }

  // === GET un mois ===
  if (method === 'GET') {
    const data = await readJson(moisKey(mois), null);
    if (data === null) return jsonResponse(200, {}); // mois vide = objet vide (pas 404)
    return jsonResponse(200, data);
  }

  // === PUT un mois ===
  if (method === 'PUT') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const v = validateBody(parsed.body, mois);
    if (!v.ok) return jsonResponse(400, { error: v.error, detail: v.detail });

    await writeJson(moisKey(mois), parsed.body);
    await addToIndex(mois);
    const nbDates = Object.keys(parsed.body).length;
    const nbCreneaux = Object.values(parsed.body).reduce((s, arr) => s + arr.length, 0);
    return jsonResponse(200, { ok: true, mois, nbDates, nbCreneaux });
  }

  return methodNotAllowed(['GET', 'PUT']);
};
