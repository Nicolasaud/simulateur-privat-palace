// Fiche client (proposition de privatisation) — modale éditable + export PDF
//
// Inspiré de la mise en page du document "Proposition de privatisation" du Palace.
// Pré-remplissage :
//   - Si `state.currentFiche.ficheClient` (sauvegardé) → on l'utilise
//   - Sinon → on construit depuis le devis : programmeSoiree, lignes vue-client
//     (après fusion service-en-salle), client/date, etc.
//
// 3 actions disponibles :
//   - Générer le PDF      : ouvre une fenêtre HTML imprimable A4
//   - Enregistrer         : persiste le contenu dans la fiche devis (clé `ficheClient`)
//   - Fermer              : ferme la modale sans rien sauvegarder

import { readCurrentForm, saveFiche, readProgrammeSoiree } from './fiches.js';
import { fmt } from './helpers.js';
import { showToast } from './ui-feedback.js';

// === Textes par défaut (issus du document exemple "Proposition de privatisation") ===
const DEFAULT_RECOMMANDATION_TITRE = 'Notre recommandation : la Soirée Palace';
const DEFAULT_RECOMMANDATION_INTRO = 'Une soirée clé en main, du rire à la convivialité, entièrement privatisée pour votre groupe dans notre salle de spectacle et notre restaurant.';
const DEFAULT_POINTS_FORTS = `Privatisation totale : salle de spectacle + restaurant.
Spectacle inclus : MC + plateau d'humoristes professionnels.
Repas : menu groupe complet, cuisine maison sur place.
Après-dîner : espace dansant installé pour le groupe.`;

const DEFAULT_POURQUOI_PALACE = `Un lieu unique : ancien cinéma au cœur d'Angers, façade patrimoniale, ambiance qu'aucune salle de séminaire n'égale.
Des artistes, tous les jours : le Comedy Club tourne toute l'année — on est habitués à recevoir de très bons artistes. Votre soirée hérite de ce niveau.
Tout-en-un : spectacle, repas et soirée au même endroit, on orchestre tout, vous n'avez rien à coordonner.
Ils nous ont fait confiance : un cabinet comptable et les équipes d'Axa, notamment, sont repartis conquis par ce format.`;

const DEFAULT_LA_SUITE = `Si ce déroulé vous parle, on cale une date et on affine ensemble le menu et les options. Un acompte de 30 % confirme la réservation, le solde se règle après l'événement.`;

const SIGNATURE_LINES = [
  'Lucie CLÉMENT — Responsable événementiel & privatisations',
  'contactpalacecomedy@gmail.com',
  'Palace Comedy — SAS — 16 rue Louis de Romain, 49100 Angers'
];

const PALACE_HEADER = 'PALACE COMEDY — Comedy Club & Restaurant — 16 rue Louis de Romain, 49100 Angers — Ancien cinéma Galerie Palace';

// === Helpers ===
function todayFR() {
  return new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function dateEventFR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }
function lignesNet(s) {
  return (s || '').split('\n').map(l => l.trim()).filter(Boolean);
}

// === Construction du modèle pré-rempli ===
function buildDefaultFromDevis() {
  const form = readCurrentForm();
  const programmeSoiree = readProgrammeSoiree();
  // Lignes budget = lignes vue-client après fusion service-en-salle
  // (déjà exposées par calcul.js via window._lastLignesClient).
  const lignesClient = Array.isArray(window._lastLignesClient) ? window._lastLignesClient : [];
  const budgetLignes = lignesClient.map(l => ({
    libelle: (l.libelle || '').replace(/&times;/g, '×').replace(/&[a-z]+;/g, ''),
    montant: l.totalHT || 0
  }));
  const totalHT = window._lastDevis?.totalHT || 0;
  return {
    attention: form.client || '',
    dateEnvisagee: form.dateEvent || '',
    etablieLe: new Date().toISOString().slice(0, 10),
    intro: '',
    recommandationTitre: DEFAULT_RECOMMANDATION_TITRE,
    recommandationIntro: DEFAULT_RECOMMANDATION_INTRO,
    programme: programmeSoiree.length > 0 ? programmeSoiree : [],
    pointsForts: DEFAULT_POINTS_FORTS,
    budgetLignes,
    budgetTotal: totalHT,
    pourquoiPalace: DEFAULT_POURQUOI_PALACE,
    suite: DEFAULT_LA_SUITE
  };
}

