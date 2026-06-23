// Point d'entrée ESM. Séquence d'initialisation :
//   1. requireAuth() — bloque si pas de session valide
//   2. loadAllFromCloud() — récupère index fiches + bdd-items + formules + paliers + params
//   3. maybeOfferMigration() — propose import localStorage→cloud si données legacy
//   4. wire des handlers inline sur window
//   5. enregistrement des listeners délégués
//   6. premier rendu

import { addItem, renderItems, registerItemsListeners } from './items.js';
import { recalcul, copyDevisText, refreshForfaitLibelleVisibility, registerCalculListeners } from './calcul.js';
import { calNav, calToday, renderCalendrier } from './calendrier.js';
import {
  openFicheModal, openDayModal, closeFicheModal, loadFicheFromModal,
  registerModalListeners
} from './modal.js';
import { switchTab } from './onglets.js';
import {
  bddAjouter, importerDepuisBdd, loadBddFromCloud,
  refreshBddTable, refreshBddSelect, registerBddListeners
} from './bdd-items.js';
import {
  addPalier, deletePalier, loadPaliersFromCloud, registerPaliersListeners
} from './paliers.js';
import {
  formuleCapture, formuleCharger, formuleSupprimer,
  loadFormulesFromCloud, refreshFormulesTable, refreshFormulesSelect
} from './formules.js';
import {
  loadFormulesV2FromCloud, seedFormulesIfEmpty, reconcileBuiltInFormules,
  migrateFormulesToModelC,
  refreshFormulesPrestaTable, refreshFormuleSelectInFiche,
  initFormuleSelectFromCurrentFormat, onFormuleSelectChange,
  openFormulePrestaEditor, closeFormulePrestaEditor,
  saveFormulePrestaFromEditor,
  addFormulePrestaItemFromBdd, addFormulePrestaItemNew, removeFormulePrestaItem,
  pushFormulePrestaItemToBdd,
  duplicateFormulePresta, deleteFormulePresta
} from './formules-prestation.js';
import {
  loadTypesInternesFromCloud, seedTypesInternesIfEmpty, reconcileTypesInternes,
  refreshTypesInternesUI, registerTypesInternesListeners
} from './types-internes.js';
import {
  newFiche, saveFiche, duplicateFiche, deleteFiche,
  exportAllJSON, importJSON,
  loadFichesIndexFromCloud, refreshFichesSelect, refreshDashboard,
  refreshHeureSpectacleVisibility, refreshStatutBadge,
  registerFichesListeners
} from './fiches.js';
import { exportFicheEquipe } from './export-fiche.js';
import { requireAuth, logout } from './auth.js';
import { loadParamsFromCloud, registerParamsListeners } from './params-sync.js';
import { maybeOfferMigration } from './migration.js';
import { showToast } from './ui-feedback.js';

// === Auth ===
const nom = await requireAuth();
const userInfoEl = document.getElementById('userInfo');
if (userInfoEl) userInfoEl.textContent = nom;

// Debug : exposition lecture seule de l'état (utile en attendant l'UI biblio)
import { state as __state } from './state.js';
window.__palaceState = __state;

// === Chargement initial depuis le cloud ===
async function loadAllFromCloud() {
  await Promise.all([
    loadFichesIndexFromCloud(),
    loadBddFromCloud(),
    loadFormulesFromCloud(),
    loadFormulesV2FromCloud(),
    loadTypesInternesFromCloud(),
    loadPaliersFromCloud(),
    loadParamsFromCloud()
  ]);
}
await loadAllFromCloud();

// === Seed initial (si blobs vides) + migration Modèle C ===
// Doit s'exécuter APRÈS loadParamsFromCloud() pour que les inputs globaux
// contiennent les bonnes valeurs au moment du snapshot.
// Ordre : types-internes AVANT formules (les formules référencent le type).
await seedTypesInternesIfEmpty();
reconcileTypesInternes();
await seedFormulesIfEmpty();
reconcileBuiltInFormules();
// Migration Modèle C : transforme f.type → f.typeId, f.params → f.overrides
// (uniquement les diffs avec les defaults du type interne).
migrateFormulesToModelC();

