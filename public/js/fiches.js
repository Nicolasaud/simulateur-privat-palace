// Fiches devis : CRUD, persistance cloud (API), sérialisation form ↔ fiche,
// dashboard, import/export JSON.
//
// state.fichesList contient désormais l'INDEX léger (entrées
// { id, nomFiche, client, dateEvent, statut, totalHT, updated_at, updated_by }).
// La fiche complète est récupérée à la demande via getFiche(id).

import { $, fmt } from './helpers.js';
import { state } from './state.js';
import { renderItems } from './items.js';
import {
  recalcul, refreshForfaitLibelleVisibility,
  computeCurrentSnapshot, computeBlocSnapshot
} from './calcul.js';
import { newBlocId } from './blocs.js';
import {
  refreshBddTable, refreshBddSelect
} from './bdd-items.js';
import {
  refreshFormulesTable, refreshFormulesSelect
} from './formules.js';
import { renderCalendrier } from './calendrier.js';
import {
  listFiches, getFiche, putFiche, deleteFicheApi,
  putBddItems, putFormules
} from './api.js';
import { showToast } from './ui-feedback.js';

// --- Chargement cloud ---
export async function loadFichesIndexFromCloud() {
  try {
    const index = await listFiches();
    state.fichesList = Array.isArray(index) ? index : [];
  } catch (e) {
    console.error('Lecture index fiches cloud échouée', e);
    state.fichesList = [];
  }
}

// --- Helpers ---
function genId() {
  return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}
export function nowIso() { return new Date().toISOString(); }

export function setDirty(val = true) {
  state.isDirty = val;
  $('ficheUnsavedDot').classList.toggle('show', val);
}

export function formatHasSpectacle(format) {
  return format === 'privat-full' || format === 'groupe-classique';
}

// Construit une entrée d'index à partir d'une fiche complète (pour MAJ locale
// immédiate après PUT, sans relire l'index entier).
function buildIndexEntry(fiche) {
  // Multi-formules : extraire les typeIds des blocs pour l'affichage calendrier.
  // Fallback legacy : fiche.config.format pour les fiches mono pré-migration.
  let formulesTypes = null;
  const blocs = fiche.config?.formules;
  if (Array.isArray(blocs) && blocs.length > 0) {
    formulesTypes = blocs.map(b => b.typeId || b.type || null).filter(Boolean);
  } else if (fiche.config?.format) {
    formulesTypes = [fiche.config.format];
  }
  return {
    id: fiche.id,
    nomFiche: fiche.nomFiche || '',
    client: fiche.client || '',
    dateEvent: fiche.dateEvent || '',
    statut: fiche.statut || 'brouillon',
    totalHT: fiche.resultsSnapshot?.totalHT ?? null,
    formulesTypes,
    updated_at: fiche.updated_at,
    updated_by: fiche.updated_by
  };
}

// --- Sérialisation : on capture l'état du formulaire dans un objet ---
export function readCurrentForm() {
  // S'assure d'un blocId stable pour la fiche en cours.
  // Sans ça, chaque appel à readCurrentForm() régénérerait un blocId différent
  // → fausse détection dirty.
  if (!state.currentBlocId) state.currentBlocId = newBlocId();

  const nbPers = parseInt($('nbPers').value) || 1;
  const items = JSON.parse(JSON.stringify(state.items));
  const formuleId = state.currentFormuleId || null;
  const formuleType = $('formuleType').value;
  const format = $('format').value;

  // Multi-formules (commit 2) : on sérialise tous les blocs de state.formules.
  // Pour le bloc principal (state.formules[0] ou seul), on resynchronise les
  // valeurs courantes du DOM (inputs UI mono). Les éventuels blocs supplémentaires
  // (commit 3+) sont sérialisés tels quels en RAM.
  let formules;
  if (Array.isArray(state.formules) && state.formules.length > 0) {
    formules = state.formules.map((b, idx) => {
      if (idx === 0) {
        return {
          blocId: b.blocId || state.currentBlocId,
          formuleId,
          typeId: format,
          nbPers,
          items: JSON.parse(JSON.stringify(items)),
          overrides: b.overrides || {},
          snapshot: state.currentSnapshot || null,
          formuleType
        };
      }
      // Autres blocs : deep-clone pour découpler de la RAM
      return JSON.parse(JSON.stringify(b));
    });
  } else {
    formules = [{
      blocId: state.currentBlocId,
      formuleId,
      typeId: format,
      nbPers,
      items,
      overrides: {},
      snapshot: state.currentSnapshot || null,
      formuleType
    }];
  }

  return {
    nomFiche: $('ficheNom').value.trim(),
    client: $('ficheClient').value.trim(),
    contactEmail: $('ficheEmail').value.trim(),
    contactTel: $('ficheTel').value.trim(),
    dateEvent: $('ficheDateEvent').value,
    heureArrivee: $('ficheHeureArrivee').value,
    heureSpectacle: $('ficheHeureSpectacle').value,
    statut: $('ficheStatut').value,
    notes: $('ficheNotes').value,
    config: {
      // === Nouveau format multi-formules ===
      formules,

      // === Champs racine legacy : conservés en doublon jusqu'au commit 7 ===
      // Permettent : (a) à une version antérieure du code de relire la fiche
      // (rétro-compat de revert) ; (b) à writeFormFromFiche de fallback si
      // pour une raison X formules est absent. Cleanup commit 7.
      format,
      day: $('day').value,
      periodeOverride: $('periodeOverride').value,
      nbPers,
      formuleType,
      formuleId,
      items,
      vueClient: document.querySelector('input[name="vueClient"]:checked').value,
      fondreFraisResa: $('fondreFraisResa').checked,
      forfaitLibelle: $('forfaitLibelle').value,
      forfaitSousLibelle: $('forfaitSousLibelle').value
    }
  };
}

