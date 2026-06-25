// État mutable partagé entre modules (cloud-first depuis l'étape 6).
// Tous les modules importent `state` et lisent/écrivent ses propriétés.

export const state = {
  // Items de la formule en cours d'édition (fiche en mémoire)
  items: [
    { libelle: 'Apéritif &amp; mises en bouche', coutHT: 3, prixHT: 10, tvaCat: 'restauration' },
    { libelle: 'Plat principal', coutHT: 7, prixHT: 22, tvaCat: 'restauration' },
    { libelle: 'Dessert', coutHT: 2.5, prixHT: 8, tvaCat: 'restauration' },
    { libelle: 'Boissons (vin / soft)', coutHT: 4, prixHT: 14, tvaCat: 'bar' }
  ],

  // Bibliothèque d'items réutilisables (rechargée depuis /api/bdd-items)
  bddItems: [],

  // Bibliothèque de formules complètes (depuis /api/formules) — historique "compositions"
  // = liste d'items resto pré-assemblés et réutilisables.
  formulesList: [],

  // Bibliothèque de formules de prestation (depuis /api/formules-v2) —
  // bundles type + params + items + builtIn. Seedés au premier login si vide.
  formulesPrestation: [],

  // Niveau 1 du Modèle C : les 5 types internes figés (libellé éditable + params
  // par défaut). Seedés au premier login si vide. Les formules-v2 ne stockent
  // que les overrides par rapport à ces défauts.
  typesInternes: [],

  // ID de la formule active sur la fiche en cours (intégré dans config.formuleId).
  // Persisté avec la fiche.
  currentFormuleId: null,

  // Snapshot figé des params effectifs au moment du dernier save de la fiche
  // courante. Null si la fiche n'a jamais été (re)sauvegardée depuis le pivot
  // Modèle C. Au calcul, lu en priorité : snapshot > override formule > défaut type.
  currentSnapshot: null,

  // Multi-formules (commit 1) — identifiant stable du bloc principal de la
  // fiche en cours. Pour l'instant un seul bloc en RAM (UI inchangée) ;
  // au commit 2 ce sera l'ID du bloc actif dans state.formules[].
  // Persisté dans config.formules[0].blocId au save.
  currentBlocId: null,

  // Multi-formules (commit 2) — blocs de la fiche en cours.
  // Au commit 2 : un seul bloc, synchronisé en début de chaque calculer()
  // depuis le DOM (inputs #format, #nbPers, state.items, etc.).
  // Au commit 3+ : N blocs, rendus dans l'UI via blocs.js.
  // Format d'un bloc : voir public/js/blocs.js.
  formules: [],

  // INDEX léger des fiches (depuis GET /api/fiches) —
  // une fiche complète est récupérée à la demande via getFiche(id).
  // Champs : { id, nomFiche, client, dateEvent, statut, totalHT, updated_at, updated_by }
  fichesList: [],
  currentFicheId: null,
  isDirty: false,

  // Calendrier
  calCurrentMonth: new Date().getMonth(),
  calCurrentYear: new Date().getFullYear(),

  // Programmation artistique (Phase 2b)
  // - showProgrammation : toggle UI, désactivé par défaut
  // - programmationMonths : { 'YYYY-MM': { 'YYYY-MM-DD': [creneaux], … } }
  //   cache RAM des mois déjà fetchés, évite les rappels API au switch mois
  showProgrammation: false,
  programmationMonths: {}
};
