// GET  /api/params  → objet de configuration globale du simulateur
// PUT  /api/params  → remplace intégralement le blob
//
// Contient (entre autres) : prix/coûts spectacle, CA habituels par jour & période,
// marges, taux TVA, plafonds, prix par formule. Schéma traité comme opaque.

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'params';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method === 'GET') {
    const params = await readJson(KEY, {});
    return jsonResponse(200, params);
  }

  if (req.method === 'PUT') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    if (!isPlainObject(parsed.body)) {
      return jsonResponse(400, { error: 'expected_object' });
    }
    await writeJson(KEY, parsed.body);
    return jsonResponse(200, { ok: true });
  }

  return methodNotAllowed(['GET', 'PUT']);
};