export function writeFormFromFiche(f) {
  $('ficheNom').value = f.nomFiche || '';
  $('ficheClient').value = f.client || '';
  $('ficheEmail').value = f.contactEmail || '';
  $('ficheTel').value = f.contactTel || '';
  $('ficheDateEvent').value = f.dateEvent || '';
  $('ficheHeureArrivee').value = f.heureArrivee || '';
  $('ficheHeureSpectacle').value = f.heureSpectacle || '';
  $('ficheStatut').value = f.statut || 'brouillon';
  $('ficheNotes').value = f.notes || '';
  if (f.config) {
    // Multi-formules : priorité au bloc 0 si présent (format nouveau),
    // sinon fallback sur les champs legacy racine (format ancien).
    const bloc = Array.isArray(f.config.formules) && f.config.formules.length > 0
      ? f.config.formules[0]
      : null;

    $('format').value = (bloc?.typeId) || f.config.format || 'privat-full';
    $('day').value = f.config.day || 'vendredi';
    $('periodeOverride').value = f.config.periodeOverride || 'auto';
    $('nbPers').value = (bloc?.nbPers) || f.config.nbPers || 50;
    $('formuleType').value = (bloc?.formuleType) || f.config.formuleType || 'custom';
    $('customFormuleBlock').style.display = ($('formuleType').value === 'custom') ? 'block' : 'none';

    const items = bloc?.items ?? f.config.items;
    if (Array.isArray(items)) state.items = JSON.parse(JSON.stringify(items));

    const vueRadio = document.querySelector(`input[name="vueClient"][value="${f.config.vueClient || 'decomposee'}"]`);
    if (vueRadio) vueRadio.checked = true;
    $('fondreFraisResa').checked = !!f.config.fondreFraisResa;
    $('forfaitLibelle').value = f.config.forfaitLibelle || 'Forfait événementiel tout inclus';
    $('forfaitSousLibelle').value = f.config.forfaitSousLibelle || 'privatisation + spectacle + restauration';

    // Modèle C : restore formuleId + snapshot des params + blocId stable.
    state.currentFormuleId = (bloc?.formuleId) || f.config.formuleId || null;
    state.currentSnapshot = (bloc?.snapshot) || f.config.snapshot || null;
    state.currentBlocId = (bloc?.blocId) || newBlocId();

    // Multi-formules (commit 2) : populer state.formules. Si config.formules
    // est présent → clone. Sinon → construit un bloc unique depuis legacy.
    // Au commit 2, on n'utilise QUE state.formules[0] (UI mono).
    if (Array.isArray(f.config.formules) && f.config.formules.length > 0) {
      state.formules = JSON.parse(JSON.stringify(f.config.formules));
      // Re-bind par référence l'items du bloc 0 et state.items pour que les
      // mutations sur state.items (via items.js) se répercutent dans le bloc.
      state.formules[0].items = state.items;
    } else {
      state.formules = [{
        blocId: state.currentBlocId,
        formuleId: state.currentFormuleId,
        typeId: $('format').value,
        nbPers: parseInt($('nbPers').value) || 50,
        items: state.items,
        overrides: {},
        snapshot: state.currentSnapshot,
        formuleType: $('formuleType').value
      }];
    }
  } else {
    state.currentFormuleId = null;
    state.currentSnapshot = null;
    state.currentBlocId = null;
    state.formules = [];
  }
  renderItems();
  refreshHeureSpectacleVisibility();
  refreshStatutBadge();
  refreshForfaitLibelleVisibility();
  // Modèle C : aligner le dropdown #formuleSelect avec la fiche chargée.
  // Si formuleId présent → sélectionne cette formule. Sinon (fiche legacy
  // pré-pivot) → matching par type via #format hidden.
  if (typeof window.initFormuleSelectFromCurrentFormat === 'function') {
    window.initFormuleSelectFromCurrentFormat();
  }
  // Multi-formules : rendre les cards des blocs de la fiche chargée.
  if (typeof window.renderBlocs === 'function') {
    window.renderBlocs();
  }
  recalcul();
}

