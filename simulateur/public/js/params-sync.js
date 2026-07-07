// Synchronisation des paramètres globaux du simulateur (CA, marges, TVA,
// plafonds, prix par formule, etc.) avec /api/params.
//
// Allowlist explicite : on persiste uniquement les ids listés ci-dessous,
// pas les champs de fiche (format, day, nbPers, etc. qui appartiennent
// à chaque fiche individuellement).
//
// Pré-étape 6 : ces champs n'étaient PAS persistés (valeurs par défaut HTML
// au rechargement). Désormais ils sont partagés entre les 3 commerciaux
// via le blob `params`.

// Note : on n'appelle pas recalcul() ici. Le listener délégué dans items.js
// (`document.addEventListener('input', ...)`) couvre déjà tous les inputs,
// ce qui évite un double recalcul à chaque touche.

import { getParams, putParams, scheduleFlush } from './api.js';

// Cleanup commit 7 : les params spécifiques par TYPE (paramSpecPrix,
// forfaitSalleSeule, coutInterCocktail, etc.) ont été déplacés dans
// state.typesInternes (Modèle C). Leurs inputs DOM ont été supprimés.
// Cette liste ne contient désormais que les params GLOBAUX (jamais
// liés à un type particulier).
const PARAM_IDS = [
  // Personnel (durée + coût horaire — les paliers sont gérés à part)
  'paramDuree', 'paramCoutHoraire',
  // Marges
  'margePersonnel', 'margeIntervenants',
  // Frais de réservation
  'bufferCouverture',
  // CA habituels B2C par jour & période
  'caLunP1', 'caLunP2', 'caMarP1', 'caMarP2', 'caMerP1', 'caMerP2',
  'caJeuP1', 'caJeuP2', 'caVenP1', 'caVenP2', 'caSamP1', 'caSamP2',
  'caDimP1', 'caDimP2',
  // TVA
  'tvaSpectacle', 'tvaResto', 'tvaBar', 'tvaPresta',
  // Plafonds commerciaux par jour
  'plafondLunMar', 'plafondMid', 'plafondVenSam'
];

function snapshotParams() {
  const out = {};
  PARAM_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) out[id] = el.value;
  });
  return out;
}

function applyParams(params) {
  if (!params || typeof params !== 'object') return;
  PARAM_IDS.forEach(id => {
    if (!(id in params)) return;
    const el = document.getElementById(id);
    if (el) el.value = params[id];
  });
}

export async function loadParamsFromCloud() {
  try {
    const params = await getParams();
    if (params && Object.keys(params).length > 0) {
      applyParams(params);
    }
  } catch (e) {
    console.error('Lecture params cloud échouée', e);
  }
}

// PUT debouncée (600 ms) : on attend une pause de saisie avant d'envoyer.
function persistParams() {
  scheduleFlush('params', () => putParams(snapshotParams()), 600);
}

export function registerParamsListeners() {
  PARAM_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', persistParams);
    el.addEventListener('change', persistParams);
  });
}
