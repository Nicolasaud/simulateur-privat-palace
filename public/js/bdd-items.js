// Bibliothèque d'items restauration : CRUD, persistance cloud (API), édition inline.

import { $, fmt, fmtPct } from './helpers.js';
import { state } from './state.js';
import { renderItems } from './items.js';
import { recalcul } from './calcul.js';
import { getBddItems, putBddItems, scheduleFlush } from './api.js';

// Charge depuis le cloud. Appelé au boot et au rafraîchissement manuel.
export async function loadBddFromCloud() {
  try {
    const items = await getBddItems();
    state.bddItems = Array.isArray(items) ? items : [];
  } catch (e) {
    console.error('Lecture bdd-items cloud échouée', e);
    state.bddItems = [];
  }
}

// Sauvegarde debouncée (400 ms) : édition inline = beaucoup d'events.
export function persistBdd() {
  scheduleFlush('bdd-items', () => putBddItems(state.bddItems));
}

function bddFeedback(msg, type = 'ok') {
  const el = $('bddFeedback');
  if (!el) return;
  const colors = { ok: '#0a5c2c', warn: '#7a4400', err: '#8a1a1a' };
  el.textContent = msg;
  el.style.color = colors[type] || '#666';
  setTimeout(() => { if (el.textContent === msg) { el.innerHTML = '&nbsp;'; el.style.color = '#666'; } }, 3000);
}

export function refreshBddTable() {
  const tbody = document.querySelector('#bddItemsTable tbody');
  if (!tbody) return;
  if (state.bddItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#888;padding:18px">Aucun item enregistré pour le moment.</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  state.bddItems.forEach(item => {
    const tr = document.createElement('tr');
    tr.dataset.bddId = item.id;
    tr.innerHTML = `
      <td style="padding:4px 6px"><input type="text" value="${item.libelle.replace(/"/g, '&quot;')}" data-bdd-key="libelle" style="width:100%;padding:5px 7px;font-size:0.88em"></td>
      <td class="num" style="padding:4px 6px"><input type="number" value="${item.coutHT}" step="0.1" data-bdd-key="coutHT" style="width:100%;padding:5px 7px;font-size:0.88em;text-align:right"></td>
      <td class="num" style="padding:4px 6px"><input type="number" value="${item.prixHT}" step="0.1" data-bdd-key="prixHT" style="width:100%;padding:5px 7px;font-size:0.88em;text-align:right"></td>
      <td style="padding:4px 6px">
        <select data-bdd-key="tvaCat" style="width:100%;padding:5px 7px;font-size:0.88em">
          <option value="restauration"${item.tvaCat==='restauration'?' selected':''}>Resto 10%</option>
          <option value="bar"${item.tvaCat==='bar'?' selected':''}>Bar 20%</option>
        </select>
      </td>
      <td class="num" data-bdd-marge style="padding:4px 6px"></td>
      <td class="num" style="padding:4px 6px"><button class="delete" data-bdd-action="delete" style="padding:3px 7px">×</button></td>
    `;
    tbody.appendChild(tr);
  });
  refreshAllBddMarges();
}

function refreshAllBddMarges() {
  state.bddItems.forEach(item => {
    const tr = document.querySelector(`#bddItemsTable tr[data-bdd-id="${item.id}"]`);
    if (!tr) return;
    const cell = tr.querySelector('[data-bdd-marge]');
    if (!cell) return;
    const margePers = item.prixHT - item.coutHT;
    const taux = item.prixHT > 0 ? (margePers / item.prixHT) * 100 : 0;
    const couleur = taux >= 60 ? '#0a5c2c' : taux >= 40 ? '#7a4400' : '#8a1a1a';
    cell.innerHTML = `<span style="color:${couleur};font-weight:500">${fmtPct(taux)}</span>`;
  });
}

export function refreshBddSelect() {
  const sel = $('bddImportSelect');
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = '<option value="">+ Importer depuis base...</option>';
  state.bddItems.forEach(item => {
    const o = document.createElement('option');
    o.value = item.id;
    o.textContent = `${item.libelle} (${fmt(item.coutHT)} → ${fmt(item.prixHT)})`;
    sel.appendChild(o);
  });
  sel.value = previous && state.bddItems.some(b => b.id === previous) ? previous : '';
}

