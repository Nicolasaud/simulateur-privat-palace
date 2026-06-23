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

  // INDEX léger des fiches (depuis GET /api/fiches) —
  // une fiche complète est récupérée à la demande via getFiche(id).
  // Champs : { id, nomFiche, client, dateEvent, statut, totalHT, updated_at, updated_by }
  fichesList: [],
  currentFicheId: null,
  isDirty: false,

  // Calendrier
  calCurrentMonth: new Date().getMonth(),
  calCurrentYear: new Date().getFullYear()
};
