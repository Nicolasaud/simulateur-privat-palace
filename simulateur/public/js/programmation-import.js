// Phase 2b3 — Import PDF de programmation artistique avec preview + merge.
//
// FLUX
//   1. User clique "📥 Importer programmation PDF" → modal step 1
//   2. User sélectionne un PDF → bouton "Analyser le PDF"
//   3. POST /api/parse-programmation → on récupère un objet { dates, chars, log }
//   4. Détection du mois cible (= mois de la majorité des dates)
//   5. Fetch des données existantes du mois pour calculer le diff par date
//   6. Modal step 2 : preview compteurs + listes regroupées par statut
//        - "Nouvelles" : import auto (checkbox cochée par défaut)
//        - "Conflits" : comparatif ancien/nouveau, checkbox cochée par défaut
//            (sauf si manuelle=true → décochée par défaut + badge warning)
//        - "Identiques" : skip silencieux, juste un compteur
//   7. User valide → on construit l'objet final (existant - dates décochées +
//      dates cochées du PDF), on PUT /api/programmation/:mois
//
// Multi-mois : si le PDF contient des dates de plusieurs mois (rare mais
// possible), on regroupe par mois et on effectue un PUT par mois ciblé.

import { $ } from './helpers.js';
import { state } from './state.js';
import {
  parseProgrammationPdf, getProgrammationMois, putProgrammationMois
} from './api.js';
import { showToast } from './ui-feedback.js';

const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// État local du modal (réinitialisé à chaque ouverture)
let importState = null;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const idx = dataUrl.indexOf('base64,');
      if (idx < 0) return reject(new Error('Lecture du fichier échouée (pas de base64)'));
      resolve(dataUrl.slice(idx + 'base64,'.length));
    };
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier échouée'));
    reader.readAsDataURL(file);
  });
}

// Parsing du PDF entièrement CÔTÉ CLIENT via pdfjs-dist (CDN).
// Retourne du texte tab-séparé (une cellule = un TAB, une ligne visuelle = un \n)
// prêt à être envoyé à parseProgrammation() côté backend.
//
// Avantages vs parsing serveur :
//   - Aucune dépendance PDF côté Netlify (pdf-parse/pdf2json cassaient en prod)
//   - Le PDF ne quitte pas le navigateur (confidentialité)
//   - Aucune limite de mémoire serverless
async function extractPdfTextClientSide(file) {
  // Chargement lazy de pdfjs depuis le CDN mozilla (ESM natif, aucun install)
  const pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // items = [{ str, transform: [scaleX, skewX, skewY, scaleY, x, y] }]
    const rows = new Map();
    for (const it of content.items) {
      const txt = (it.str || '').trim();
      if (!txt) continue;
      const x = it.transform?.[4] || 0;
      const y = Math.round((it.transform?.[5] || 0) * 10) / 10;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, txt });
    }
    // Ordre visuel : y descendant (haut d'abord dans les coordonnées PDF)
    const sortedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, cells] of sortedRows) {
      cells.sort((a, b) => a.x - b.x);
      lines.push(cells.map(c => c.txt).join('\t'));
    }
  }
  return lines.join('\n');
}

// Égalité fonctionnelle entre deux jours (artistes/créneaux triés, notes trim).
function jourEqual(a, b) {
  if (!a || !b) return false;
  const ar = [...(a.artistes || [])].sort();
  const br = [...(b.artistes || [])].sort();
  if (ar.length !== br.length || ar.some((v, i) => v !== br[i])) return false;
  const ac = [...(a.creneaux || [])].sort();
  const bc = [...(b.creneaux || [])].sort();
  if (ac.length !== bc.length || ac.some((v, i) => v !== bc[i])) return false;
  return (a.notes || '').trim() === (b.notes || '').trim();
}

// Groupe les dates parsées par mois, et calcule le diff vs l'existant.
async function buildDiff(parsedDates) {
  const moisGroups = {}; // 'YYYY-MM' → ['YYYY-MM-DD', ...]
  Object.keys(parsedDates).forEach(d => {
    const m = d.slice(0, 7);
    (moisGroups[m] = moisGroups[m] || []).push(d);
  });

  // Pour chaque mois ciblé, on a besoin du jeu de données existant en cloud
  const existing = {};
  await Promise.all(Object.keys(moisGroups).map(async (m) => {
    try {
      const data = await getProgrammationMois(m);
      existing[m] = (data && typeof data === 'object') ? data : {};
    } catch (e) {
      console.error(`Lecture ${m} échouée`, e);
      existing[m] = {};
    }
  }));

  // Pour chaque date, déterminer le statut
  const items = [];
  for (const [dateKey, newJour] of Object.entries(parsedDates)) {
    const m = dateKey.slice(0, 7);
    const oldJour = existing[m]?.[dateKey] || null;
    let status;
    if (!oldJour) status = 'new';
    else if (jourEqual(oldJour, newJour)) status = 'identical';
    else status = 'conflict';
    items.push({
      dateKey,
      mois: m,
      newJour,
      oldJour,
      status,
      manualOverwrite: status === 'conflict' && !!oldJour.manuelle,
      selected: status === 'new' || (status === 'conflict' && !oldJour.manuelle)
    });
  }
  items.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return { items, existing, moisGroups };
}

