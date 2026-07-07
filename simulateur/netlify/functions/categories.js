// GET / PUT tableau des catégories libres (paramétrables).
// Catégorie : { id, nom, ordre, couleur }
import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';
const KEY = 'categories';
export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  if (req.method === 'GET') return jsonResponse(200, (await readJson(KEY, [])) || []);
  if (req.method === 'PUT') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    if (!Array.isArray(parsed.body)) return jsonResponse(400, { error: 'expected_array' });
    await writeJson(KEY, parsed.body);
    return jsonResponse(200, parsed.body);
  }
  return methodNotAllowed(['GET', 'PUT']);
};