// === Ouverture de la modale ===
export function openFicheClientEditor() {
  // Si une fiche client existe déjà → on la charge
  const stored = window._currentFicheClient;
  const model = stored ? { ...buildDefaultFromDevis(), ...stored } : buildDefaultFromDevis();

  const modal = document.getElementById('ficheClientModal');
  const body = document.getElementById('ficheClientEditorBody');
  body.innerHTML = renderEditorHTML(model);
  modal.classList.remove('hidden');
  wireEditorActions();
}

export function closeFicheClientEditor() {
  document.getElementById('ficheClientModal').classList.add('hidden');
}

// === Rendu de la modale d'édition ===
function renderEditorHTML(m) {
  return `
    <div class="fcEditorHeader">
      <h2 style="margin:0">📋 Fiche client — Proposition de privatisation</h2>
      <p class="legend" style="margin:4px 0 0">Tous les champs sont modifiables avant génération du PDF. Les zones en jaune correspondent aux infos à personnaliser.</p>
    </div>

    <div class="fcSection">
      <h3>En-tête</h3>
      <div class="fcGrid2">
        <div>
          <label>À l'attention de</label>
          <input type="text" id="fcAttention" value="${escapeAttr(m.attention)}" placeholder="Ex : Camille Forestier — Agence Émile Events">
        </div>
        <div>
          <label>Date envisagée</label>
          <input type="text" id="fcDateEnvisagee" value="${escapeAttr(m.dateEnvisagee)}" placeholder="Ex : vendredi 28 novembre 2025">
        </div>
        <div>
          <label>Établie le</label>
          <input type="date" id="fcEtablieLe" value="${escapeAttr(m.etablieLe)}">
        </div>
      </div>
    </div>

    <div class="fcSection">
      <h3>Le projet, tel qu'on l'imagine pour vous</h3>
      <textarea id="fcIntro" rows="4" placeholder="Reformule en quelques lignes le besoin entendu, le contexte, ce que tu proposes...">${escapeHtml(m.intro)}</textarea>
    </div>

    <div class="fcSection">
      <h3>Notre recommandation</h3>
      <label>Titre de la recommandation</label>
      <input type="text" id="fcRecommandationTitre" value="${escapeAttr(m.recommandationTitre)}">
      <label>Description courte (intro de la reco)</label>
      <textarea id="fcRecommandationIntro" rows="2">${escapeHtml(m.recommandationIntro)}</textarea>

      <div class="fcSubBlock">
        <div class="fcRowHeader">
          <strong>Programme de la soirée</strong>
          <button type="button" class="fcSmall" id="fcAddProgramme">+ Ajouter un moment</button>
        </div>
        <table class="fcProgrammeTable">
          <thead><tr><th style="width:120px">Heure</th><th>Déroulé</th><th style="width:36px"></th></tr></thead>
          <tbody id="fcProgrammeBody">
            ${(m.programme.length > 0 ? m.programme : [{ heure: '', deroule: '' }]).map(p => fcProgrammeRow(p.heure, p.deroule)).join('')}
          </tbody>
        </table>
      </div>

      <label style="margin-top:14px">Points forts (1 ligne par puce)</label>
      <textarea id="fcPointsForts" rows="4">${escapeHtml(m.pointsForts)}</textarea>
    </div>

    <div class="fcSection">
      <h3>Budget</h3>
      <div class="fcRowHeader">
        <span class="legend">Lignes pré-remplies depuis le devis (Vue client). Modifiables.</span>
        <button type="button" class="fcSmall" id="fcAddBudget">+ Ajouter une ligne</button>
      </div>
      <table class="fcBudgetTable">
        <thead><tr><th>Prestation</th><th style="width:160px">Montant</th><th style="width:36px"></th></tr></thead>
        <tbody id="fcBudgetBody">
          ${(m.budgetLignes.length > 0 ? m.budgetLignes : [{ libelle: '', montant: 0 }]).map(b => fcBudgetRow(b.libelle, b.montant)).join('')}
        </tbody>
      </table>
      <div class="fcBudgetTotal">
        <span>Total HT</span>
        <strong id="fcBudgetTotal">${fmt(m.budgetTotal)}</strong>
      </div>
    </div>

    <div class="fcSection">
      <h3>Pourquoi le Palace</h3>
      <p class="legend">1 ligne par puce</p>
      <textarea id="fcPourquoiPalace" rows="6">${escapeHtml(m.pourquoiPalace)}</textarea>
    </div>

    <div class="fcSection">
      <h3>La suite, simplement</h3>
      <textarea id="fcSuite" rows="3">${escapeHtml(m.suite)}</textarea>
    </div>

    <div class="fcSection fcSignaturePreview">
      <h3>Signature (figée)</h3>
      <p style="font-size:0.88em">${SIGNATURE_LINES.map(escapeHtml).join('<br>')}</p>
    </div>

    <div class="modalActions">
      <button type="button" onclick="closeFicheClientEditor()">Fermer</button>
      <button type="button" id="fcSaveBtn">Enregistrer</button>
      <button type="button" id="fcPdfBtn" class="primary">📄 Générer le PDF</button>
    </div>
  `;
}

