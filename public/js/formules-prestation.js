// Bibliothèque des formules de prestation (bundles type + params + items).
//
// Modèle d'une formule :
//   {
//     id: 'fm_xxx',
//     nom: 'Privatisation full standard',
//     type: 'privat-full' | 'privat-salle' | 'atelier-cocktail'
//         | 'formation-impro' | 'groupe-classique',
//     params: { ... },           // overrides spécifiques au type (voir TYPES_META)
//     items: [                    // items resto rattachés (snapshot)
//       { libelle, coutHT, prixHT, tvaCat, personnesParUnite }
//     ],
//     builtIn: true|false,        // formules de base verrouillées côté UI
//     dateCreation, dateModification
//   }
//
// Au premier login (blob vide), on seede les 5 formules de base avec les
// valeurs courantes des inputs globaux (déjà chargées via loadParamsFromCloud
// ou valeurs HTML par défaut), puis on PUT immédiatement pour matérialiser
// côté cloud.

import { $, val } from './helpers.js';
import { state } from './state.js';
import { getFormulesV2, putFormulesV2, scheduleFlush } from './api.js';

// Métadonnées par type : libellé, IDs des inputs globaux à migrer dans params.
export const TYPES_META = {
  'privat-full': {
    label: 'Privatisation full + show + repas',
    paramIds: ['paramSpecPrix', 'paramSpecCout']
  },
  'privat-salle': {
    label: 'Privatisation salle seule (sans show)',
    paramIds: ['forfaitSalleSeule', 'coutSalleSeule']
  },
  'atelier-cocktail': {
    label: 'Atelier cocktail',
    paramIds: ['coutInterCocktail', 'coutMatCocktail', 'margeAtelier']
  },
  'formation-impro': {
    label: 'Formation impro / team building',
    paramIds: ['coutInterImpro', 'prixPersImpro']
  },
  'groupe-classique': {
    label: 'Groupe sur soirée Palace classique',
    paramIds: ['prixGroupe', 'coutGroupe']
  }
};

export const TYPE_IDS = Object.keys(TYPES_META);

// Helpers
export const nowIso = () => new Date().toISOString();
export const newFormuleId = () => 'fm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
const builtInId = (type) => `fm_base_${type}`;

export function getFormuleById(id) {
  return state.formulesPrestation.find(f => f.id === id) || null;
}

export function getFormulesByType(type) {
  return state.formulesPrestation.filter(f => f.type === type);
}

// Snapshot des valeurs actuelles des inputs globaux pour un type donné.
// Utilisé seulement au seed initial — ensuite les params vivent dans la formule.
function snapshotParamsForType(type) {
  const meta = TYPES_META[type];
  if (!meta) return {};
  const out = {};
  meta.paramIds.forEach(id => {
    const el = $(id);
    if (el) out[id] = parseFloat(el.value) || 0;
  });
  return out;
}

// Construit les 5 formules de base à partir des inputs globaux actuellement chargés.
// Appelée uniquement si le blob /api/formules-v2 est vide.
function buildDefaultFormules() {
  const stamp = nowIso();
  return TYPE_IDS.map(type => ({
    id: builtInId(type),
    nom: TYPES_META[type].label,
    type,
    params: snapshotParamsForType(type),
    items: [],
    builtIn: true,
    dateCreation: stamp,
    dateModification: stamp
  }));
}

export async function loadFormulesV2FromCloud() {
  try {
    const list = await getFormulesV2();
    state.formulesPrestation = Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Lecture formules-v2 cloud échouée', e);
    state.formulesPrestation = [];
  }
}

export function persistFormulesV2() {
  scheduleFlush('formules-v2', () => putFormulesV2(state.formulesPrestation));
}

// Si le blob est vide, on seede les 5 formules de base et on persiste IMMÉDIATEMENT
// (sans debounce — première fois unique, on veut que ce soit visible côté cloud
// avant tout autre PUT).
// IMPORTANT : à appeler APRÈS loadParamsFromCloud() pour que les inputs globaux
// contiennent les bonnes valeurs.
export async function seedFormulesIfEmpty() {
  if (state.formulesPrestation.length > 0) return false;
  const defaults = buildDefaultFormules();
  state.formulesPrestation = defaults;
  try {
    await putFormulesV2(defaults);
    console.info(`[formules-v2] Seed initial : ${defaults.length} formules de base créées.`);
    return true;
  } catch (e) {
    console.error('Seed formules-v2 échoué', e);
    return false;
  }
}

// Migration douce : si une formule "builtIn" perd un champ params parce qu'on a
// ajouté un nouveau paramètre côté code, on peut le compléter au boot.
// Pour l'instant : no-op, à étoffer si besoin.
export function reconcileBuiltInFormules() {
  // Placeholder pour de futures migrations idempotentes (ex: si on ajoute un
  // champ params.tva ou param supplémentaire après le déploiement initial).
}
