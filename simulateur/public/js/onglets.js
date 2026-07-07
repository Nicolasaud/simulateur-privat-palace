// Bascule d'onglets (Accueil / CRM / Calendrier / Simulateur).

import { renderCalendrier } from './calendrier.js';
import { renderCrmTable, renderCrmKanban, initCrmFilters, renderCrmTodoSemaine, renderCrmTodoManual } from './crm.js';
import { renderAccueil } from './accueil.js';
import { renderBibliotheque, renderBibliothequeItems, loadBibliothequeLibre } from './bibliotheque-libre.js';
import { renderBlocs } from './blocs-ui.js';

let crmInitialized = false;
let bibInitialized = false;
let bibItemsInitialized = false;

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('hidden', c.id !== 'tab' + name.charAt(0).toUpperCase() + name.slice(1));
  });
  const ficheBarSimu = document.querySelector('.ficheBarSimu');
  if (ficheBarSimu) ficheBarSimu.classList.toggle('hidden', name !== 'simulateur');

  if (name === 'accueil') renderAccueil();
  if (name === 'calendrier') renderCalendrier();
  if (name === 'simulateur') {
    // Re-rendu des blocs pour refléter d'éventuelles nouvelles formules libres
    // créées dans la Bibliothèque (Étape 6 — formules composables).
    renderBlocs();
  }
  if (name === 'crm') {
    if (!crmInitialized) { initCrmFilters(); crmInitialized = true; }
    renderCrmTodoSemaine();
    renderCrmTodoManual();
    renderCrmTable();
    renderCrmKanban();
  }
  if (name === 'bibliotheque') {
    if (!bibInitialized) {
      loadBibliothequeLibre().then(() => renderBibliotheque());
      bibInitialized = true;
    } else {
      renderBibliotheque();
    }
  }
  if (name === 'bibitems') {
    if (!bibItemsInitialized) {
      loadBibliothequeLibre().then(() => renderBibliothequeItems());
      bibItemsInitialized = true;
    } else {
      renderBibliothequeItems();
    }
  }
}