function fcProgrammeRow(heure, deroule) {
  return `<tr>
    <td><input type="text" class="fc-prog-heure" value="${escapeAttr(heure)}" placeholder="19h30"></td>
    <td><textarea class="fc-prog-deroule" rows="1">${escapeHtml(deroule)}</textarea></td>
    <td><button type="button" class="delete fc-prog-del" title="Supprimer">×</button></td>
  </tr>`;
}
function fcBudgetRow(libelle, montant) {
  return `<tr>
    <td><input type="text" class="fc-bud-libelle" value="${escapeAttr(libelle)}"></td>
    <td><input type="number" class="fc-bud-montant" step="0.01" min="0" value="${montant != null ? Math.round(montant * 100) / 100 : 0}"></td>
    <td><button type="button" class="delete fc-bud-del" title="Supprimer">×</button></td>
  </tr>`;
}

// === Lecture du formulaire ===
function readEditor() {
  const programme = Array.from(document.querySelectorAll('#fcProgrammeBody tr')).map(tr => ({
    heure:   tr.querySelector('.fc-prog-heure')?.value.trim() || '',
    deroule: tr.querySelector('.fc-prog-deroule')?.value.trim() || ''
  })).filter(p => p.heure || p.deroule);
  const budgetLignes = Array.from(document.querySelectorAll('#fcBudgetBody tr')).map(tr => ({
    libelle: tr.querySelector('.fc-bud-libelle')?.value.trim() || '',
    montant: Number(tr.querySelector('.fc-bud-montant')?.value || 0)
  })).filter(b => b.libelle || b.montant > 0);
  const budgetTotal = budgetLignes.reduce((s, b) => s + b.montant, 0);
  return {
    attention:           document.getElementById('fcAttention').value.trim(),
    dateEnvisagee:       document.getElementById('fcDateEnvisagee').value.trim(),
    etablieLe:           document.getElementById('fcEtablieLe').value,
    intro:               document.getElementById('fcIntro').value,
    recommandationTitre: document.getElementById('fcRecommandationTitre').value.trim(),
    recommandationIntro: document.getElementById('fcRecommandationIntro').value,
    programme,
    pointsForts:         document.getElementById('fcPointsForts').value,
    budgetLignes,
    budgetTotal,
    pourquoiPalace:      document.getElementById('fcPourquoiPalace').value,
    suite:               document.getElementById('fcSuite').value
  };
}

// === Wire actions ===
function wireEditorActions() {
  document.getElementById('fcAddProgramme')?.addEventListener('click', () => {
    document.getElementById('fcProgrammeBody').insertAdjacentHTML('beforeend', fcProgrammeRow('', ''));
    wireRowDeletes();
  });
  document.getElementById('fcAddBudget')?.addEventListener('click', () => {
    document.getElementById('fcBudgetBody').insertAdjacentHTML('beforeend', fcBudgetRow('', 0));
    wireRowDeletes();
    wireBudgetTotals();
  });
  document.getElementById('fcSaveBtn')?.addEventListener('click', async () => {
    const data = readEditor();
    window._currentFicheClient = data;
    try {
      await saveFiche();
      showToast('Fiche client enregistrée dans la fiche devis', 'success', 2000);
    } catch (e) {
      showToast(`Échec enregistrement : ${e.body?.error || e.message}`, 'error');
    }
  });
  document.getElementById('fcPdfBtn')?.addEventListener('click', () => {
    const data = readEditor();
    window._currentFicheClient = data;
    generatePdf(data);
  });
  wireRowDeletes();
  wireBudgetTotals();
}

