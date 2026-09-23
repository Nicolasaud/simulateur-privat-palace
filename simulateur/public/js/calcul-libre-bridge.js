// Pont entre l'UI runtime (state + DOM) et le moteur libre pur.
// Fabrique un `ctx` complet + une pseudo-fiche puis appelle
// `calculerFicheLibre`. Utilisé par :
//   - `recalcul()` de calcul.js pour la cross-validation A/B live
//   - `Étape 5` future : sera le seul point d'entrée après suppression du legacy

import {
  val, getTva, getCaJour, getPeriodeEffective, jourEstFerme, getPersonnel
} from './helpers.js';
import { state } from './state.js';
import { estPrivatisation } from './mode-fiche.js';
import { calculerFicheLibre, calculerBlocLibre, calculerFraisResaFiche, calculerPersonnelFiche } from './calcul-libre.js';
import { LEGACY_FORMULES_LIB } from './formules-lib-seed.js';

// Construit un `ctx` pour le moteur libre depuis l'état runtime courant
// (DOM params + state.bibItems + state.bibFormules + state.typesInternes...).
function buildLibreCtx(jour) {
  // Params globaux : lire depuis le DOM pour rester cohérent avec le legacy
  const globalParams = {
    paramDuree: val('paramDuree'),
    paramCoutHoraire: val('paramCoutHoraire'),
    margePersonnel: val('margePersonnel'),
    margeIntervenants: val('margeIntervenants'),
    bufferCouverture: val('bufferCouverture'),
    tvaSpectacle: val('tvaSpectacle'),
    tvaResto: val('tvaResto'),
    tvaBar: val('tvaBar'),
    tvaPresta: val('tvaPresta')
  };
  const periode = getPeriodeEffective();
  const caJourHabituel = getCaJour(jour, periode);

  // Fallback : si la biblio libre n'a jamais été chargée depuis le cloud
  // (onglet Bibliothèque libre jamais ouvert), on utilise le seed local des
  // 5 formules legacy — sinon le moteur libre ne trouve pas la formule
  // associée au bloc et renvoie 0€.
  let formulesLib = state.bibFormules || [];
  if (!formulesLib.length || !LEGACY_FORMULES_LIB.every(l => formulesLib.some(f => f.id === l.id))) {
    // Merge : garder les formules déjà chargées + compléter avec les legacy manquantes
    const existing = new Set(formulesLib.map(f => f.id));
    formulesLib = [
      ...formulesLib,
      ...LEGACY_FORMULES_LIB.filter(l => !existing.has(l.id))
    ];
  }

  return {
    // Les frais de réservation sont consolidés au niveau de la fiche
    // (une seule ligne après tous les blocs), pas calculés bloc par bloc.
    fraisResaParFiche: true,
    // Groupe ou réservation en journée : aucun frais de réservation.
    modePrivatisation: estPrivatisation(),
    itemsLib: state.bibItems || [],
    formulesLib,
    typesInternes: state.typesInternes || [],
    formulesPrestation: state.formulesPrestation || [],
    globalParams,
    periode,
    caJourHabituel,
    getPersonnelFn: (nbPers) => getPersonnel(nbPers),
    jourEstFermeFn: (j) => jourEstFerme(j),
    tvaFn: (cat) => getTva(cat)
  };
}

// Construit une pseudo-fiche à partir de state.formules (blocs en RAM).
function buildLibreFiche(jour) {
  return {
    config: {
      day: jour,
      formules: state.formules
    }
  };
}

// Point d'entrée public : calcule la fiche courante avec le moteur libre.
// Retourne le même objet que `calcul-libre.calculerFicheLibre` :
//   { lignes, warnings, totalHT, prixPers, margeBrute, tauxMarge, totalTTC, tvaParTaux, nbPers, totalCout }
export function calculerCurrentFicheLibre(jour) {
  const fiche = buildLibreFiche(jour);
  const ctx = buildLibreCtx(jour);
  return calculerFicheLibre(fiche, ctx);
}

// Shim bloc par bloc pour rétro-compat avec les callers de `calculerBloc` de
// calcul.js (notamment blocs-ui.js). Reconstruit le ctx courant + délègue
// à `calculerBlocLibre` du moteur libre. Retourne `{ lignes, warning }`.
export function calculerBlocLibreForCurrentFiche(bloc, jour) {
  const ctx = buildLibreCtx(jour);
  return calculerBlocLibre(bloc, { ...ctx, jour });
}

// Frais de réservation de la fiche en cours : une seule ligne pour tous les
// blocs, calculée à partir des lignes déjà consolidées. Retourne
// `{ ligne, blocIdx }` ou null. Utilisé par calculer() et le récap global.
export function calculerPersonnelCurrentFiche(lignes, jour) {
  const ctx = buildLibreCtx(jour);
  return calculerPersonnelFiche(state.formules, lignes, { ...ctx, jour });
}

export function calculerFraisResaCurrentFiche(lignes, jour) {
  const ctx = buildLibreCtx(jour);
  return calculerFraisResaFiche(state.formules, lignes, { ...ctx, jour });
}
