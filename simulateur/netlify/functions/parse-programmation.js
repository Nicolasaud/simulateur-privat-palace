// POST /api/parse-programmation
// Body : { pdfBase64: "..." } (PDF encodé en base64)
// Réponse : { dates: {...}, log: [...], chars: N }
//
// Reçoit un PDF, extrait son texte avec pdf-parse, le parse en structure
// par date via netlify/lib/parse-programmation.js, et retourne le résultat.
//
// PDF.JS WORKER : pdf-parse v2 utilise pdfjs-dist qui charge dynamiquement
// pdf.worker.mjs via `await import(workerSrc)`. esbuild ne suit pas ce
// dynamic import, donc on :
//   1. inclut explicitement le worker via [functions."parse-programmation"]
//      included_files dans netlify.toml
//   2. set GlobalWorkerOptions.workerSrc à un path absolu résolu via
//      createRequire (cf init() ci-dessous) — sinon pdfjs cherche le
//      worker relativement à son propre fichier bundle où il n'est pas.

import { createRequire } from 'node:module';
import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { parseProgrammation } from '../lib/parse-programmation.js';

const requireFromHere = createRequire(import.meta.url);

// Résout le workerSrc une seule fois (mémoïsé). Renvoie un path string
// utilisable par `await import(workerSrc)` côté pdfjs.
let _workerSrc = null;
function resolveWorkerSrc() {
  if (_workerSrc) return _workerSrc;
  try {
    // require.resolve fonctionne avec les fichiers inclus via included_files
    const p = requireFromHere.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    _workerSrc = p;
  } catch (e) {
    console.warn('[parse-programmation] resolve worker échoué', e.message);
    _workerSrc = null;
  }
  return _workerSrc;
}

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
    // Configure GlobalWorkerOptions.workerSrc UNE FOIS avant le premier
    // getDocument. Sans ça, pdfjs cherche pdf.worker.mjs via import.meta.url
    // de son propre fichier (introuvable dans le bundle).
    const ws = resolveWorkerSrc();
    if (ws) {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        if (pdfjs?.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = ws;
        }
      } catch (we) {
        console.warn('[parse-programmation] config workerSrc échoué', we.message);
      }
    }
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
