// Items système — items calculés à la volée qui reproduisent les briques
// du moteur legacy (personnel auto, frais de réservation auto, spectacles,
// intervenants, matières atelier, billets groupe...).
//
// Deux catégories :
//   - Items système "publics" (`sys_personnel`, `sys_frais_resa`) → seedés
//     dans le blob items-lib pour être VISIBLES (non éditables) dans l'UI.
//   - Items système "legacy" (spectacle, salle-seule, atelier-*, impro-*,
//     groupe-*, user-resto-items) → briques internes réservées au moteur
//     libre pour reproduire les 5 formules figées. Non-affichés dans la
//     Bibliothèque libre (pas de bruit visuel), utilisés uniquement dans
//     le seed des formules legacy.
//
// Chaque item système porte une `systemFn` reconnue par `computeSystemItem`
// qui renvoie { coutHT, prixHT, libelleDynamique, qty?, tvaCat?, type? }.
// Le contexte `ctx` contient tout ce dont le calcul a besoin (nbPers, jour,
// paliers, params, autres lignes...).

import { fmt } from './helpers.js';

// === Items système "publics" — visibles dans l'UI Bibliothèque ==========
export const SYSTEM_ITEMS = [
  {
    id: 'sys_personnel',
    libelle: 'Personnel service en salle (auto)',
    systemFn: 'personnel_auto',
    categorieId: 'cat_prestation',
    tvaCat: 'prestation',
    coutHT: 0,
    prixHT: 0,
    _system: true,
    _description: 'Calculé à partir du nombre de convives (via paliers) × durée × coût horaire. Marge personnel appliquée.'
  },
  {
    id: 'sys_frais_resa',
    libelle: 'Frais de réservation (auto)',
    systemFn: 'frais_resa_auto',
    categorieId: 'cat_prestation',
    tvaCat: 'prestation',
    coutHT: 0,
    prixHT: 0,
    _system: true,
    _description: 'Ajusté pour couvrir le CA habituel du jour (avec buffer). Nul si le CA de la fiche dépasse déjà le seuil.'
  }
];

// === Items système "legacy" — internes au moteur libre ==================
// Ces items ne sont PAS seedés dans le blob items-lib (pas d'affichage UI).
// Ils vivent uniquement comme constantes ici et sont référencés par le seed
// des 5 formules legacy (formules-lib-seed.js).
export const LEGACY_SYSTEM_ITEMS = [
  {
    id: 'sys_spectacle_full',
    libelle: 'Spectacle (plateau humour)',
    systemFn: 'spectacle_full',
    categorieId: 'cat_spectacle',
    tvaCat: 'prestation',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Prix/coût du spectacle plateau humour lu depuis les params du type interne privat-full.'
  },
  {
    id: 'sys_privat_salle_seule',
    libelle: 'Privatisation salle seule (sans spectacle)',
    systemFn: 'privat_salle_seule',
    categorieId: 'cat_prestation',
    tvaCat: 'prestation',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Forfait salle seule (type privat-salle).'
  },
  {
    id: 'sys_atelier_inter',
    libelle: 'Animation atelier cocktail (intervenant)',
    systemFn: 'atelier_inter',
    categorieId: 'cat_animation',
    tvaCat: 'prestation',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Intervenant atelier cocktail (marge atelier appliquée).'
  },
  {
    id: 'sys_atelier_mat',
    libelle: 'Atelier cocktail — matières & boissons (par participant)',
    systemFn: 'atelier_mat',
    categorieId: 'cat_bar',
    tvaCat: 'bar',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Matières & boissons atelier cocktail par participant (marge atelier appliquée).'
  },
  {
    id: 'sys_impro_inter',
    libelle: 'Animation formation impro (intervenant)',
    systemFn: 'impro_inter',
    categorieId: 'cat_animation',
    tvaCat: 'prestation',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Intervenant formation impro (marge intervenants appliquée).'
  },
  {
    id: 'sys_impro_particip',
    libelle: 'Formation impro — par participant',
    systemFn: 'impro_particip',
    categorieId: 'cat_prestation',
    tvaCat: 'prestation',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Prix par participant ajusté (déduction du prorata intervenant).'
  },
  {
    id: 'sys_groupe_billet',
    libelle: 'Soirée Palace Comedy — billet groupe',
    systemFn: 'groupe_billet',
    categorieId: 'cat_spectacle',
    tvaCat: 'spectacle',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _description: 'Billet groupe soirée Palace classique (prix/coût par personne).'
  },
  {
    id: 'sys_user_resto_items',
    libelle: 'Items restauration de la fiche',
    systemFn: 'user_resto_items',
    categorieId: 'cat_resto',
    tvaCat: 'restauration',
    coutHT: 0, prixHT: 0,
    _system: true, _legacy: true,
    _multiline: true,
    _description: 'Injecte les items resto saisis dans le bloc de la fiche (multi-lignes).'
  }
];

