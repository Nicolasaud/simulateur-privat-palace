// POST /api/parse-programmation
// Body : { pdfBase64: "..." } (PDF encodé en base64)
// Réponse : { dates: {...}, log: [...], chars: N }
//
// Reçoit un PDF, extrait son texte avec pdf-parse, le parse en structure
// par date via netlify/lib/parse-programmation.js, et retourne le résultat.

import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { parseProgrammation } from '../lib/parse-programmation.js';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const pdfBase64 = parsed.body?.pdfBase64;
  if (typeof pdfBase64 !== 'string' || pdfBase64.length < 100) {
    return jsonResponse(400, { error: 'pdfBase64_required' });
  }

  let buffer;
  try {
    buffer = Buffer.from(pdfBase64, 'base64');
  } catch (e) {
    return jsonResponse(400, { error: 'invalid_base64', message: e.message });
  }

  let rawText;
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy?.();
    rawText = result.text || '';
  } catch (e) {
    console.error('[parse-programmation] pdf-parse error', e);
    return jsonResponse(500, { error: 'pdf_parse_failed', message: e.message });
  }

  const { result: dates, log } = parseProgrammation(rawText);

  return jsonResponse(200, {
    dates,
    chars: rawText.length,
    log
  });
};
