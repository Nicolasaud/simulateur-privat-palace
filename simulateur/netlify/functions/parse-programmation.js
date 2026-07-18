// POST /api/parse-programmation
// Body : { pdfBase64: "..." } (PDF encodé en base64)
// Réponse : { dates: {...}, log: [...], chars: N }
//
// Utilise pdf2json pour extraire le PDF avec positions (x,y) des cellules,
// puis reconstruit un texte tab-séparé attendu par parseProgrammation().

import { createRequire } from 'node:module';
import { requireAuth, readJsonBody, jsonResponse, methodNotAllowed } from '../lib/auth-guard.js';
import { parseProgrammation } from '../lib/parse-programmation.js';

const require = createRequire(import.meta.url);

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Reconstruit un texte tab-séparé à partir de la sortie pdf2json.
// Groupement par ligne : Y arrondi à 0.1 près (une ligne visuelle = un bucket).
function reconstructTabbedText(pdfData) {
  const lines = [];
  for (const page of pdfData.Pages || []) {
    const rows = new Map();
    for (const t of (page.Texts || [])) {
      const y = Math.round(t.y * 10) / 10;
      if (!rows.has(y)) rows.set(y, []);
      // Un Text peut avoir plusieurs Runs R (mais généralement 1)
      const txt = (t.R || []).map(r => safeDecode(r.T || '')).join('');
      if (txt) rows.get(y).push({ x: t.x, txt });
    }
    const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, cells] of sortedRows) {
      cells.sort((a, b) => a.x - b.x);
      lines.push(cells.map(c => c.txt).join('\t'));
    }
  }
  return lines.join('\n');
}

function parsePdfWithPdf2json(buffer) {
  return new Promise((resolve, reject) => {
    // pdf2json est CJS → require via createRequire depuis un module ESM
    const PDFParser = require('pdf2json');
    const parser = new PDFParser(null, true);
    parser.on('pdfParser_dataError', e => reject(new Error(e.parserError?.message || 'pdf2json_error')));
    parser.on('pdfParser_dataReady', pdfData => {
      try {
        resolve(reconstructTabbedText(pdfData));
      } catch (e) {
        reject(e);
      }
    });
    parser.parseBuffer(buffer);
  });
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
    rawText = await parsePdfWithPdf2json(buffer);
  } catch (e) {
    console.error('[parse-programmation] pdf2json error', e);
    return jsonResponse(500, { error: 'pdf_parse_failed', message: e.message });
  }

  const { result: dates, log } = parseProgrammation(rawText);

  return jsonResponse(200, {
    dates,
    chars: rawText.length,
    log
  });
};
