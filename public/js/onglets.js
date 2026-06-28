// Bascule d'onglets (Accueil / CRM / Calendrier / Simulateur).

import { renderCalendrier } from './calendrier.js';
import { renderCrmTable, renderCrmKanban, initCrmFilters, renderCrmTodoSemaine, renderCrmTodoManual } from './crm.js';
import { renderAccueil } from './accueil.js';

let crmInitialized = false;

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('hidden', c.id !== 'tab' + name.charAt(0).toUpperCase() + name.slice(1));
  });
  if (name === 'accueil') renderAccueil();
  if (name === 'calendrier') renderCalendrier();
  if (name === 'crm') {
    if (!crmInitialized) { initCrmFilters(); crmInitialized = true; }
    renderCrmTodoSemaine();
    renderCrmTodoManual();
    renderCrmTable();
    renderCrmKanban();
  }
}