function wireRowDeletes() {
  document.querySelectorAll('.fc-prog-del, .fc-bud-del').forEach(b => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', () => {
      b.closest('tr')?.remove();
      wireBudgetTotals();
    });
  });
  document.querySelectorAll('.fc-bud-montant').forEach(i => {
    if (i.dataset.wired) return;
    i.dataset.wired = '1';
    i.addEventListener('input', updateTotal);
  });
}

function wireBudgetTotals() {
  document.querySelectorAll('.fc-bud-montant').forEach(i => {
    if (i.dataset.wiredTot) return;
    i.dataset.wiredTot = '1';
    i.addEventListener('input', updateTotal);
  });
  updateTotal();
}

function updateTotal() {
  const total = Array.from(document.querySelectorAll('.fc-bud-montant'))
    .reduce((s, i) => s + (Number(i.value) || 0), 0);
  const el = document.getElementById('fcBudgetTotal');
  if (el) el.textContent = fmt(total);
}

// === Génération du PDF (popup HTML A4 imprimable) ===
function generatePdf(m) {
  const html = renderPdfHTML(m);
  const win = window.open('', '_blank');
  if (!win) {
    showToast('Pop-up bloquée — autorise les pop-ups pour générer le PDF', 'error', 4000);
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => { try { win.print(); } catch {} }, 600);
}