// =====================================================================
// UI
// =====================================================================

export function openImportProgrammation() {
  importState = { step: 1, file: null, parsed: null, diff: null, importing: false };
  renderModal();
  document.getElementById('importProgModal').classList.remove('hidden');
}

export function closeImportProgrammation() {
  document.getElementById('importProgModal').classList.add('hidden');
  importState = null;
}

function renderModal() {
  const body = document.getElementById('importProgModalBody');
  if (!body) return;
  if (importState.step === 1) renderStep1(body);
  else if (importState.step === 2) renderStep2(body);
}

function renderStep1(body) {
  const fileInfo = importState.file
    ? `<div style="padding:8px 12px;background:#f0eae0;border-radius:6px;margin-top:8px;font-size:0.88em">
         📄 <strong>${escape(importState.file.name)}</strong> · ${Math.round(importState.file.size / 1024)} Ko
       </div>`
    : '';

  body.innerHTML = `
    <h2 style="margin-top:0">📥 Importer programmation PDF</h2>
    <p style="color:#666;margin-bottom:14px">Téléverse le PDF mensuel de programmation artistique. L'analyse s'effectue côté serveur ; un aperçu te sera proposé avant toute écriture.</p>

    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="file" id="importProgFile" accept="application/pdf,.pdf" style="flex:1;min-width:200px">
    </div>
    ${fileInfo}

    ${importState.error ? `<div style="margin-top:10px;padding:8px 12px;background:#fbeaec;border-left:3px solid #a83240;color:#a83240;font-size:0.88em;border-radius:4px">${escape(importState.error)}</div>` : ''}

    <div class="modalActions" style="margin-top:18px">
      <button onclick="closeImportProgrammation()">Annuler</button>
      <button onclick="analyzeImportPdf()" class="primary" ${importState.file && !importState.analyzing ? '' : 'disabled'} style="margin-top:0">
        ${importState.analyzing ? '⏳ Analyse en cours…' : 'Analyser le PDF'}
      </button>
    </div>
  `;

  // Wire file picker
  const input = document.getElementById('importProgFile');
  if (input) {
    input.addEventListener('change', e => {
      const f = e.target.files?.[0] || null;
      importState.file = f;
      importState.error = null;
      renderModal();
    });
  }
}

