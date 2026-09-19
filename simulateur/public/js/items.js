// Items de la formule sur mesure : rendu, marges, total formule, ajout/suppression.

import { $, fmt, fmtPct } from './helpers.js';
import { state } from './state.js';
import { recalcul } from './calcul.js';
import { saveItemToBdd } from './bdd-items.js';

export function renderItems() {
  const list = $('itemsList');
  // Cleanup commit 7 : l'UI mono #itemsList a été supprimée du DOM.
  // renderItems devient no-op (les appels restants sont des reliquats).
  // Les items resto sont désormais rendus PAR BLOC via blocs-ui.js.
  if (!list) return;
  list.innerHTML = '';
  state.items.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input type="text" value="${item.libelle.replace(/"/g, '&quot;')}" placeholder="Libellé" data-key="libelle" data-i="${i}">
      <input type="number" value="${item.coutHT}" step="0.1" placeholder="Coût €/p" data-key="coutHT" data-i="${i}" style="text-align:right">
      <input type="number" value="${item.prixHT}" step="0.1" placeholder="Prix €/p" data-key="prixHT" data-i="${i}" style="text-align:right">
      <select data-key="tvaCat" data-i="${i}">
        <option value="restauration"${item.tvaCat==='restauration'?' selected':''}>Resto 10%</option>
        <option value="bar"${item.tvaCat==='bar'?' selected':''}>Bar 20%</option>
      </select>
      <button class="delete" data-action="delete-item" data-i="${i}" title="Supprimer">×</button>
    `;
    list.appendChild(row);

    const margeRow = document.createElement('div');
    margeRow.dataset.margeI = i;
    margeRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:0.72em;color:#666;padding:0 4px 6px 8px;border-bottom:1px dotted rgba(0,0,0,0.06);margin-bottom:4px;gap:8px';
    list.appendChild(margeRow);
  });
  refreshAllMarges();
}

export function refreshAllMarges() {
  state.items.forEach((item, i) => {
    const row = document.querySelector(`#itemsList [data-marge-i="${i}"]`);
    if (!row) return;
    const margePers = item.prixHT - item.coutHT;
    const tauxMargeBrute = item.prixHT > 0 ? (margePers / item.prixHT) * 100 : 0;
    const couleur = tauxMargeBrute >= 60 ? '#0a5c2c' : tauxMargeBrute >= 40 ? '#7a4400' : '#8a1a1a';
    row.innerHTML = `
      <span>marge / pers : <strong>${fmt(margePers)}</strong></span>
      <span style="color:${couleur}">marge brute : <strong>${fmtPct(tauxMargeBrute)}</strong></span>
      <button data-action="save-to-bdd" data-i="${i}" title="Enregistrer dans la base d'items" style="padding:1px 6px;font-size:0.95em;background:transparent;border:1px solid rgba(0,0,0,0.15);border-radius:4px;cursor:pointer;color:#666;flex-shrink:0">+ base</button>
    `;
  });
  refreshFormuleTotal();
}

export function refreshFormuleTotal() {
  const totalCoutPers = state.items.reduce((s, i) => s + i.coutHT, 0);
  const totalPrixPers = state.items.reduce((s, i) => s + i.prixHT, 0);
  const totalMargePers = totalPrixPers - totalCoutPers;
  const totalTauxMarge = totalPrixPers > 0 ? (totalMargePers / totalPrixPers) * 100 : 0;
  const box = $('formuleTotalBox');
  if (!box) return;
  if (state.items.length > 0) {
    box.style.display = 'block';
    $('formuleMargePers').textContent = `${fmt(totalMargePers)} / pers (${fmt(totalCoutPers)} coût → ${fmt(totalPrixPers)} prix)`;
    const c = totalTauxMarge >= 60 ? '#0a5c2c' : totalTauxMarge >= 40 ? '#7a4400' : '#8a1a1a';
    $('formuleMargeTaux').innerHTML = `<span style="color:${c};font-weight:600">${fmtPct(totalTauxMarge)} brute</span>`;
  } else {
    box.style.display = 'none';
  }
}

export function addItem() {
  state.items.push({ libelle: 'Nouvel item', coutHT: 0, prixHT: 0, tvaCat: 'restauration' });
  renderItems();
  recalcul();
}

export function registerItemsListeners() {
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset && t.dataset.i !== undefined && t.closest('#itemsList')) {
      const i = parseInt(t.dataset.i);
      const key = t.dataset.key;
      if (key === 'coutHT' || key === 'prixHT') state.items[i][key] = parseFloat(t.value) || 0;
      else state.items[i][key] = t.value;
      refreshAllMarges();
      recalcul();
    } else {
      recalcul();
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.i !== undefined && t.closest('#itemsList')) {
      const i = parseInt(t.dataset.i);
      const key = t.dataset.key;
      state.items[i][key] = t.value;
      refreshAllMarges();
      recalcul();
    } else {
      recalcul();
    }
  });
  document.addEventListener('click', e => {
    if (e.target.dataset && e.target.dataset.action === 'delete-item') {
      const i = parseInt(e.target.dataset.i);
      state.items.splice(i, 1);
      renderItems();
      recalcul();
    }
    if (e.target.dataset && e.target.dataset.action === 'save-to-bdd' && e.target.closest('#itemsList')) {
      const i = parseInt(e.target.dataset.i);
      saveItemToBdd(state.items[i], e.target);
    }
  });
}