export function refreshHeureSpectacleVisibility() {
  const show = formatHasSpectacle($('format').value);
  $('ficheHeureSpectacleBlock').classList.toggle('hidden', !show);
}

export function refreshStatutBadge() {
  const v = $('ficheStatut').value;
  const labels = { brouillon: 'brouillon', envoye: 'devis envoyé', accepte: 'accepté', refuse: 'refusé' };
  const badge = $('ficheStatutBadge');
  badge.className = 'statutBadge ' + v;
  badge.textContent = labels[v] || v;
}

// Format compact d'un ISO : "19/06 à 11h32"
function formatTraceDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const timePart = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `${datePart} à ${timePart}`;
}

// Affiche la traçabilité sous le titre "Fiche en cours".
// Passer null/undefined pour cacher (cas "nouvelle fiche jamais sauvegardée").
export function refreshFicheTrace(meta) {
  const el = $('ficheTrace');
  if (!el) return;
  if (!meta || !meta.created_by || !meta.created_at) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  const createdLine = `Créée par ${meta.created_by} le ${formatTraceDate(meta.created_at)}`;
  const jamaisModifiee = meta.created_by === meta.updated_by && meta.created_at === meta.updated_at;
  el.textContent = jamaisModifiee
    ? createdLine
    : `${createdLine} · Modifiée par ${meta.updated_by} le ${formatTraceDate(meta.updated_at)}`;
  el.classList.remove('hidden');
}

// --- Sélecteur de fiches ---
export function refreshFichesSelect() {
  const sel = $('selectFiche');
  sel.innerHTML = '<option value="">— Nouvelle fiche (non sauvegardée) —</option>';
  const sorted = [...state.fichesList].sort((a, b) => {
    if (a.dateEvent && b.dateEvent && a.dateEvent !== b.dateEvent) return a.dateEvent.localeCompare(b.dateEvent);
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });
  sorted.forEach(f => {
    const o = document.createElement('option');
    o.value = f.id;
    const dateStr = f.dateEvent ? new Date(f.dateEvent).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'2-digit'}) : '—';
    const statut = f.statut === 'accepte' ? '✓' : f.statut === 'refuse' ? '✗' : f.statut === 'envoye' ? '→' : '·';
    o.textContent = `${statut} ${f.nomFiche || '(sans nom)'} — ${f.client || '?'} — ${dateStr}`;
    sel.appendChild(o);
  });
  if (state.currentFicheId && state.fichesList.some(f => f.id === state.currentFicheId)) sel.value = state.currentFicheId;
  else sel.value = '';
}

// --- Actions ---
export function newFiche(askConfirm = true) {
  if (askConfirm && state.isDirty && !confirm('Tu as des modifications non sauvegardées. Créer une nouvelle fiche quand même ?')) return;
  state.currentFicheId = null;
  refreshFicheTrace(null);
  writeFormFromFiche({
    nomFiche: '', client: '', contactEmail: '', contactTel: '',
    dateEvent: '', heureArrivee: '', heureSpectacle: '',
    statut: 'brouillon', notes: '',
    config: {
      format: 'privat-full', day: 'vendredi', periodeOverride: 'auto', nbPers: 50,
      formuleType: 'custom',
      items: [
        { libelle: 'Apéritif & mises en bouche', coutHT: 3, prixHT: 10, tvaCat: 'restauration' },
        { libelle: 'Plat principal', coutHT: 7, prixHT: 22, tvaCat: 'restauration' },
        { libelle: 'Dessert', coutHT: 2.5, prixHT: 8, tvaCat: 'restauration' },
        { libelle: 'Boissons (vin / soft)', coutHT: 4, prixHT: 14, tvaCat: 'bar' }
      ],
      vueClient: 'decomposee', fondreFraisResa: false,
      forfaitLibelle: 'Forfait événementiel tout inclus',
      forfaitSousLibelle: 'privatisation + spectacle + restauration'
    }
  });
  setDirty(false);
  refreshFichesSelect();
}

