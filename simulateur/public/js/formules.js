// Bibliothèque de formules complètes (composition d'items réutilisable).

import { $, fmt, fmtPct } from './helpers.js';
import { state } from './state.js';
import { renderItems } from './items.js';
import { recalcul } from './calcul.js';
import { setDirty, nowIso } from './fiches.js';
import { getFormules, putFormules, scheduleFlush } from './api.js';

export async function loadFormulesFromCloud() {
  try {
    const list = await getFormules();
    state.formulesList = Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Lecture formules cloud échouée', e);
    state.formulesList = [];
  }
}

export function persistFormules() {
  scheduleFlush('formules', () => putFormules(state.formulesList));
}

function formuleFeedback(msg, type = 'ok') {
  const el = $('formuleFeedback');
  if (!el) return;
  const colors = { ok: '#0a5c2c', warn: '#7a4400', err: '#8a1a1a' };
  el.textContent = msg;
  el.style.color = colors[type] || '#666';
  setTimeout(() => { if (el.textContent === msg) { el.innerHTML = '&nbsp;'; el.style.color = '#666'; } }, 3000);
}

function calcFormuleStats(formuleItems) {
  const totalCout = formuleItems.reduce((s, i) => s + (i.coutHT || 0), 0);
  const totalPrix = formuleItems.reduce((s, i) => s + (i.prixHT || 0), 0);
  const margePers = totalPrix - totalCout;
  const taux = totalPrix > 0 ? (margePers / totalPrix) * 100 : 0;
  return { totalCout, totalPrix, margePers, taux };
}

export function refreshFormulesTable() {
  const tbody = document.querySelector('#formulesTable tbody');
  if (!tbody) return;
  if (state.formulesList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px">Aucune formule enregistrée pour le moment. Compose une formule dans la sidebar puis « Capturer formule courante » ci-dessous.</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  state.formulesList.forEach(formule => {
    const stats = calcFormuleStats(formule.items);
    const couleur = stats.taux >= 60 ? '#0a5c2c' : stats.taux >= 40 ? '#7a4400' : '#8a1a1a';
    const itemsLabel = formule.items.map(i => i.libelle).join(' · ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:6px"><strong>${formule.nom.replace(/</g, '&lt;')}</strong></td>
      <td style="padding:6px;font-size:0.85em;color:#666">${itemsLabel.replace(/</g, '&lt;')}</td>
      <td class="num" style="padding:6px">${fmt(stats.totalPrix)}</td>
      <td class="num" style="padding:6px;color:${couleur};font-weight:500">${fmtPct(stats.taux)}</td>
      <td class="num" style="padding:6px;white-space:nowrap">
        <button onclick="formuleCharger({value:'${formule.id}'})" style="padding:3px 8px;font-size:0.85em">Charger</button>
        <button class="delete" onclick="formuleSupprimer('${formule.id}')" style="padding:3px 7px">×</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

export function refreshFormulesSelect() {
  const sel = $('formuleLoadSelect');
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = '<option value="">📚 Charger une formule complète...</option>';
  state.formulesList.forEach(f => {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = `${f.nom} (${f.items.length} items)`;
    sel.appendChild(o);
  });
  sel.value = '';
}

export function formuleCapture() {
  const nom = $('formuleNouveauNom').value.trim();
  if (!nom) { formuleFeedback('Nom de formule requis.', 'err'); return; }
  if (state.items.length === 0) { formuleFeedback('La formule courante est vide.', 'err'); return; }
  const dup = state.formulesList.find(f => f.nom.toLowerCase() === nom.toLowerCase());
  if (dup) {
    if (!confirm(`Une formule "${nom}" existe déjà. La remplacer par la composition actuelle ?`)) return;
    dup.items = JSON.parse(JSON.stringify(state.items));
    dup.dateModification = nowIso();
  } else {
    state.formulesList.push({
      id: 'fm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      nom,
      items: JSON.parse(JSON.stringify(state.items)),
      dateCreation: nowIso(),
      dateModification: nowIso()
    });
  }
  persistFormules();
  refreshFormulesTable();
  refreshFormulesSelect();
  $('formuleNouveauNom').value = '';
  formuleFeedback(`✓ Formule « ${nom} » enregistrée (${state.items.length} items).`);
}

export function formuleCharger(selectOrObj) {
  const id = selectOrObj.value;
  if (!id) return;
  const f = state.formulesList.find(x => x.id === id);
  if (!f) return;
  if (state.items.length > 0 && !confirm(`Remplacer la composition actuelle (${state.items.length} items) par la formule « ${f.nom} » (${f.items.length} items) ?`)) {
    if (selectOrObj.value !== undefined) selectOrObj.value = '';
    return;
  }
  state.items = JSON.parse(JSON.stringify(f.items));
  if (selectOrObj.value !== undefined && selectOrObj.tagName === 'SELECT') selectOrObj.value = '';
  renderItems();
  recalcul();
  setDirty(true);
}

export function formuleSupprimer(id) {
  const f = state.formulesList.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`Supprimer la formule « ${f.nom} » de la bibliothèque ?`)) return;
  state.formulesList = state.formulesList.filter(x => x.id !== id);
  persistFormules();
  refreshFormulesTable();
  refreshFormulesSelect();
}
