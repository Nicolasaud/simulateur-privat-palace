// GET  /api/types-internes  → tableau des 5 types internes (params par défaut)
// PUT  /api/types-internes  → remplace intégralement le blob par le tableau fourni
//
// Niveau 1 du modèle (Modèle C) : les 5 types figés (privat-full, privat-salle,
// atelier-cocktail, formation-impro, groupe-classique) qui portent les params
// PAR DÉFAUT. Les formules-v2 ne stockent désormais que les "overrides"
// (uniquement les params qui s'écartent du défaut du type).
//
// Schéma d'un élément (validation minimale côté serveur : array seulement) :
//   {
//     id: 'privat-full' | 'privat-salle' | 'atelier-cocktail'
//       | 'formation-impro' | 'groupe-classique',
//     nom: 'Privatisation show + repas',  // libellé éditable côté UI
//     params: { paramSpecPrix: 1500, paramSpecCout: 950, ... }
//   }

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'types-internes';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method === 'GET') {
    const list = await readJson(KEY, []);
    return jsonResponse(200, list);
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
