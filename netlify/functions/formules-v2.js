// GET  /api/formules-v2  → tableau des formules de prestation (bundles type+params+items)
// PUT  /api/formules-v2  → remplace intégralement le blob par le tableau fourni
//
// Schéma d'un élément attendu (validation minimale côté serveur : array seulement) :
//   {
//     id, nom, type ∈ {privat-full, privat-salle, atelier-cocktail,
//                       formation-impro, groupe-classique},
//     params: { ... },      // overrides spécifiques au type
//     items:  [ ... ],      // items resto (incluant personnesParUnite)
//     builtIn: bool,        // formules de base verrouillées côté UI
//     dateCreation, dateModification
//   }
//
// Le blob legacy /api/formules est conservé tel quel pour les "compositions"
// (listes d'items réutilisables sans type ni params).

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'formules-v2';

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