function autoNomFiche(formData) {
  if (formData.nomFiche) return formData.nomFiche;
  const c = formData.client || 'Client';
  const d = formData.dateEvent ? new Date(formData.dateEvent).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}) : '';
  return `Devis ${c}${d ? ' ' + d : ''}`;
}

export async function saveFiche() {
  // Modèle C multi-formules : avant la sérialisation, snapshot des params
  // effectifs PAR BLOC. Chaque bloc fige ses propres params au moment du save
  // (opt-in : créé/refresh seulement à la (re)sauvegarde).
  //
  // Conséquence : modifier un type interne ou un override de formule APRÈS
  // ce save ne change pas le calcul des blocs snapshotés.
  //
  // Le snapshot d'un bloc est purgé en RAM dès qu'on touche à sa formule ou
  // ses items (voir blocs-ui.js) ; au prochain save, recalculé from scratch.
  try {
    if (Array.isArray(state.formules)) {
      state.formules.forEach(b => {
        b.snapshot = computeBlocSnapshot(b);
      });
      // Maintien du miroir legacy pour le bloc principal (lu par readCurrentForm)
      state.currentSnapshot = state.formules[0]?.snapshot || null;
    } else {
      // Fallback : pas de state.formules → snapshot legacy via le bloc principal
      state.currentSnapshot = computeCurrentSnapshot();
    }
  } catch (e) {
    console.warn('[Modèle C multi] snapshot par bloc échoué', e);
  }

  const data = readCurrentForm();
  const snapshot = window._lastDevis ? {
    totalHT: window._lastDevis.totalHT,
    totalTTC: window._lastDevis.totalTTC,
    prixPers: window._lastDevis.prixPers,
    tauxMarge: window._lastDevis.tauxMarge
  } : null;
  data.nomFiche = autoNomFiche(data);
  data.resultsSnapshot = snapshot;

  // Legacy mirror : config.snapshot = snapshot du bloc principal
  // (rétro-compat lecture par une version antérieure du code). Cleanup commit 7.
  data.config = { ...data.config, snapshot: state.currentSnapshot || null };

  const id = state.currentFicheId || genId();
  try {
    const saved = await putFiche(id, data);
    state.currentFicheId = saved.id;
    // MAJ index local immédiatement (évite un round-trip listFiches)
    const entry = buildIndexEntry(saved);
    const i = state.fichesList.findIndex(f => f.id === saved.id);
    if (i >= 0) state.fichesList[i] = entry; else state.fichesList.push(entry);
    refreshFichesSelect();
    refreshDashboard();
    refreshFicheTrace(saved);
    if (!$('tabCalendrier').classList.contains('hidden')) renderCalendrier();
    setDirty(false);
    $('ficheNom').value = saved.nomFiche;
  } catch (e) {
    showToast(`Échec de la sauvegarde : ${e.body?.error || e.message}`, 'error');
  }
}

export async function loadFiche(id) {
  let f;
  try {
    f = await getFiche(id);
  } catch (e) {
    if (e.status === 404) {
      showToast('Cette fiche a déjà été supprimée par un autre utilisateur.', 'error');
      // Retire l'entrée de l'index local
      state.fichesList = state.fichesList.filter(x => x.id !== id);
      refreshFichesSelect();
      refreshDashboard();
      if (!$('tabCalendrier').classList.contains('hidden')) renderCalendrier();
      newFiche(false);
      return;
    }
    showToast(`Erreur de chargement : ${e.message}`, 'error');
    return;
  }
  state.currentFicheId = f.id;
  writeFormFromFiche(f);
  refreshFicheTrace(f);
  setDirty(false);
  refreshFichesSelect();
  setTimeout(() => {
    if (f.resultsSnapshot && window._lastDevis) {
      const dHT = Math.abs(f.resultsSnapshot.totalHT - window._lastDevis.totalHT);
      if (dHT > 1) {
        const note = document.createElement('div');
        note.className = 'alerte info';
        note.innerHTML = `<strong>Recalcul :</strong> les chiffres actuels (${fmt(window._lastDevis.totalHT)} HT) diffèrent du snapshot enregistré (${fmt(f.resultsSnapshot.totalHT)} HT). Les paramètres avancés (paliers, marges, plafonds…) ont été modifiés depuis l'enregistrement de cette fiche.`;
        $('alertesBox').prepend(note);
      }
    }
  }, 50);
}

