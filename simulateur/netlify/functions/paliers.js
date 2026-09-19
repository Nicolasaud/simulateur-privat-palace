// GET  /api/paliers  → tableau des paliers de personnel ([{seuil, staff}, …])
// PUT  /api/paliers  → remplace intégralement le blob

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'paliers';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method === 'GET') {
    const paliers = await readJson(KEY, []);
    return jsonResponse(200, paliers);
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
