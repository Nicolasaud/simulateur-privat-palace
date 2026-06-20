// GET  /api/bdd-items  → tableau des items réutilisables (peut être vide)
// PUT  /api/bdd-items  → remplace intégralement le blob par le tableau fourni
//
// Le payload est traité comme opaque côté serveur (la validation du schéma
// d'item est faite par le client). On exige uniquement que ce soit un tableau.

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'bdd-items';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method === 'GET') {
    const items = await readJson(KEY, []);
    return jsonResponse(200, items);
  }

  if (req.method === 'PUT') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    if (!Array.isArray(parsed.body)) {
      return jsonResponse(400, { error: 'expected_array' });
    }
    await writeJson(KEY, parsed.body);
    return jsonResponse(200, { ok: true, count: parsed.body.length });
  }

  return methodNotAllowed(['GET', 'PUT']);
};