export async function duplicateFiche() {
  if (!state.currentFicheId) {
    alert('Pour dupliquer, charge d\'abord une fiche existante.');
    return;
  }
  const data = readCurrentForm();
  const snapshot = window._lastDevis ? {
    totalHT: window._lastDevis.totalHT, totalTTC: window._lastDevis.totalTTC,
    prixPers: window._lastDevis.prixPers, tauxMarge: window._lastDevis.tauxMarge
  } : null;
  data.nomFiche = (data.nomFiche || 'Devis') + ' (copie)';
  data.statut = 'brouillon';
  data.resultsSnapshot = snapshot;
  const newId = genId();
  try {
    const saved = await putFiche(newId, data);
    state.currentFicheId = saved.id;
    state.fichesList.push(buildIndexEntry(saved));
    writeFormFromFiche(saved);
    refreshFicheTrace(saved);
    refreshFichesSelect();
    refreshDashboard();
    if (!$('tabCalendrier').classList.contains('hidden')) renderCalendrier();
    setDirty(false);
  } catch (e) {
    showToast(`Échec de la duplication : ${e.body?.error || e.message}`, 'error');
  }
}

export async function deleteFiche() {
  if (!state.currentFicheId) {
    alert('Aucune fiche chargée à supprimer.');
    return;
  }
  const f = state.fichesList.find(x => x.id === state.currentFicheId);
  const nom = f?.nomFiche || '(sans nom)';
  if (!confirm(`Supprimer définitivement la fiche « ${nom } » ?\n\nCette action est irréversible (sauf si tu as un export JSON).`)) return;
  const id = state.currentFicheId;
  try {
    await deleteFicheApi(id);
  } catch (e) {
    if (e.status === 404) {
      // Quelqu'un a déjà supprimé : on resynchro et on n'insiste pas.
      showToast('Cette fiche a déjà été supprimée par un autre utilisateur.', 'error');
    } else {
      showToast(`Échec de la suppression : ${e.body?.error || e.message}`, 'error');
      return;
    }
  }
  state.fichesList = state.fichesList.filter(x => x.id !== id);
  state.currentFicheId = null;
  refreshFichesSelect();
  refreshDashboard();
  if (!$('tabCalendrier').classList.contains('hidden')) renderCalendrier();
  newFiche(false);
}

