// CRUD objectifs CA :
//   GET /api/objectifs/:key    → renvoie { ca: number } ou null
//   PUT /api/objectifs/:key    → enregistre la valeur, VERIFIE le mdp objectifs
//                                via header X-Objectifs-Password
//
// Clés supportées :
//   - mensuel-YYYY-MM
//   - annuel-YYYY
//
// Pourquoi un mdp séparé : seuls les responsables doivent pouvoir bouger
// les objectifs (toute l'équipe ayant le code d'accès général).
// Le mdp est en variable d'env OBJECTIFS_PASSWORD côté Netlify.

import {
  requireAuth, readJsonBody, jsonResponse, methodNotAllowed
} from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const blobKey = key => `objectifs/${key}`;

function extractKey(req) {
  const path = new URL(req.url).pathname;
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf('objectifs');
  if (idx < 0 || idx === parts.length - 1) return null;
  return decodeURIComponent(parts[idx + 1]);
}

function isValidKey(k) {
  return /^mensuel-\d{4}-\d{2}$/.test(k) || /^annuel-\d{4}$/.test(k);
}

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  const key = extractKey(req);
  if (!key || !isValidKey(key)) return jsonResponse(400, { error: 'invalid_key' });

  if (req.method === 'GET') {
    const val = await readJson(blobKey(key), null);
    return jsonResponse(200, val);
  }

  if (req.method === 'PUT') {
    // Vérification du mot de passe objectifs
    const expected = process.env.OBJECTIFS_PASSWORD;
    if (!expected) return jsonResponse(500, { error: 'objectifs_password_not_set' });
    const provided = req.headers.get('x-objectifs-password') || '';
    if (provided !== expected) return jsonResponse(403, { error: 'wrong_objectifs_password' });

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body || typeof body !== 'object' || typeof body.ca !== 'number' || body.ca < 0) {
      return jsonResponse(400, { error: 'expected_ca_number' });
    }
    const payload = {
      ca: body.ca,
      updated_at: new Date().toISOString(),
      updated_by: auth.nom
    };
    await writeJson(blobKey(key), payload);
    return jsonResponse(200, payload);
  }

  return methodNotAllowed(['GET', 'PUT']);
};
