// Seed des 5 formules "libres" qui reproduisaient le comportement du moteur
// legacy. Depuis 2026-02, ces formules ne sont PLUS visibles dans l'UI ni
// seedées dans le cloud. Elles restent uniquement en constantes internes
// pour permettre au moteur libre de reproduire le comportement des 5 typeId
// legacy lorsqu'une fiche ancienne s'y réfère (rétro-compat invisible).

import { getFormulesLib, putFormulesLib } from './api.js';
import { state } from './state.js';

export const LEGACY_FORMULES_LIB = [
  {
    id: 'fl_legacy_privat-full',
    nom: '[Legacy] Privatisation show + repas',
    _legacyTypeId: 'privat-full',
    _builtIn: true,
    categorieId: 'cat_prestation',
    itemIds: [
      'sys_spectacle_full',
      'sys_personnel',
      'sys_user_resto_items',
      'sys_frais_resa'
    ]
  },
  {
    id: 'fl_legacy_privat-salle',
    nom: '[Legacy] Privatisation sans show',
    _legacyTypeId: 'privat-salle',
    _builtIn: true,
    categorieId: 'cat_prestation',
    itemIds: [
      'sys_privat_salle_seule',
      'sys_personnel',
      'sys_user_resto_items',
      'sys_frais_resa'
    ]
  },
  {
    id: 'fl_legacy_atelier-cocktail',
    nom: '[Legacy] Atelier cocktail',
    _legacyTypeId: 'atelier-cocktail',
    _builtIn: true,
    categorieId: 'cat_animation',
    itemIds: [
      'sys_atelier_inter',
      'sys_atelier_mat'
    ]
  },
  {
    id: 'fl_legacy_formation-impro',
    nom: '[Legacy] Formation impro / team building',
    _legacyTypeId: 'formation-impro',
    _builtIn: true,
    categorieId: 'cat_animation',
    itemIds: [
      'sys_impro_inter',
      'sys_impro_particip'
    ]
  },
  {
    id: 'fl_legacy_groupe-classique',
    nom: '[Legacy] Groupe sur soirée Palace classique',
    _legacyTypeId: 'groupe-classique',
    _builtIn: true,
    categorieId: 'cat_spectacle',
    itemIds: [
      'sys_groupe_billet',
      'sys_user_resto_items'
    ]
  }
];

// Étape refonte 2026-02 : les formules legacy `fl_legacy_*` ne sont PLUS
// seedées dans le blob cloud. Le moteur libre les gère via un fallback
// interne (LEGACY_FORMULES_LIB en dur dans ce fichier) pour la rétro-compat
// des fiches existantes (typeId legacy). Cette fonction est un NO-OP mais
// on la garde pour ne pas casser les callers.
export async function seedLegacyFormulesLibIfMissing() {
  return 0;
}

// Purge one-shot : supprime les 5 formules legacy `fl_legacy_*` du blob
// cloud si elles y sont encore. Appelée au boot de la biblio pour nettoyer
// les installations qui ont vu passer les étapes précédentes.
export async function purgeLegacyFormulesLibFromCloud() {
  try {
    const list = await getFormulesLib();
    if (!Array.isArray(list) || list.length === 0) return 0;
    const filtered = list.filter(f => !f._builtIn && !LEGACY_FORMULES_LIB.some(l => l.id === f.id));
    if (filtered.length === list.length) return 0;
    const removed = list.length - filtered.length;
    await putFormulesLib(filtered);
    state.bibFormules = filtered;
    console.info(`[formules-lib] Purge legacy : ${removed} formule(s) supprimée(s) du cloud.`);
    return removed;
  } catch (e) {
    console.warn('[formules-lib] purge legacy échouée', e);
    return 0;
  }
}
