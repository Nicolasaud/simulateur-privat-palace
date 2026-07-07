// GET  /api/formules  → tableau des formules de prestation enregistrées
// PUT  /api/formules  → remplace intégralement le blob par le tableau fourni

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'formules';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method === 'GET') {
    const formules = await readJson(KEY, []);
    return jsonResponse(200, formules);
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