export function bddAjouter() {
  const libelle = $('bddNouveauLibelle').value.trim();
  const coutHT = parseFloat($('bddNouveauCout').value) || 0;
  const prixHT = parseFloat($('bddNouveauPrix').value) || 0;
  const tvaCat = $('bddNouveauTva').value;
  if (!libelle) { bddFeedback('Libellé requis.', 'err'); return; }
  if (prixHT <= 0) { bddFeedback('Prix HT doit être > 0.', 'err'); return; }
  if (state.bddItems.some(i => i.libelle.toLowerCase() === libelle.toLowerCase())) {
    if (!confirm(`Un item "${libelle}" existe déjà dans la base. Ajouter quand même ?`)) return;
  }
  state.bddItems.push({
    id: 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    libelle, coutHT, prixHT, tvaCat
  });
  persistBdd();
  refreshBddTable();
  refreshBddSelect();
  $('bddNouveauLibelle').value = '';
  $('bddNouveauCout').value = '';
  $('bddNouveauPrix').value = '';
  $('bddNouveauTva').value = 'restauration';
  bddFeedback(`✓ « ${libelle} » ajouté à la base.`);
}

export function importerDepuisBdd(selectEl) {
  const id = selectEl.value;
  if (!id) return;
  const src = state.bddItems.find(b => b.id === id);
  if (!src) return;
  state.items.push({
    libelle: src.libelle, coutHT: src.coutHT, prixHT: src.prixHT, tvaCat: src.tvaCat
  });
  selectEl.value = '';
  renderItems();
  recalcul();
}

export function saveItemToBdd(item, btnEl) {
  if (!item.libelle.trim()) { bddFeedback('Libellé vide, impossible d\'enregistrer.', 'err'); return; }
  if (item.prixHT <= 0) { bddFeedback('Prix HT doit être > 0.', 'err'); return; }
  const dup = state.bddItems.find(b => b.libelle.toLowerCase() === item.libelle.toLowerCase());
  if (dup) {
    if (!confirm(`« ${item.libelle} » existe déjà dans la base. Mettre à jour avec les valeurs actuelles (${fmt(item.coutHT)} → ${fmt(item.prixHT)}) ?`)) return;
    dup.coutHT = item.coutHT;
    dup.prixHT = item.prixHT;
    dup.tvaCat = item.tvaCat;
  } else {
    state.bddItems.push({
      id: 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      libelle: item.libelle, coutHT: item.coutHT, prixHT: item.prixHT, tvaCat: item.tvaCat
    });
  }
  persistBdd();
  refreshBddTable();
  refreshBddSelect();
  if (btnEl) {
    const old = btnEl.textContent;
    btnEl.textContent = '✓ enregistré';
    btnEl.style.color = '#0a5c2c';
    btnEl.style.borderColor = '#0a5c2c';
    setTimeout(() => { btnEl.textContent = old; btnEl.style.color = '#666'; btnEl.style.borderColor = 'rgba(0,0,0,0.15)'; }, 1500);
  }
}

export function registerBddListeners() {
  document.addEventListener('input', e => {
    const tr = e.target.closest('#bddItemsTable tr[data-bdd-id]');
    if (!tr) return;
    const key = e.target.dataset.bddKey;
    if (!key) return;
    const id = tr.dataset.bddId;
    const item = state.bddItems.find(b => b.id === id);
    if (!item) return;
    if (key === 'coutHT' || key === 'prixHT') item[key] = parseFloat(e.target.value) || 0;
    else item[key] = e.target.value;
    refreshAllBddMarges();
    refreshBddSelect();
    persistBdd();
  });

  document.addEventListener('change', e => {
    const tr = e.target.closest('#bddItemsTable tr[data-bdd-id]');
    if (!tr) return;
    const key = e.target.dataset.bddKey;
    if (!key) return;
    const id = tr.dataset.bddId;
    const item = state.bddItems.find(b => b.id === id);
    if (!item) return;
    item[key] = e.target.value;
    refreshAllBddMarges();
    refreshBddSelect();
    persistBdd();
  });

  document.addEventListener('click', e => {
    if (e.target.dataset && e.target.dataset.bddAction === 'delete') {
      const tr = e.target.closest('tr[data-bdd-id]');
      if (!tr) return;
      const id = tr.dataset.bddId;
      const item = state.bddItems.find(b => b.id === id);
      if (!item) return;
      if (!confirm(`Supprimer « ${item.libelle} » de la base ?`)) return;
      state.bddItems = state.bddItems.filter(b => b.id !== id);
      persistBdd();
      refreshBddTable();
      refreshBddSelect();
    }
  });
}
