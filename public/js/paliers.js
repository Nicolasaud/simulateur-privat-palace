// Paliers de personnel (table extensible + persistée via API).

import { recalcul } from './calcul.js';
import { getPaliers, putPaliers, scheduleFlush } from './api.js';

function getPaliersFromDOM() {
  const rows = document.querySelectorAll('#paliersTable tbody tr');
  const out = [];
  rows.forEach(r => {
    const inputs = r.querySelectorAll('input');
    out.push({
      seuil: parseFloat(inputs[0].value) || 0,
      staff: parseFloat(inputs[1].value) || 0
    });
  });
  return out;
}

function persistPaliers() {
  scheduleFlush('paliers', () => putPaliers(getPaliersFromDOM()));
}

export async function loadPaliersFromCloud() {
  try {
    const paliers = await getPaliers();
    if (!Array.isArray(paliers) || paliers.length === 0) return;
    const tbody = document.querySelector('#paliersTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    paliers.forEach(p => {
      tbody.appendChild(makePalierRow(p.seuil, p.staff));
    });
  } catch (e) {
    console.error('Lecture paliers cloud échouée', e);
  }
}

function makePalierRow(seuil, staff) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="number" value="${seuil}"></td>
    <td><input type="number" value="${staff}"></td>
    <td class="num"><button class="delete" onclick="deletePalier(this)" style="padding:3px 7px">×</button></td>
  `;
  return tr;
}

export function addPalier() {
  const tbody = document.querySelector('#paliersTable tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  let seuilSuggere = 30, staffSuggere = 4;
  if (rows.length > 0) {
    const last = rows[rows.length - 1].querySelectorAll('input');
    seuilSuggere = (parseFloat(last[0].value) || 0) + 30;
    staffSuggere = (parseFloat(last[1].value) || 0) + 1;
  }
  tbody.appendChild(makePalierRow(seuilSuggere, staffSuggere));
  persistPaliers();
  recalcul();
}

export function deletePalier(btn) {
  const tr = btn.closest('tr');
  if (!tr) return;
  const tbody = tr.parentElement;
  if (tbody.querySelectorAll('tr').length <= 1) {
    alert('Tu dois conserver au moins un palier.');
    return;
  }
  tr.remove();
  persistPaliers();
  recalcul();
}

export function registerPaliersListeners() {
  document.addEventListener('input', e => {
    if (e.target.closest('#paliersTable')) persistPaliers();
  });
}
