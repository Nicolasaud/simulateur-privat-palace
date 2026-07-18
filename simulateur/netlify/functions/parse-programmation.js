// POST /api/parse-programmation
// Body : { rawText: "..." } (texte tab-séparé extrait du PDF côté client)
// Réponse : { dates: {...}, log: [...], chars: N }
//
// Depuis 2026-02 : le PDF est parsé CÔTÉ CLIENT via pdfjs (CDN) avant l'envoi.
// Cette fonction ne fait plus que valider et découper le texte en structure
// par date via parseProgrammation(). Zéro dépendance PDF côté Netlify.

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { parseProgrammation } from '../lib/parse-programmation.js';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const rawText = parsed.body?.rawText;
  if (typeof rawText !== 'string' || rawText.length < 20) {
    return jsonResponse(400, { error: 'rawText_required', message: 'Le texte extrait du PDF est absent ou trop court.' });
  }

  const { result: dates, log } = parseProgrammation(rawText);

  return jsonResponse(200, {
    dates,
    chars: rawText.length,
    log
  });
};
