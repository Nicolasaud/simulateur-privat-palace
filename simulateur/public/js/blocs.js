// Multi-formules par fiche — helpers de construction et migration de blocs.
//
// Au commit 1 : une fiche peut avoir 1 seul bloc (l'UI reste mono). Les
// commits suivants étendent à N blocs.
//
// Structure d'un bloc :
//   {
//     blocId: 'bloc_xxx',      // ID stable pour reconcile édition ↔ save
//     formuleId: 'fm_xxx',     // référence vers state.formulesPrestation, ou null
//     typeId: 'privat-full',   // type interne (figé même si formule supprimée)
//     nbPers: 50,              // nombre de personnes spécifique à ce bloc
//     items: [...],            // snapshot d'items resto (modifiable par bloc)
//     overrides: {},           // overrides params bloc-spécifiques (commits ultérieurs)
//     snapshot: {…} | null,    // snapshot des params effectifs figé au save
//     formuleType: 'custom'    // 'custom' | 'none' (legacy bypass items)
//   }
//
// Lecture des params d'un bloc (à brancher dans calcul.js au commit 2) :
//   1. bloc.snapshot.params[paramId]      (si snapshot figé)
//   2. bloc.overrides[paramId]             (override bloc-spécifique)
//   3. formule.overrides[paramId]          (override formule générale)
//   4. typesInternes[bloc.typeId].params[paramId]  (défaut type)

export function newBlocId() {
  return 'bloc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// Construit un bloc depuis les champs legacy d'une config mono-formule.
// Tolérant : tous les champs peuvent manquer.
export function buildBlocFromLegacyConfig(config) {
  if (!config || typeof config !== 'object') config = {};
  return {
    blocId: newBlocId(),
    formuleId: config.formuleId || null,
    typeId: config.format || 'privat-full',
    nbPers: Math.max(1, parseInt(config.nbPers) || 50),
    items: Array.isArray(config.items) ? JSON.parse(JSON.stringify(config.items)) : [],
    overrides: (config.overrides && typeof config.overrides === 'object') ? { ...config.overrides } : {},
    snapshot: config.snapshot || null,
    formuleType: config.formuleType || 'custom'
  };
}

// Migration idempotente d'une config :
//   - si config.formules existe et non vide → retourne config tel quel
//   - sinon → ajoute formules: [bloc construit depuis legacy]
// Ne supprime PAS les champs legacy (cleanup au commit 7).
export function migrateConfigToMulti(config) {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config.formules) && config.formules.length > 0) return config;
  return {
    ...config,
    formules: [buildBlocFromLegacyConfig(config)]
  };
}
