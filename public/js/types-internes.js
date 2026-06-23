// Types internes (Modèle C — niveau 1).
//
// 5 types figés correspondant aux 5 logiques de calcul de calcul.js.
// Chaque type porte :
//   - un libellé éditable (state.typesInternes[i].nom)
//   - les valeurs PAR DÉFAUT de ses paramètres (state.typesInternes[i].params)
//
// Les formules-v2 référencent un typeId et stockent seulement leurs overrides.
// Le moteur de calcul lit chaque param via la chaîne :
//   snapshot fiche > override formule > défaut type interne
//
// Au premier login (blob vide), on seede les 5 types avec les valeurs courantes
// des inputs globaux (mêmes valeurs que celles utilisées par les formules de
// base déjà seedées en cloud → diff = 0 → overrides = {}).

import { $ } from './helpers.js';
import { state } from './state.js';
import { getTypesInternes, putTypesInternes, scheduleFlush } from './api.js';
import { TYPES_META, TYPE_IDS } from './formules-prestation.js';

// Helpers de lookup
export function getTypeInterneById(id) {
  return state.typesInternes.find(t => t.id === id) || null;
}

// Valeur par défaut d'un paramètre pour un type donné (0 si type ou param absent).
export function getDefaultParam(typeId, paramId) {
  const t = getTypeInterneById(typeId);
  if (!t) return 0;
  const v = t.params?.[paramId];
  return (typeof v === 'number' && !isNaN(v)) ? v : 0;
}

// Libellé affichable d'un type (depuis le blob, ou fallback TYPES_META).
export function getTypeLabel(typeId) {
  const t = getTypeInterneById(typeId);
  return t?.nom || TYPES_META[typeId]?.label || typeId;
}

// Snapshot des valeurs actuelles des inputs globaux pour un type donné.
// Utilisé seulement au seed initial.
function snapshotParamsForType(typeId) {
  const meta = TYPES_META[typeId];
  if (!meta) return {};
  const out = {};
  meta.paramIds.forEach(pid => {
    const el = $(pid);
    if (el) out[pid] = parseFloat(el.value) || 0;
  });
  return out;
}

function buildDefaultTypes() {
  return TYPE_IDS.map(typeId => ({
    id: typeId,
    nom: TYPES_META[typeId].label,
    params: snapshotParamsForType(typeId)
  }));
}

export async function loadTypesInternesFromCloud() {
  try {
    const list = await getTypesInternes();
    state.typesInternes = Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Lecture types-internes cloud échouée', e);
    state.typesInternes = [];
  }
}

export function persistTypesInternes() {
  scheduleFlush('types-internes', () => putTypesInternes(state.typesInternes));
}

// Si le blob est vide, on seede les 5 types depuis les inputs globaux et
// on persiste immédiatement. À appeler APRÈS loadParamsFromCloud().
export async function seedTypesInternesIfEmpty() {
  if (state.typesInternes.length > 0) return false;
  const defaults = buildDefaultTypes();
  state.typesInternes = defaults;
  try {
    await putTypesInternes(defaults);
    console.info(`[types-internes] Seed initial : ${defaults.length} types créés.`);
    return true;
  } catch (e) {
    console.error('Seed types-internes échoué', e);
    return false;
  }
}

// Migration douce : si un type a un paramId nouveau qu'il n'a pas en mémoire
// (parce qu'on a ajouté un paramètre côté code après le seed initial),
// on le complète depuis l'input global (ou 0).
export function reconcileTypesInternes() {
  let touched = false;
  state.typesInternes.forEach(t => {
    const meta = TYPES_META[t.id];
    if (!meta) return;
    if (!t.params) t.params = {};
    meta.paramIds.forEach(pid => {
      if (!(pid in t.params)) {
        const el = $(pid);
        t.params[pid] = el ? (parseFloat(el.value) || 0) : 0;
        touched = true;
      }
    });
  });
  if (touched) persistTypesInternes();
}

// Update champ params d'un type (setter unifié pour l'UI).
export function updateTypeInterneParam(typeId, paramId, value) {
  const t = getTypeInterneById(typeId);
  if (!t) return;
  if (!t.params) t.params = {};
  t.params[paramId] = parseFloat(value) || 0;
  persistTypesInternes();
}

export function updateTypeInterneNom(typeId, nom) {
  const t = getTypeInterneById(typeId);
  if (!t) return;
  t.nom = String(nom || '').trim() || TYPES_META[typeId]?.label || typeId;
  persistTypesInternes();
}