// --- Export / Import JSON ---
// Pour l'export on doit récupérer chaque fiche complète (l'index ne suffit pas).
export async function exportAllJSON() {
  let fichesPleines = [];
  try {
    fichesPleines = await Promise.all(state.fichesList.map(f => getFiche(f.id)));
  } catch (e) {
    if (!confirm(`Au moins une fiche n'a pas pu être chargée (${e.message}). Exporter quand même les fiches disponibles ?`)) return;
    fichesPleines = fichesPleines.filter(Boolean);
  }
  const payload = {
    _meta: {
      app: 'Palace Comedy — Simulateur devis',
      version: 'V2.6 (cloud)',
      exportDate: nowIso(),
      nbFiches: fichesPleines.length,
      nbBddItems: state.bddItems.length,
      nbFormules: state.formulesList.length
    },
    fiches: fichesPleines,
    bddItems: state.bddItems,
    formules: state.formulesList
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `palace-fiches-${dateStr}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const incoming = Array.isArray(data) ? data : (data.fiches || []);
      const incomingBdd = data.bddItems || [];
      const incomingFormules = data.formules || [];
      if (!Array.isArray(incoming) || incoming.length === 0) {
        alert('Aucune fiche trouvée dans ce fichier.');
        return;
      }
      const choix = confirm(`${incoming.length} fiche(s)${incomingBdd.length ? ' + ' + incomingBdd.length + ' item(s) BDD' : ''}${incomingFormules.length ? ' + ' + incomingFormules.length + ' formule(s)' : ''}.\n\nOK = FUSIONNER avec l'existant (cloud).\nAnnuler = REMPLACER tout (cloud).`);

      // Upload fiches une par une (PUT avec id explicite)
      for (const f of incoming) {
        if (!f.id) f.id = genId();
        try {
          await putFiche(f.id, f);
        } catch (err) {
          console.error('Import fiche échoué', f.id, err);
        }
      }

      if (choix) {
        // Fusion bdd / formules : merge par id puis PUT
        incomingBdd.forEach(b => {
          if (!b.id) b.id = 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          const idx = state.bddItems.findIndex(x => x.id === b.id);
          if (idx >= 0) state.bddItems[idx] = b; else state.bddItems.push(b);
        });
        incomingFormules.forEach(fm => {
          if (!fm.id) fm.id = 'fm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          const idx = state.formulesList.findIndex(x => x.id === fm.id);
          if (idx >= 0) state.formulesList[idx] = fm; else state.formulesList.push(fm);
        });
      } else {
        if (!confirm(`Confirmer le REMPLACEMENT total côté cloud ?`)) {
          event.target.value = '';
          return;
        }
        if (incomingBdd.length > 0) state.bddItems = incomingBdd;
        if (incomingFormules.length > 0) state.formulesList = incomingFormules;
      }
      // PUT bdd-items et formules en bloc
      await putBddItems(state.bddItems);
      await putFormules(state.formulesList);

      // Recharge l'index pour refléter les uploads
      await loadFichesIndexFromCloud();

      refreshFichesSelect();
      refreshDashboard();
      refreshBddTable();
      refreshBddSelect();
      refreshFormulesTable();
      refreshFormulesSelect();
      if (!$('tabCalendrier').classList.contains('hidden')) renderCalendrier();
      alert(`Import terminé. ${state.fichesList.length} fiches, ${state.bddItems.length} items BDD, ${state.formulesList.length} formules.`);
    } catch (err) {
      alert('Fichier JSON invalide : ' + err.message);
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// --- Dashboard pipe commercial ---
// Utilise les champs de l'index (statut, totalHT directement, pas resultsSnapshot).
export function refreshDashboard() {
  const total = state.fichesList.length;
  const counts = { brouillon: 0, envoye: 0, accepte: 0, refuse: 0 };
  let caAccepte = 0;
  state.fichesList.forEach(f => {
    counts[f.statut || 'brouillon'] = (counts[f.statut || 'brouillon'] || 0) + 1;
    if (f.statut === 'accepte' && typeof f.totalHT === 'number') {
      caAccepte += f.totalHT;
    }
  });
  $('dashTotal').textContent = total;
  $('dashBrouillon').textContent = counts.brouillon;
  $('dashEnvoye').textContent = counts.envoye;
  $('dashAccepte').textContent = counts.accepte;
  const enJeu = counts.envoye + counts.accepte + counts.refuse;
  $('dashTaux').textContent = enJeu > 0 ? Math.round(counts.accepte / enJeu * 100) + '%' : '—';
  $('dashCA').textContent = caAccepte > 0 ? fmt(caAccepte) : '—';
}

export function registerFichesListeners() {
  $('selectFiche').addEventListener('change', e => {
    const id = e.target.value;
    if (!id) { newFiche(false); return; }
    if (state.isDirty && !confirm('Tu as des modifications non sauvegardées. Les abandonner ?')) {
      $('selectFiche').value = state.currentFicheId || '';
      return;
    }
    loadFiche(id);
  });

  ['ficheNom','ficheClient','ficheEmail','ficheTel','ficheDateEvent','ficheHeureArrivee','ficheHeureSpectacle','ficheNotes'].forEach(id => {
    $(id).addEventListener('input', () => setDirty(true));
  });
  $('ficheStatut').addEventListener('change', () => { setDirty(true); refreshStatutBadge(); });

  document.querySelectorAll('.sidebar input, .sidebar select, .sidebar textarea').forEach(el => {
    el.addEventListener('input', () => setDirty(true));
    el.addEventListener('change', () => setDirty(true));
  });

  document.addEventListener('input', e => {
    if (e.target.dataset && e.target.dataset.i !== undefined) setDirty(true);
  }, true);

  $('format').addEventListener('change', refreshHeureSpectacleVisibility);

  window.addEventListener('beforeunload', e => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
