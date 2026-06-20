// Bascule d'onglets (Simulateur / Bibliothèque items / Bibliothèque formules / Paliers / Calendrier).

import { renderCalendrier } from './calendrier.js';

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('hidden', c.id !== 'tab' + name.charAt(0).toUpperCase() + name.slice(1));
  });
  if (name === 'calendrier') renderCalendrier();
}
