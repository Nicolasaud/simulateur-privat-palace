// Programmation artistique mensuelle — gestion RAM + I/O cloud.
//
// state.programmationMonths est un cache : { 'YYYY-MM': { 'YYYY-MM-DD': [creneaux] } }.
// Le calendrier consomme directement ce cache via getCreneauxForDate(dateStr).
// Les fetch sont déclenchés à la demande quand on navigue vers un mois pas
// encore chargé (ensureMonthLoaded), et idempotents.
//
// Au commit 2b2 : lecture seule (affichage). Les écritures (import, saisie)
// viennent aux commits 2b3 et 2b4.

import { state } from './state.js';
import { getProgrammationMois } from './api.js';

// Clé mois YYYY-MM à partir d'une date ISO YYYY-MM-DD.
function monthKeyOf(dateStr) {
  return dateStr && dateStr.length >= 7 ? dateStr.slice(0, 7) : null;
}

// Charge un mois dans le cache si pas déjà fait. Pas de relance d'un fetch
// en cours (déduplication simple via une Map de promesses en vol).
const _inflight = new Map();
export async function ensureMonthLoaded(mois) {
  if (!mois) return;
  if (state.programmationMonths[mois]) return; // déjà en cache
  if (_inflight.has(mois)) return _inflight.get(mois);
  const p = (async () => {
    try {
      const data = await getProgrammationMois(mois);
      state.programmationMonths[mois] = (data && typeof data === 'object') ? data : {};
    } catch (e) {
      console.error(`[programmation] ensureMonthLoaded(${mois}) échoué`, e);
      // En cas d'erreur, on cache un objet vide pour éviter de retry en boucle
      state.programmationMonths[mois] = {};
    } finally {
      _inflight.delete(mois);
    }
  })();
  _inflight.set(mois, p);
  return p;
}

// Renvoie la "fiche jour" pour une date ('YYYY-MM-DD').
// Modèle simplifié : { artistes: string[], creneaux: string[], notes: string, manuelle: bool }.
// Retourne null si rien pour ce jour.
export function getJour(dateStr) {
  const mois = monthKeyOf(dateStr);
  if (!mois) return null;
  const monthData = state.programmationMonths[mois];
  if (!monthData) return null;
  const j = monthData[dateStr];
  if (!j || typeof j !== 'object') return null;
  return j;
}

// Nombre d'artistes pour un jour.
export function countArtistesForDate(dateStr) {
  const j = getJour(dateStr);
  return j && Array.isArray(j.artistes) ? j.artistes.length : 0;
}

// True si la date a au moins un artiste OU une note non vide OU un créneau.
export function hasProgrammation(dateStr) {
  const j = getJour(dateStr);
  if (!j) return false;
  if (Array.isArray(j.artistes) && j.artistes.length > 0) return true;
  if (j.notes && j.notes.trim()) return true;
  if (Array.isArray(j.creneaux) && j.creneaux.length > 0) return true;
  return false;
}