function renderPdfHTML(m) {
  const dateEvent = m.dateEnvisagee || '— à définir —';
  const etablieLe = m.etablieLe ? new Date(m.etablieLe).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : todayFR();
  const points = lignesNet(m.pointsForts);
  const pourquoi = lignesNet(m.pourquoiPalace);
  const programmeRows = m.programme.length > 0
    ? m.programme.map(p => `<tr><td class="hour">${escapeHtml(p.heure)}</td><td>${escapeHtml(p.deroule)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">— Programme à définir —</td></tr>';
  const budgetRows = m.budgetLignes.length > 0
    ? m.budgetLignes.map(b => `<tr><td>${escapeHtml(b.libelle)}</td><td class="amount">${fmt(b.montant)} HT</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">— À compléter —</td></tr>';

  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<title>Proposition de privatisation — ${escapeHtml(m.attention || 'Palace Comedy')}</title>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { font-family: 'Lexend', -apple-system, sans-serif; color: #1a1a1a; line-height: 1.55; font-size: 11pt; margin: 0; }
  body { background: white; }
  .pdfBanner { background: #1a1f3c; color: #f3e5d8; padding: 18px 24px; margin: 0 -16mm 22px; font-size: 9pt; letter-spacing: 0.04em; }
  .pdfBanner strong { color: white; font-weight: 600; }
  .pdfBanner img { height: 32px; vertical-align: middle; margin-right: 14px; }
  h1.pdfTitle { font-size: 22pt; font-weight: 700; color: #1a1f3c; letter-spacing: -0.02em; margin: 0 0 16px; }
  h2 { font-size: 13pt; color: #1a1f3c; margin: 22px 0 10px; font-weight: 600; border-bottom: 2px solid #6366f1; padding-bottom: 4px; }
  h3 { font-size: 11pt; color: #1a1f3c; margin: 14px 0 6px; font-weight: 600; }
  p, li { font-size: 10.5pt; }
  .pdfHeaderTable { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10pt; }
  .pdfHeaderTable td { padding: 6px 10px; border: 1px solid #e5e7eb; }
  .pdfHeaderTable td:first-child { background: #f9fafb; font-weight: 600; width: 36%; color: #1a1f3c; }
  .pdfYellow { background: #fff7cc; padding: 1px 4px; border-radius: 2px; }
  .pdfRecommandationIntro { font-style: italic; color: #4b5563; margin-bottom: 12px; }
  .pdfProgramme { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; }
  .pdfProgramme th { background: #1a1f3c; color: white; padding: 8px 10px; text-align: left; font-weight: 500; }
  .pdfProgramme td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .pdfProgramme td.hour { font-weight: 600; color: #6366f1; white-space: nowrap; width: 90px; }
  .pdfProgramme td.empty { font-style: italic; color: #9ca3af; text-align: center; padding: 14px; }
  .pdfPoints { list-style: none; padding: 0; margin: 8px 0; }
  .pdfPoints li { padding: 4px 0 4px 22px; position: relative; }
  .pdfPoints li::before { content: '◆'; color: #6366f1; position: absolute; left: 6px; font-size: 0.7em; top: 8px; }
  .pdfBudget { width: 100%; border-collapse: collapse; margin: 8px 0 6px; font-size: 10.5pt; }
  .pdfBudget th { background: #1a1f3c; color: white; padding: 8px 10px; text-align: left; font-weight: 500; }
  .pdfBudget td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .pdfBudget td.amount { text-align: right; font-weight: 600; color: #1a1f3c; white-space: nowrap; }
  .pdfBudget td.empty { font-style: italic; color: #9ca3af; text-align: center; }
  .pdfBudgetTotal { display: flex; justify-content: flex-end; gap: 30px; padding: 12px 10px; background: #f9fafb; border-top: 2px solid #1a1f3c; font-weight: 700; font-size: 12pt; color: #1a1f3c; }
  .pdfNote { font-size: 9pt; color: #6b7280; font-style: italic; margin-top: 4px; }
  .pdfIntroText { white-space: pre-wrap; }
  .pdfSignature { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 10pt; line-height: 1.7; color: #1a1f3c; }
  .pdfSignature strong { display: block; font-size: 11pt; }
  .pdfFooter { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #6b7280; text-align: center; }
  @media print { .pdfNoPrint { display: none; } }
</style>
</head><body>

<div class="pdfBanner">
  <img src="${window.location.origin}/assets/logo-palace.svg" alt="Palace Comedy">
  <strong>PALACE COMEDY</strong> · Comedy Club &amp; Restaurant · 16 rue Louis de Romain, 49100 Angers · Ancien cinéma Galerie Palace
</div>

<h1 class="pdfTitle">PROPOSITION DE PRIVATISATION</h1>

<table class="pdfHeaderTable">
  <tr><td>À l'attention de</td><td class="pdfYellow">${escapeHtml(m.attention) || '—'}</td></tr>
  <tr><td>Date envisagée</td><td class="pdfYellow">${escapeHtml(dateEvent)}</td></tr>
  <tr><td>Établie le</td><td>${escapeHtml(etablieLe)}, par Lucie CLÉMENT</td></tr>
</table>

${m.intro ? `<h2>Le projet, tel qu'on l'imagine pour vous</h2><p class="pdfIntroText">${escapeHtml(m.intro)}</p>` : ''}

<h2>${escapeHtml(m.recommandationTitre || 'Notre recommandation')}</h2>
${m.recommandationIntro ? `<p class="pdfRecommandationIntro">${escapeHtml(m.recommandationIntro)}</p>` : ''}

<h3>Programme de la soirée</h3>
<table class="pdfProgramme">
  <thead><tr><th>Moment</th><th>Déroulé</th></tr></thead>
  <tbody>${programmeRows}</tbody>
</table>

${points.length > 0 ? `<h3>Ce qui est inclus</h3><ul class="pdfPoints">${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}

<h2>Budget</h2>
<table class="pdfBudget">
  <thead><tr><th>Prestation</th><th style="text-align:right">Montant</th></tr></thead>
  <tbody>${budgetRows}</tbody>
</table>
<div class="pdfBudgetTotal"><span>Total HT</span><span>${fmt(m.budgetTotal)} HT</span></div>
<p class="pdfNote">Tarifs indicatifs personnalisables selon le nombre final de convives et les options retenues.</p>

<h2>Pourquoi le Palace</h2>
<ul class="pdfPoints">
  ${pourquoi.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
</ul>

<h2>La suite, simplement</h2>
<p>${escapeHtml(m.suite)}</p>

<div class="pdfSignature">
  <strong>${escapeHtml(SIGNATURE_LINES[0].split(' — ')[0])}</strong>
  ${escapeHtml(SIGNATURE_LINES[0].split(' — ')[1] || '')}<br>
  ${escapeHtml(SIGNATURE_LINES[1])}<br>
  <span style="font-size:9pt;color:#6b7280">${escapeHtml(SIGNATURE_LINES[2])}</span>
</div>

<div class="pdfFooter">Document confidentiel — Palace Comedy ${new Date().getFullYear()}</div>

<div class="pdfNoPrint" style="margin-top:16px;text-align:center">
  <button onclick="window.print()" style="padding:10px 24px;background:#6366f1;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer">Imprimer / Enregistrer en PDF</button>
</div>

</body></html>`;
}