function renderStep2(body) {
  const { items } = importState.diff;
  const nbDates = items.length;
  const totalArtistes = items.reduce((s, it) => s + (it.newJour.artistes?.length || 0), 0);
  const totalCreneaux = items.reduce((s, it) => s + (it.newJour.creneaux?.length || 0), 0);

  const groups = { new: [], conflict: [], identical: [] };
  items.forEach(it => groups[it.status].push(it));

  // Récap des mois ciblés
  const moisList = Object.keys(importState.diff.moisGroups).sort();
  const moisLabel = moisList.length === 1 ? `mois ${moisList[0]}` : `${moisList.length} mois (${moisList.join(', ')})`;

  const newItemsHTML = groups.new.length === 0 ? '' : `
    <details open style="margin-top:14px">
      <summary style="cursor:pointer;font-weight:600;padding:6px 0;color:#0a5c2c">
        ✨ ${groups.new.length} nouvelle${groups.new.length > 1 ? 's' : ''} date${groups.new.length > 1 ? 's' : ''}
        <button onclick="toggleImportGroup('new', true)" style="font-size:0.78em;padding:2px 8px;margin-left:6px">Tout cocher</button>
        <button onclick="toggleImportGroup('new', false)" style="font-size:0.78em;padding:2px 8px">Tout décocher</button>
      </summary>
      <div style="padding:6px 0">
        ${groups.new.map(renderItemRow).join('')}
      </div>
    </details>
  `;

  const conflictItemsHTML = groups.conflict.length === 0 ? '' : `
    <details open style="margin-top:14px">
      <summary style="cursor:pointer;font-weight:600;padding:6px 0;color:#a83240">
        ⚠️ ${groups.conflict.length} conflit${groups.conflict.length > 1 ? 's' : ''} (date${groups.conflict.length > 1 ? 's' : ''} existante${groups.conflict.length > 1 ? 's' : ''})
        <button onclick="toggleImportGroup('conflict', true)" style="font-size:0.78em;padding:2px 8px;margin-left:6px">Tout cocher</button>
        <button onclick="toggleImportGroup('conflict', false)" style="font-size:0.78em;padding:2px 8px">Tout décocher</button>
      </summary>
      <div style="padding:6px 0">
        ${groups.conflict.map(renderItemRow).join('')}
      </div>
    </details>
  `;

  const identicalLine = groups.identical.length === 0 ? '' : `
    <p style="margin-top:10px;font-size:0.88em;color:#888">
      ✓ ${groups.identical.length} date${groups.identical.length > 1 ? 's' : ''} identique${groups.identical.length > 1 ? 's' : ''} à l'existant — skip silencieux.
    </p>
  `;

  const selectedCount = items.filter(it => it.selected).length;

  body.innerHTML = `
    <h2 style="margin-top:0">📥 Aperçu de l'import — ${moisLabel}</h2>
    <p style="color:#666;margin-bottom:6px">
      📊 <strong>${nbDates}</strong> date${nbDates > 1 ? 's' : ''} détectée${nbDates > 1 ? 's' : ''} ·
      <strong>${totalArtistes}</strong> artiste${totalArtistes > 1 ? 's' : ''} ·
      <strong>${totalCreneaux}</strong> créneau${totalCreneaux > 1 ? 'x' : ''}
    </p>

    ${newItemsHTML}
    ${conflictItemsHTML}
    ${identicalLine}

    <div class="modalActions" style="margin-top:18px;align-items:center">
      <span style="margin-right:auto;font-size:0.9em;color:#444"><strong id="importSelectedCount">${selectedCount}</strong> date${selectedCount > 1 ? 's' : ''} sélectionnée${selectedCount > 1 ? 's' : ''} pour l'import</span>
      <button onclick="closeImportProgrammation()" ${importState.importing ? 'disabled' : ''}>Annuler</button>
      <button onclick="applyImport()" class="primary" ${selectedCount > 0 && !importState.importing ? '' : 'disabled'} style="margin-top:0">
        ${importState.importing ? '⏳ Écriture en cours…' : `Importer ${selectedCount} date${selectedCount > 1 ? 's' : ''}`}
      </button>
    </div>
  `;

  // Wire checkboxes
  body.querySelectorAll('[data-import-date]').forEach(cb => {
    cb.addEventListener('change', e => {
      const d = e.target.dataset.importDate;
      const it = items.find(x => x.dateKey === d);
      if (it) it.selected = e.target.checked;
      const n = items.filter(x => x.selected).length;
      document.getElementById('importSelectedCount').textContent = n;
      // Re-render uniquement le bouton importer (sans tout casser)
      const btn = body.querySelector('.modalActions .primary');
      if (btn) {
        btn.textContent = `Importer ${n} date${n > 1 ? 's' : ''}`;
        btn.disabled = n === 0 || importState.importing;
      }
    });
  });
}

