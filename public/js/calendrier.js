// Calendrier mensuel : navigation et rendu des chips fiches par jour.

import { $ } from './helpers.js';
import { state } from './state.js';

export function calNav(delta) {
  state.calCurrentMonth += delta;
  if (state.calCurrentMonth < 0) { state.calCurrentMonth = 11; state.calCurrentYear--; }
  if (state.calCurrentMonth > 11) { state.calCurrentMonth = 0; state.calCurrentYear++; }
  renderCalendrier();
}

export function calToday() {
  const now = new Date();
  state.calCurrentMonth = now.getMonth();
  state.calCurrentYear = now.getFullYear();
  renderCalendrier();
}

export function renderCalendrier() {
  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const titleEl = $('calTitle');
  if (titleEl) titleEl.textContent = `${monthNames[state.calCurrentMonth]} ${state.calCurrentYear}`;

  const grid = $('calGrid');
  if (!grid) return;
  grid.innerHTML = '';

  ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'calCell dayHeader';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay = new Date(state.calCurrentYear, state.calCurrentMonth, 1);
  let startDayOfWeek = firstDay.getDay();
  startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const daysInMonth = new Date(state.calCurrentYear, state.calCurrentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(state.calCurrentYear, state.calCurrentMonth, 0).getDate();

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const cell = document.createElement('div');
    cell.className = 'calCell outsideMonth';
    cell.innerHTML = `<div class="dayNumber">${d}</div>`;
    grid.appendChild(cell);
  }

  const today = new Date();
  const isCurrentMonth = (state.calCurrentMonth === today.getMonth() && state.calCurrentYear === today.getFullYear());

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'calCell';
    if (isCurrentMonth && d === today.getDate()) cell.classList.add('today');

    const dateStr = `${state.calCurrentYear}-${String(state.calCurrentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const fichesJour = state.fichesList.filter(f => f.dateEvent === dateStr);

    let chipsHTML = `<div class="dayNumber">${d}</div>`;
    const maxVisible = 3;
    fichesJour.slice(0, maxVisible).forEach(f => {
      const statut = f.statut || 'brouillon';
      const label = (f.client || f.nomFiche || '?').replace(/"/g, '&quot;');
      const shortLabel = label.length > 14 ? label.slice(0, 13) + '…' : label;
      chipsHTML += `<div class="ficheChip ${statut}" onclick="event.stopPropagation();openFicheModal('${f.id}')" title="${label} — ${statut}">${shortLabel}</div>`;
    });
    if (fichesJour.length > maxVisible) {
      const reste = fichesJour.length - maxVisible;
      chipsHTML += `<div class="ficheChipMore" onclick="openDayModal('${dateStr}')">+ ${reste} autre${reste>1?'s':''}</div>`;
    }
    cell.innerHTML = chipsHTML;
    grid.appendChild(cell);
  }

  const totalCells = startDayOfWeek + daysInMonth;
  const targetTotal = totalCells <= 35 ? 35 : 42;
  const remainingCells = targetTotal - totalCells;
  for (let d = 1; d <= remainingCells; d++) {
    const cell = document.createElement('div');
    cell.className = 'calCell outsideMonth';
    cell.innerHTML = `<div class="dayNumber">${d}</div>`;
    grid.appendChild(cell);
  }
}