// === Migration legacy localStorage → cloud, si applicable ===
const migrated = await maybeOfferMigration();
if (migrated) {
  // L'utilisateur vient d'importer ses anciennes données : on recharge depuis le cloud.
  await loadAllFromCloud();
}

// === Rafraîchissement manuel + auto au retour de focus ===
let lastRefresh = Date.now();
const FOCUS_REFRESH_COOLDOWN_MS = 30_000;

async function refreshAll() {
  await loadAllFromCloud();
  refreshFichesSelect();
  refreshDashboard();
  refreshBddTable();
  refreshBddSelect();
  refreshFormulesTable();
  refreshFormulesSelect();
  refreshTypesInternesUI();
  refreshFormulesPrestaTable();
  refreshFormuleSelectInFiche();
  if (!document.getElementById('tabCalendrier').classList.contains('hidden')) renderCalendrier();
  recalcul();
  lastRefresh = Date.now();
  showToast('Données synchronisées', 'info', 1800);
}

window.addEventListener('focus', () => {
  if (Date.now() - lastRefresh < FOCUS_REFRESH_COOLDOWN_MS) return;
  loadAllFromCloud()
    .then(() => {
      refreshFichesSelect();
      refreshDashboard();
      refreshBddTable();
      refreshBddSelect();
      refreshFormulesTable();
      refreshFormulesSelect();
      refreshTypesInternesUI();
      refreshFormulesPrestaTable();
      refreshFormuleSelectInFiche();
      if (!document.getElementById('tabCalendrier').classList.contains('hidden')) renderCalendrier();
      lastRefresh = Date.now();
    })
    .catch(e => console.error('Auto-refresh échoué', e));
});

// === Exposition sur window pour les handlers inline (onclick="...") ===
Object.assign(window, {
  // Items
  addItem,
  // Calcul / export texte
  copyDevisText,
  // Onglets
  switchTab,
  // Calendrier
  calNav, calToday,
  // Modal
  openFicheModal, openDayModal, closeFicheModal, loadFicheFromModal,
  // Base d'items
  bddAjouter, importerDepuisBdd,
  // Paliers
  addPalier, deletePalier,
  // Formules (compositions legacy)
  formuleCapture, formuleCharger, formuleSupprimer,
  // Formules de prestation (bundles type+params+items)
  openFormulePrestaEditor, closeFormulePrestaEditor,
  saveFormulePrestaFromEditor,
  addFormulePrestaItemFromBdd, addFormulePrestaItemNew, removeFormulePrestaItem,
  pushFormulePrestaItemToBdd,
  duplicateFormulePresta, deleteFormulePresta,
  // Exposés sur window pour le listener des types-internes + fiches.js
  // (refresh croisé sans dépendance circulaire entre modules)
  refreshFormulesPrestaTable, refreshFormuleSelectInFiche,
  initFormuleSelectFromCurrentFormat,
  // Fiches
  newFiche, saveFiche, duplicateFiche, deleteFiche,
  exportAllJSON, importJSON, exportFicheEquipe,
  // Auth
  logout,
  // Sync
  refreshAll
});

// === Enregistrement des listeners délégués ===
registerItemsListeners();
registerCalculListeners();
registerModalListeners();
registerBddListeners();
registerPaliersListeners();
registerFichesListeners();
registerParamsListeners();

// === Wire du dropdown formuleSelect (changement par l'utilisateur sur la fiche) ===
const formuleSelectEl = document.getElementById('formuleSelect');
if (formuleSelectEl) {
  formuleSelectEl.addEventListener('change', e => onFormuleSelectChange(e.target));
}

// === Listeners spécifiques à la section types-internes ===
registerTypesInternesListeners();

// === Premier rendu ===
refreshFichesSelect();
refreshDashboard();
refreshBddTable();
refreshBddSelect();
refreshFormulesTable();
refreshFormulesSelect();
refreshTypesInternesUI();
refreshFormulesPrestaTable();
refreshFormuleSelectInFiche();
initFormuleSelectFromCurrentFormat();
refreshHeureSpectacleVisibility();
refreshStatutBadge();
refreshForfaitLibelleVisibility();
renderItems();
recalcul();