function renderItemRow(it) {
  const oldJour = it.oldJour;
  const newJour = it.newJour;
  const bg = it.status === 'new' ? '#f0f9f3' : '#fbf3ec';
  const borderLeft = it.status === 'new' ? '#0a5c2c' : '#c4751a';

  const manualBadge = it.manualOverwrite
    ? `<span style="font-size:0.7em;color:#fff;background:#a83240;padding:1px 6px;border-radius:3px;margin-left:6px;font-weight:500" title="Cette date avait été saisie manuellement">⚠️ SAISIE MANUELLE</span>`
    : '';

  let detailHTML = '';
  if (it.status === 'conflict') {
    const oldArt = (oldJour.artistes || []).join(', ') || '—';
    const oldCr = (oldJour.creneaux || []).join(' · ') || '—';
    const oldNotes = (oldJour.notes || '').trim() || '—';
    const newArt = (newJour.artistes || []).join(', ') || '—';
    const newCr = (newJour.creneaux || []).join(' · ') || '—';
    const newNotes = (newJour.notes || '').trim() || '—';
    detailHTML = `
      <div style="display:grid;grid-template-columns:60px 1fr 1fr;gap:4px 8px;font-size:0.82em;margin-top:6px;padding:6px 8px;background:rgba(0,0,0,0.03);border-radius:4px">
        <div style="color:#888"></div><div style="color:#888;font-weight:600">Ancien</div><div style="color:#888;font-weight:600">Nouveau</div>
        <div style="color:#888">Artistes</div><div>${escape(oldArt)}</div><div>${escape(newArt)}</div>
        <div style="color:#888">Créneaux</div><div>${escape(oldCr)}</div><div>${escape(newCr)}</div>
        <div style="color:#888">Notes</div><div style="font-style:italic">${escape(oldNotes)}</div><div style="font-style:italic">${escape(newNotes)}</div>
      </div>
    `;
  } else {
    // Nouvelle : juste afficher le contenu nouveau
    const newArt = (newJour.artistes || []).join(', ') || '<em style="color:#888">aucun artiste</em>';
    const newCr = (newJour.creneaux || []).join(' · ') || '<em style="color:#888">aucun créneau</em>';
    const newNotes = (newJour.notes || '').trim();
    detailHTML = `
      <div style="font-size:0.82em;color:#555;margin-top:4px;padding-left:24px">
        ${newArt} · <span style="color:#888">${newCr}</span>
        ${newNotes ? ` · <em style="color:#5a4a1a">"${escape(newNotes)}"</em>` : ''}
      </div>
    `;
  }

  const dateLbl = new Date(it.dateKey).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
  return `
    <div style="padding:8px 10px;border:1px solid rgba(0,0,0,0.08);border-left:3px solid ${borderLeft};border-radius:4px;margin-bottom:6px;background:${bg}">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" data-import-date="${it.dateKey}" ${it.selected ? 'checked' : ''} style="cursor:pointer">
        <strong>${it.dateKey}</strong>
        <span style="font-size:0.85em;color:#666">${dateLbl}</span>
        ${manualBadge}
      </label>
      ${detailHTML}
    </div>
  `;
}

// =====================================================================
// Handlers exposés sur window
// =====================================================================

export async function analyzeImportPdf() {
  if (!importState?.file) return;
  importState.analyzing = true;
  importState.error = null;
  renderModal();
  try {
    // Étape 1 : extraction texte côté CLIENT (via pdfjs CDN)
    const rawText = await extractPdfTextClientSide(importState.file);
    if (!rawText || rawText.length < 50) {
      throw new Error('Le PDF semble vide ou illisible.');
    }
    // Étape 2 : envoi du texte seul au backend pour parseProgrammation()
    const resp = await parseProgrammationPdf(rawText);
    if (!resp || !resp.dates) throw new Error('Réponse parser invalide');
    importState.parsed = resp.dates;
    importState.diff = await buildDiff(resp.dates);
    importState.analyzing = false;
    importState.step = 2;
    renderModal();
  } catch (e) {
    console.error('[import-prog] analyse échouée', e);
    importState.analyzing = false;
    importState.error = `Échec de l'analyse : ${e.message || e}`;
    renderModal();
  }
}

export function toggleImportGroup(status, value) {
  if (!importState?.diff) return;
  importState.diff.items.forEach(it => {
    if (it.status === status) it.selected = !!value;
  });
  renderModal();
}

export async function applyImport() {
  if (!importState?.diff) return;
  const selected = importState.diff.items.filter(it => it.selected);
  if (selected.length === 0) return;

  importState.importing = true;
  renderModal();

  // Grouper par mois et fusionner avec l'existant
  const byMois = {};
  selected.forEach(it => {
    (byMois[it.mois] = byMois[it.mois] || []).push(it);
  });

  let totalWritten = 0;
  const errors = [];
  for (const [mois, list] of Object.entries(byMois)) {
    const merged = { ...(importState.diff.existing[mois] || {}) };
    list.forEach(it => {
      // L'import efface le flag manuelle (les données viennent du PDF)
      merged[it.dateKey] = { ...it.newJour, manuelle: false };
    });
    try {
      const r = await putProgrammationMois(mois, merged);
      totalWritten += list.length;
      // Met à jour le cache RAM
      state.programmationMonths[mois] = merged;
      console.info(`[import-prog] ${mois} écrit :`, r);
    } catch (e) {
      console.error(`[import-prog] échec écriture ${mois}`, e);
      errors.push(`${mois} : ${e.message}`);
    }
  }

  importState.importing = false;
  if (errors.length > 0) {
    showToast(`Import partiel : ${totalWritten} dates écrites, ${errors.length} mois en erreur`, 'error');
  } else {
    showToast(`✓ ${totalWritten} date${totalWritten > 1 ? 's' : ''} importée${totalWritten > 1 ? 's' : ''}`, 'success');
  }
  closeImportProgrammation();
  // Re-render le calendrier pour afficher les nouveaux chips
  if (typeof window.renderCalendrier === 'function') window.renderCalendrier();
}