// Index complet (public + legacy) pour lookup interne
export const ALL_SYSTEM_ITEMS_INDEX = (() => {
  const map = new Map();
  SYSTEM_ITEMS.forEach(i => map.set(i.id, i));
  LEGACY_SYSTEM_ITEMS.forEach(i => map.set(i.id, i));
  return map;
})();

export function getSystemItem(id) {
  return ALL_SYSTEM_ITEMS_INDEX.get(id) || null;
}

// Calcul à la volée ———————————————————————————————————————————————
// ctx = {
//   nbPers, jour, periode,
//   caLignesHorsResa,       // somme des totalHT des autres lignes (hors frais résa)
//   getPersonnelFn,         // fn(nbPers) → { nbStaff, duree, cout }
//   typeParams,             // params effectifs du type interne du bloc
//                            // (paramSpecPrix, forfaitSalleSeule, coutInterCocktail...)
//   globalParams,           // params globaux (margePersonnel, margeIntervenants,
//                            //   bufferCouverture, tvaSpectacle, tvaResto...)
//   caJourHabituel,         // CA de référence pour le jour × période
//   ficheRestoItems,        // items resto du bloc courant (pour sys_user_resto_items)
//   formuleType,            // 'custom' vs 'formule' → détermine si on inclut les items resto
//   jourEstFermeFn          // fn(jour) → bool
// }
export function computeSystemItem(item, ctx) {
  if (!item || !item.systemFn) {
    return {
      coutHT: item?.coutHT || 0,
      prixHT: item?.prixHT || 0,
      libelleDynamique: item?.libelle,
      qty: 1,
      tvaCat: item?.tvaCat
    };
  }

  const tp = ctx.typeParams || {};
  const gp = ctx.globalParams || {};
  const nbPers = ctx.nbPers || 0;

  switch (item.systemFn) {

    case 'personnel_auto': {
      const personnel = ctx.getPersonnelFn ? ctx.getPersonnelFn(nbPers) : { nbStaff: 0, duree: 0, cout: 0 };
      const nbStaff = personnel.nbStaff || 0;
      const duree = personnel.duree || Number(gp.paramDuree || 9);
      const coutH = Number(gp.paramCoutHoraire || 25);
      const marge = Number(gp.margePersonnel || 40) / 100;
      const coutHT = nbStaff * duree * coutH;
      const prixHT = coutHT * (1 + marge);
      return {
        coutHT, prixHT, qty: 1,
        tvaCat: 'prestation',
        type: 'personnel',
        libelleDynamique: `Service en salle (${nbStaff} personnes × ${duree}h)`
      };
    }

    case 'frais_resa_auto': {
      const buffer = Number(gp.bufferCouverture || 20) / 100;
      const seuil = (ctx.caJourHabituel || 0) * (1 + buffer);
      const caHors = ctx.caLignesHorsResa || 0;
      const prixHT = Math.max(0, seuil - caHors);
      return {
        coutHT: 0, prixHT, qty: 1,
        tvaCat: 'prestation',
        type: 'fraisResa',
        libelleDynamique: `Frais de réservation (couverture ${ctx.jour || ''} ${ctx.periode || ''})`,
        // Skip la ligne si prixHT nul (couverture déjà atteinte) OU jour fermé
        skip: prixHT <= 0 || (ctx.jourEstFermeFn && ctx.jourEstFermeFn(ctx.jour))
      };
    }

    case 'spectacle_full': {
      return {
        coutHT: Number(tp.paramSpecCout || 0),
        prixHT: Number(tp.paramSpecPrix || 0),
        qty: 1,
        tvaCat: 'prestation',
        type: 'spectacle',
        libelleDynamique: 'Spectacle (plateau humour)'
      };
    }

    case 'privat_salle_seule': {
      return {
        coutHT: Number(tp.coutSalleSeule || 0),
        prixHT: Number(tp.forfaitSalleSeule || 0),
        qty: 1,
        tvaCat: 'prestation',
        type: 'privatSalle',
        libelleDynamique: 'Privatisation salle seule (sans spectacle)'
      };
    }

    case 'atelier_inter': {
      const cout = Number(tp.coutInterCocktail || 0);
      const marge = Number(tp.margeAtelier || 0) / 100;
      return {
        coutHT: cout,
        prixHT: cout * (1 + marge),
        qty: 1,
        tvaCat: 'prestation',
        type: 'inter',
        libelleDynamique: 'Animation atelier cocktail (intervenant)'
      };
    }

    case 'atelier_mat': {
      const cout = Number(tp.coutMatCocktail || 0);
      const marge = Number(tp.margeAtelier || 0) / 100;
      return {
        coutHT: cout,   // par personne
        prixHT: cout * (1 + marge),   // par personne
        qty: nbPers,
        tvaCat: 'bar',
        type: 'matieres',
        libelleDynamique: 'Atelier cocktail — matières & boissons (par participant)',
        perPers: true
      };
    }

    case 'impro_inter': {
      const cout = Number(tp.coutInterImpro || 0);
      const marge = Number(gp.margeIntervenants || 40) / 100;
      return {
        coutHT: cout,
        prixHT: cout * (1 + marge),
        qty: 1,
        tvaCat: 'prestation',
        type: 'inter',
        libelleDynamique: 'Animation formation impro (intervenant)'
      };
    }

    case 'impro_particip': {
      const coutInter = Number(tp.coutInterImpro || 0);
      const margeInter = Number(gp.margeIntervenants || 40) / 100;
      const prixInterTotal = coutInter * (1 + margeInter);
      const prixParticip = Number(tp.prixPersImpro || 0);
      const prixParticipNet = Math.max(0, prixParticip - prixInterTotal / nbPers);
      return {
        coutHT: 0,
        prixHT: prixParticipNet,
        qty: nbPers,
        tvaCat: 'prestation',
        type: 'pers',
        libelleDynamique: 'Formation impro — par participant',
        perPers: true
      };
    }

    case 'groupe_billet': {
      return {
        coutHT: Number(tp.coutGroupe || 0),
        prixHT: Number(tp.prixGroupe || 0),
        qty: nbPers,
        tvaCat: 'spectacle',
        type: 'billet',
        libelleDynamique: 'Soirée Palace Comedy — billet groupe',
        perPers: true
      };
    }

    case 'user_resto_items': {
      const items = Array.isArray(ctx.ficheRestoItems) ? ctx.ficheRestoItems : [];
      if (ctx.formuleType && ctx.formuleType !== 'custom') {
        return { multi: [] };
      }
      return {
        multi: items.map(it => {
          // Étape mode-fixe/variable : chaque item peut être en 'unit' (prix fixe
          // total indépendant du nb pers) ou 'perPers' (défaut historique, ×nbPers).
          const mode = it.mode === 'unit' ? 'unit' : 'perPers';
          const isPerPers = mode === 'perPers';
          return {
            libelle: it.libelle,
            qty: isPerPers ? nbPers : 1,
            prixHT: Number(it.prixHT || 0),
            coutHT: Number(it.coutHT || 0),
            tvaCat: it.tvaCat || 'restauration',
            type: 'resto',
            perPers: isPerPers
          };
        })
      };
    }

    default:
      return {
        coutHT: item.coutHT || 0,
        prixHT: item.prixHT || 0,
        qty: 1,
        tvaCat: item.tvaCat,
        libelleDynamique: item.libelle
      };
  }
}

// Fonction d'aide : décrit un item système pour l'UI ————————————————
export function describeSystemItem(item) {
  if (!item?.systemFn) return null;
  return item._description || 'Item calculé automatiquement';
}
