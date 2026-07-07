// Calendrier mensuel : navigation et rendu des chips fiches par jour.

import { $ } from './helpers.js';
import { state } from './state.js';
import { ensureMonthLoaded, countArtistesForDate, hasProgrammation } from './programmation.js';

// Mapping compact des types internes pour l'affichage calendrier.
const TYPE_SHORT_LABEL = {
  'privat-full': 'Show',
  'privat-salle': 'Salle',
  'atelier-cocktail': 'Cocktail',
  'formation-impro': 'Impro',
  'groupe-classique': 'Groupe'
};

// Construit un label compact des formules d'une fiche pour le calendrier.
// - 1 formule  → null (rien à afficher, comportement mono inchangé)
// - 2 formules → "Show + Cocktail"
// - 3+         → "3 formules"
function compactFormulesLabel(types) {
  if (!Array.isArray(types) || types.length <= 1) return null;
  if (types.length >= 3) return `${types.length} formules`;
  return types.map(t => TYPE_SHORT_LABEL[t] || t).join(' + ');
}

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

  // Multi-mois : si la prog est affichée, charger en arrière-plan le mois
  // courant ET celui d'avant/après si une cellule "outsideMonth" est rendue
  // (les 3 mois min couvrent toute la grille 6x7 vue).
  if (state.showProgrammation) {
    const cur = `${state.calCurrentYear}-${String(state.calCurrentMonth + 1).padStart(2, '0')}`;
    const prevDate = new Date(state.calCurrentYear, state.calCurrentMonth - 1, 1);
    const nextDate = new Date(state.calCurrentYear, state.calCurrentMonth + 1, 1);
    const prev = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const next = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
    Promise.all([ensureMonthLoaded(cur), ensureMonthLoaded(prev), ensureMonthLoaded(next)])
      .then(() => {
        // Re-render seulement si on est toujours sur le même mois
        if (state.calCurrentYear === parseInt(cur.slice(0,4)) && state.calCurrentMonth === parseInt(cur.slice(5,7)) - 1) {
          _renderGrid();
        }
      });
  }

  _renderGrid();
}

function _renderGrid() {
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

    // Le numéro du jour est cliquable pour ouvrir la modal — permet d'éditer
    // la programmation même sur un jour sans fiche ni chip (Phase 2b4).
    let chipsHTML = `<div class="dayNumber" onclick="openDayModal('${dateStr}')" style="cursor:pointer" title="Ouvrir le détail du jour">${d}</div>`;
    const maxVisible = 3;
    fichesJour.slice(0, maxVisible).forEach(f => {
      const statut = f.statut || 'brouillon';
      const label = (f.client || f.nomFiche || '?').replace(/"/g, '&quot;');
      const shortLabel = label.length > 14 ? label.slice(0, 13) + '…' : label;
      const compact = compactFormulesLabel(f.formulesTypes);
      const titleExt = compact ? ` — ${compact}` : '';
      const subLine = compact
        ? `<div class="ficheChipFormules">${compact}</div>`
        : '';
      const chipCls = compact ? `ficheChip ${statut} multi` : `ficheChip ${statut}`;
      chipsHTML += `<div class="${chipCls}" onclick="event.stopPropagation();openFicheModal('${f.id}')" title="${label} — ${statut}${titleExt}">${shortLabel}${subLine}</div>`;
    });
    if (fichesJour.length > maxVisible) {
      const reste = fichesJour.length - maxVisible;
      chipsHTML += `<div class="ficheChipMore" onclick="openDayModal('${dateStr}')">+ ${reste} autre${reste>1?'s':''}</div>`;
    }

    // Programmation artistique — chip discret si toggle activé et au moins
    // un artiste/note ce jour-là. Click → modal détail jour (openDayModal).
    if (state.showProgrammation && hasProgrammation(dateStr)) {
      const n = countArtistesForDate(dateStr);
      const label = n > 0 ? `🎤 ${n} artiste${n > 1 ? 's' : ''}` : '🎤 note';
      chipsHTML += `<div class="progChip" onclick="event.stopPropagation();openDayModal('${dateStr}')" title="Voir la programmation du jour">${label}</div>`;
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
