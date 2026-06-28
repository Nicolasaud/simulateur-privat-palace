// CRM — gestion des prospects/leads de privatisation
//
// Pattern strictement aligné sur fiches.js :
//   - state.crmList : INDEX léger (chargé via listCrm)
//   - getProspect(id) : prospect complet à la demande
//   - 2 vues sur le même dataset : tableau (filtrable) et kanban (drag & drop par statut)
//
// Liens CRM ↔ Devis :
//   - createDevisFromProspect(id) : pré-remplit le simulateur, bascule sur l'onglet
//     Simulateur, mémorise un "prospect en attente de liaison" (window._pendingProspectLink).
//     Quand l'utilisateur enregistre la fiche, fiches.js appelle linkPendingProspectFiche()
//     pour ajouter l'id de la fiche aux fichesIds du prospect et persister.

import { $, fmt } from './helpers.js';
import { state } from './state.js';
import {
  listCrm, getProspect, putProspect, deleteProspectApi,
  getFiche, getCrmTodo, putCrmTodo
} from './api.js';
import { showToast } from './ui-feedback.js';
import { switchTab } from './onglets.js';
import { newFiche, setDirty } from './fiches.js';

// === Constantes domaine ===
export const CRM_STATUTS = [
  { id: 'a_contacter',   label: 'À contacter' },
  { id: 'en_discussion', label: 'En discussion' },
  { id: 'devis_envoye',  label: 'Devis envoyé' },
  { id: 'gagne',         label: 'Gagné' },
  { id: 'perdu',         label: 'Perdu' }
];

export const CRM_SOURCES = [
  'Recommandation', 'Site web', 'Salon / Networking',
  'Réseau direct', 'Réseaux sociaux', 'Appel entrant', 'Autre'
];

export const CRM_TYPES_EVENT = [
  'Soirée privée', 'CSE / Comité d\'entreprise', 'Anniversaire',
  'Séminaire / Team building', 'Mariage', 'Lancement produit',
  'Cocktail / Networking', 'Autre'
];

// === Helpers ===
function genId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function statutLabel(id) {
  return CRM_STATUTS.find(s => s.id === id)?.label || id;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// === Chargement cloud ===
export async function loadCrmFromCloud() {
  try {
    const index = await listCrm();
    state.crmList = Array.isArray(index) ? index : [];
  } catch (e) {
    console.error('Lecture index CRM cloud échouée', e);
    state.crmList = [];
  }
}

// === Filtres (table view) ===
const filters = {
  query: '',
  statut: '',
  source: '',
  typeEvenement: ''
};

function applyFilters(list) {
  return list.filter(p => {
    if (filters.statut && p.statut !== filters.statut) return false;
    if (filters.source && p.source !== filters.source) return false;
    if (filters.typeEvenement && p.typeEvenement !== filters.typeEvenement) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const hay = [
        p.societe, p.contactNom, p.contactEmail, p.contactTel
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// === Rendu : tableau ===
export function renderCrmTable() {
  const tbody = document.querySelector('#crmTable tbody');
  if (!tbody) return;
  const rows = applyFilters(state.crmList || []);
  // Tri : prochain contact ascendant (vide à la fin), puis updated_at desc
  rows.sort((a, b) => {
    const aDate = a.dateProchainContact || '';
    const bDate = b.dateProchainContact || '';
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });
  tbody.innerHTML = rows.length === 0
    ? `<tr><td colspan="8" style="text-align:center;color:#888;padding:24px;font-style:italic">Aucun prospect ne correspond aux filtres. Crée le premier avec « + Nouveau prospect ».</td></tr>`
    : rows.map(p => `
      <tr data-prospect-id="${p.id}" class="crmRow">
        <td><strong>${escapeHtml(p.societe || '—')}</strong>${p.contactNom ? `<br><span class="legend" style="font-style:normal">${escapeHtml(p.contactNom)}</span>` : ''}</td>
        <td>${p.contactEmail ? `<a href="mailto:${escapeHtml(p.contactEmail)}">${escapeHtml(p.contactEmail)}</a><br>` : ''}${escapeHtml(p.contactTel || '')}</td>
        <td>${escapeHtml(p.typeEvenement || '—')}</td>
        <td class="num">${p.nbPersonnes ?? '—'}</td>
        <td>${fmtDate(p.dateEnvisagee)}</td>
        <td class="num">${typeof p.budgetAnnonce === 'number' ? fmt(p.budgetAnnonce) : '—'}</td>
        <td><span class="crmStatutBadge ${p.statut}">${statutLabel(p.statut)}</span>${p.nbFichesLiees > 0 ? `<br><span class="legend" style="font-style:normal">${p.nbFichesLiees} devis</span>` : ''}</td>
        <td>${fmtDate(p.dateProchainContact)}</td>
      </tr>
    `).join('');
}

// === Rendu : kanban ===
export function renderCrmKanban() {
  const grid = document.getElementById('crmKanbanGrid');
  if (!grid) return;
  const list = applyFilters(state.crmList || []);
  grid.innerHTML = CRM_STATUTS.map(s => {
    const items = list.filter(p => (p.statut || 'a_contacter') === s.id);
    const cards = items.map(p => `
      <div class="crmCard statut-${p.statut}" data-prospect-id="${p.id}" draggable="true">
        <div class="crmCardTitle">${escapeHtml(p.societe || '—')}</div>
        ${p.contactNom ? `<div class="crmCardSub">${escapeHtml(p.contactNom)}</div>` : ''}
        <div class="crmCardMeta">
          ${p.typeEvenement ? `<span>${escapeHtml(p.typeEvenement)}</span>` : ''}
          ${p.nbPersonnes ? `<span>${p.nbPersonnes} pers.</span>` : ''}
          ${p.dateEnvisagee ? `<span>${fmtDate(p.dateEnvisagee)}</span>` : ''}
        </div>
        ${typeof p.budgetAnnonce === 'number' ? `<div class="crmCardBudget">${fmt(p.budgetAnnonce)} HT</div>` : ''}
        ${p.nbFichesLiees > 0 ? `<div class="crmCardDevis">📄 ${p.nbFichesLiees} devis</div>` : ''}
        ${p.dateProchainContact ? `<div class="crmCardRelance">📞 ${fmtDate(p.dateProchainContact)}</div>` : ''}
      </div>
    `).join('');
    return `
      <div class="crmColumn" data-statut="${s.id}">
        <div class="crmColumnHeader">
          <span class="crmColumnTitle">${s.label}</span>
          <span class="crmColumnCount">${items.length}</span>
        </div>
        <div class="crmColumnBody">${cards || '<p class="legend" style="text-align:center;padding:12px">Glisse une carte ici</p>'}</div>
      </div>
    `;
  }).join('');
  wireKanbanDragDrop();
}

function wireKanbanDragDrop() {
  const grid = document.getElementById('crmKanbanGrid');
  if (!grid) return;
  grid.querySelectorAll('.crmCard').forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', card.dataset.prospectId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openProspectEditor(card.dataset.prospectId));
  });
  grid.querySelectorAll('.crmColumn').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('dropTarget'); });
    col.addEventListener('dragleave', () => col.classList.remove('dropTarget'));
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('dropTarget');
      const id = e.dataTransfer.getData('text/plain');
      const newStatut = col.dataset.statut;
      await changeProspectStatut(id, newStatut);
    });
  });
}

async function changeProspectStatut(id, newStatut) {
  const entry = state.crmList.find(p => p.id === id);
  if (!entry || entry.statut === newStatut) return;
  try {
    const full = await getProspect(id);
    full.statut = newStatut;
    const saved = await putProspect(id, full);
    // MAJ index local immédiate
    entry.statut = saved.statut;
    entry.updated_at = saved.updated_at;
    entry.updated_by = saved.updated_by;
    renderCrmKanban();
    renderCrmTable();
    showToast(`Statut → ${statutLabel(newStatut)}`, 'success', 1500);
  } catch (e) {
    showToast(`Échec : ${e.body?.error || e.message}`, 'error');
  }
}

// === À FAIRE CETTE SEMAINE — liste auto (relances ≤ 7j) + notes manuelles ===
function isWithinWeek(iso) {
  if (!iso) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(today.getDate() + 7);
  const d = new Date(iso); if (isNaN(d)) return false;
  d.setHours(0, 0, 0, 0);
  return d >= today && d <= week;
}

export function renderCrmTodoSemaine() {
  const root = document.getElementById('crmTodoAuto');
  if (!root) return;
  const relances = (state.crmList || [])
    .filter(p => isWithinWeek(p.dateProchainContact))
    .sort((a, b) => (a.dateProchainContact || '').localeCompare(b.dateProchainContact || ''));
  if (relances.length === 0) {
    root.innerHTML = '<p class="crmTodoEmpty">Aucune relance prévue cette semaine 🎉</p>';
    return;
  }
  root.innerHTML = `
    <ul class="crmTodoAutoList">
      ${relances.map(p => `
        <li data-prospect-id="${p.id}" class="crmTodoAutoItem">
          <span class="crmTodoDate">${fmtDate(p.dateProchainContact)}</span>
          <span class="crmTodoSociete">${escapeHtml(p.societe || '—')}</span>
          ${p.contactNom ? `<span class="crmTodoContact">${escapeHtml(p.contactNom)}</span>` : ''}
          <span class="crmStatutBadge ${p.statut}">${statutLabel(p.statut)}</span>
        </li>
      `).join('')}
    </ul>
  `;
  root.querySelectorAll('li[data-prospect-id]').forEach(li => {
    li.addEventListener('click', () => openProspectEditor(li.dataset.prospectId));
  });
}

export async function loadCrmTodoManualFromCloud() {
  try {
    const data = await getCrmTodo();
    state.crmTodoManual = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Chargement crm-todo échoué', e);
    state.crmTodoManual = [];
  }
}

export function renderCrmTodoManual() {
  const root = document.getElementById('crmTodoList');
  if (!root) return;
  const items = state.crmTodoManual || [];
  if (items.length === 0) {
    root.innerHTML = '<li class="crmTodoEmpty">Aucune note manuelle. Ajoute une tâche au-dessus.</li>';
    return;
  }
  root.innerHTML = items.map(it => `
    <li data-id="${it.id}" class="crmTodoManualItem ${it.done ? 'done' : ''}">
      <label>
        <input type="checkbox" ${it.done ? 'checked' : ''}>
        <span>${escapeHtml(it.text)}</span>
      </label>
      <button class="crmTodoDel" title="Supprimer">×</button>
    </li>
  `).join('');
  root.querySelectorAll('li[data-id]').forEach(li => {
    const id = li.dataset.id;
    li.querySelector('input[type=checkbox]').addEventListener('change', e => toggleTodoItem(id, e.target.checked));
    li.querySelector('.crmTodoDel').addEventListener('click', () => deleteTodoItem(id));
  });
}

async function persistTodoManual() {
  try { await putCrmTodo(state.crmTodoManual); }
  catch (e) { showToast('Sauvegarde des notes échouée', 'error'); console.warn(e); }
}

async function addTodoItem() {
  const input = document.getElementById('crmTodoInput');
  const text = (input.value || '').trim();
  if (!text) return;
  const it = { id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false };
  state.crmTodoManual.push(it);
  input.value = '';
  renderCrmTodoManual();
  await persistTodoManual();
}

async function toggleTodoItem(id, done) {
  const it = state.crmTodoManual.find(x => x.id === id);
  if (!it) return;
  it.done = done;
  renderCrmTodoManual();
  await persistTodoManual();
}

async function deleteTodoItem(id) {
  state.crmTodoManual = state.crmTodoManual.filter(x => x.id !== id);
  renderCrmTodoManual();
  await persistTodoManual();
}


// === Modal éditeur prospect ===
let editingId = null;

export function openProspectEditor(id) {
  editingId = id;
  loadIntoEditor(id);
}

async function loadIntoEditor(id) {
  const modal = document.getElementById('crmModal');
  const body = document.getElementById('crmModalBody');
  modal.classList.remove('hidden');
  body.innerHTML = '<p style="text-align:center;padding:30px">Chargement…</p>';

  let p = null;
  if (id) {
    try { p = await getProspect(id); }
    catch (e) {
      body.innerHTML = `<p class="alerte error">Impossible de charger : ${e.message}</p>`;
      return;
    }
  }
  p = p || {
    id: null, societe: '', contactNom: '', contactEmail: '', contactTel: '',
    source: '', typeEvenement: '', nbPersonnes: '', dateEnvisagee: '',
    budgetAnnonce: '', statut: 'a_contacter', dateProchainContact: '',
    notes: '', fichesIds: []
  };

  // Charger les fiches liées (en parallèle, best effort)
  let fichesLiees = [];
  if (Array.isArray(p.fichesIds) && p.fichesIds.length > 0) {
    const results = await Promise.allSettled(p.fichesIds.map(fid => getFiche(fid)));
    fichesLiees = results
      .map((r, i) => r.status === 'fulfilled' ? r.value : { id: p.fichesIds[i], _missing: true })
      .filter(Boolean);
  }

  const traceHTML = (p.created_by && p.created_at)
    ? `<p class="ficheTrace" style="margin-top:0">Créé par ${escapeHtml(p.created_by)} le ${fmtTrace(p.created_at)}${p.updated_at !== p.created_at ? ` · Modifié par ${escapeHtml(p.updated_by)} le ${fmtTrace(p.updated_at)}` : ''}</p>`
    : '';

  body.innerHTML = `
    <button class="modalClose" onclick="closeProspectEditor()" title="Fermer">×</button>
    <h2 style="margin-top:0">${id ? 'Modifier le prospect' : 'Nouveau prospect'}</h2>
    ${traceHTML}

    <div class="crmEditorGrid">
      <div>
        <label>Société / CSE *</label>
        <input type="text" id="cpSociete" value="${escapeAttr(p.societe)}" placeholder="Ex : Cointreau">
      </div>
      <div>
        <label>Nom du contact</label>
        <input type="text" id="cpContactNom" value="${escapeAttr(p.contactNom)}" placeholder="Prénom Nom">
      </div>
      <div>
        <label>Email</label>
        <input type="text" id="cpContactEmail" value="${escapeAttr(p.contactEmail)}" inputmode="email">
      </div>
      <div>
        <label>Téléphone</label>
        <input type="text" id="cpContactTel" value="${escapeAttr(p.contactTel)}" inputmode="tel">
      </div>
      <div>
        <label>Source</label>
        <select id="cpSource">
          <option value="">—</option>
          ${CRM_SOURCES.map(s => `<option value="${escapeAttr(s)}" ${p.source === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Type d'événement</label>
        <select id="cpTypeEvent">
          <option value="">—</option>
          ${CRM_TYPES_EVENT.map(s => `<option value="${escapeAttr(s)}" ${p.typeEvenement === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Nb personnes estimé</label>
        <input type="number" id="cpNbPers" value="${p.nbPersonnes ?? ''}" min="0">
      </div>
      <div>
        <label>Date envisagée</label>
        <input type="date" id="cpDateEvent" value="${escapeAttr(p.dateEnvisagee)}">
      </div>
      <div>
        <label>Budget annoncé (€ HT)</label>
        <input type="number" id="cpBudget" value="${p.budgetAnnonce ?? ''}" min="0" step="100">
      </div>
      <div>
        <label>Statut commercial</label>
        <select id="cpStatut">
          ${CRM_STATUTS.map(s => `<option value="${s.id}" ${p.statut === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Prochain contact / relance</label>
        <input type="date" id="cpRelance" value="${escapeAttr(p.dateProchainContact)}">
      </div>
    </div>

    <label style="margin-top:14px">Notes / historique des échanges</label>
    <textarea id="cpNotes" placeholder="Notes datées : 12/06 - 1er appel, demande devis pour 60p le 15/09...&#10;19/06 - Relance email, attend retour budget&#10;...">${escapeHtml(p.notes || '')}</textarea>

    <div class="crmFichesLiees">
      <h3 style="margin-top:18px">Devis liés (${fichesLiees.length})</h3>
      ${fichesLiees.length === 0
        ? `<p class="legend">Aucun devis lié pour l'instant. Utilise « Créer fiche devis » ci-dessous pour démarrer un devis pré-rempli depuis ce prospect.</p>`
        : `<ul class="crmFichesList">${fichesLiees.map(f => f._missing
            ? `<li><em>Devis ${f.id} — supprimé</em></li>`
            : `<li><a href="#" onclick="openFicheFromCrm('${f.id}');return false">${escapeHtml(f.nomFiche || '(sans nom)')}</a> · ${escapeHtml(f.client || '?')} · ${f.dateEvent ? fmtDate(f.dateEvent) : '—'} · <span class="statutBadge ${f.statut || 'brouillon'}">${escapeHtml(f.statut || 'brouillon')}</span>${typeof f.resultsSnapshot?.totalHT === 'number' ? ` · ${fmt(f.resultsSnapshot.totalHT)} HT` : ''}</li>`
          ).join('')}</ul>`
      }
    </div>

    <div class="modalActions">
      ${id ? `<button class="delete" onclick="deleteProspect()">Supprimer</button>` : ''}
      <button onclick="closeProspectEditor()">Annuler</button>
      <button onclick="createDevisFromProspect()" class="primary">📄 Créer fiche devis</button>
      <button onclick="saveProspect()" class="primary">Enregistrer</button>
    </div>
  `;
}

export function closeProspectEditor() {
  document.getElementById('crmModal').classList.add('hidden');
  editingId = null;
}

function readEditorForm() {
  const num = v => v === '' || v === null ? null : Number(v);
  return {
    societe:           $('cpSociete').value.trim(),
    contactNom:        $('cpContactNom').value.trim(),
    contactEmail:      $('cpContactEmail').value.trim(),
    contactTel:        $('cpContactTel').value.trim(),
    source:            $('cpSource').value,
    typeEvenement:     $('cpTypeEvent').value,
    nbPersonnes:       num($('cpNbPers').value),
    dateEnvisagee:     $('cpDateEvent').value,
    budgetAnnonce:     num($('cpBudget').value),
    statut:            $('cpStatut').value,
    dateProchainContact: $('cpRelance').value,
    notes:             $('cpNotes').value
  };
}

export async function saveProspect() {
  const form = readEditorForm();
  if (!form.societe) {
    showToast('Le nom de la société/CSE est obligatoire', 'error');
    $('cpSociete')?.focus();
    return;
  }
  const id = editingId || genId();
  // Conserve les fichesIds existants en cas de MAJ
  let payload = { ...form };
  if (editingId) {
    try {
      const existing = await getProspect(id);
      payload.fichesIds = existing.fichesIds || [];
    } catch { payload.fichesIds = []; }
  } else {
    payload.fichesIds = [];
  }
  try {
    const saved = await putProspect(id, payload);
    // MAJ index local
    const entry = buildIndexEntry(saved);
    const i = state.crmList.findIndex(p => p.id === saved.id);
    if (i >= 0) state.crmList[i] = entry; else state.crmList.push(entry);
    renderCrmTable();
    renderCrmKanban();
    showToast('Prospect enregistré', 'success', 1500);
    closeProspectEditor();
  } catch (e) {
    showToast(`Échec : ${e.body?.error || e.message}`, 'error');
  }
}

export async function deleteProspect() {
  if (!editingId) return;
  const entry = state.crmList.find(p => p.id === editingId);
  if (!confirm(`Supprimer définitivement le prospect « ${entry?.societe || '(sans nom)'} » ?`)) return;
  try {
    await deleteProspectApi(editingId);
    state.crmList = state.crmList.filter(p => p.id !== editingId);
    renderCrmTable();
    renderCrmKanban();
    showToast('Prospect supprimé', 'success', 1500);
    closeProspectEditor();
  } catch (e) {
    if (e.status === 404) {
      state.crmList = state.crmList.filter(p => p.id !== editingId);
      renderCrmTable();
      renderCrmKanban();
      closeProspectEditor();
    } else {
      showToast(`Échec : ${e.body?.error || e.message}`, 'error');
    }
  }
}

// === Lien CRM → fiche devis ===
// Pré-remplit le simulateur depuis le prospect courant, bascule sur l'onglet
// Simulateur. Quand l'utilisateur sauvegardera la fiche, fiches.js appellera
// linkPendingProspectFiche() pour persister le lien.
export async function createDevisFromProspect() {
  if (!editingId) {
    // Cas "nouveau prospect non sauvegardé" : on enregistre d'abord, puis on crée le devis
    await saveProspect();
    if (!editingId) return;
  }
  const form = readEditorForm();
  // Crée une nouvelle fiche dans le simulateur (sans confirm, on a déjà l'accord)
  newFiche(false);
  // Pré-remplit les champs depuis le prospect
  $('ficheClient').value = form.societe || '';
  $('ficheEmail').value = form.contactEmail || '';
  $('ficheTel').value = form.contactTel || '';
  if (form.dateEnvisagee) $('ficheDateEvent').value = form.dateEnvisagee;
  // Nom de la fiche par défaut, basé sur la société + date
  const dStr = form.dateEnvisagee
    ? new Date(form.dateEnvisagee).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    : '';
  $('ficheNom').value = `Devis ${form.societe}${dStr ? ' ' + dStr : ''}`;
  // Ajoute une note initiale traçant la source CRM
  const noteInit = `Devis créé depuis CRM (${form.societe}${form.contactNom ? ' / ' + form.contactNom : ''})`;
  $('ficheNotes').value = noteInit;
  setDirty(true);
  // Mémorise le prospect en attente de liaison
  window._pendingProspectLink = editingId;
  closeProspectEditor();
  switchTab('simulateur');
  showToast('Fiche devis pré-remplie. Enregistre-la pour finaliser le lien CRM.', 'info', 4000);
}

// Appelé par fiches.js après un save réussi
export async function linkPendingProspectFiche(ficheId) {
  const prospectId = window._pendingProspectLink;
  if (!prospectId || !ficheId) return;
  try {
    const p = await getProspect(prospectId);
    if (!Array.isArray(p.fichesIds)) p.fichesIds = [];
    if (!p.fichesIds.includes(ficheId)) p.fichesIds.push(ficheId);
    // Bascule auto en "devis_envoye" si encore en a_contacter ou en_discussion
    if (p.statut === 'a_contacter' || p.statut === 'en_discussion') {
      p.statut = 'devis_envoye';
    }
    const saved = await putProspect(prospectId, p);
    // MAJ index local
    const entry = buildIndexEntry(saved);
    const i = state.crmList.findIndex(x => x.id === saved.id);
    if (i >= 0) state.crmList[i] = entry; else state.crmList.push(entry);
    renderCrmTable();
    renderCrmKanban();
    showToast(`Devis lié au prospect « ${saved.societe} »`, 'success', 2200);
  } catch (e) {
    console.warn('Lien CRM → fiche échoué', e);
  } finally {
    window._pendingProspectLink = null;
  }
}

// === Ouvrir une fiche depuis le CRM ===
export async function openFicheFromCrm(ficheId) {
  const { loadFiche } = await import('./fiches.js');
  closeProspectEditor();
  switchTab('simulateur');
  document.getElementById('selectFiche').value = ficheId;
  await loadFiche(ficheId);
}

// === Helpers de rendu ===
function buildIndexEntry(p) {
  return {
    id: p.id,
    societe: p.societe || '',
    contactNom: p.contactNom || '',
    contactEmail: p.contactEmail || '',
    contactTel: p.contactTel || '',
    source: p.source || '',
    typeEvenement: p.typeEvenement || '',
    nbPersonnes: p.nbPersonnes ?? null,
    dateEnvisagee: p.dateEnvisagee || '',
    budgetAnnonce: p.budgetAnnonce ?? null,
    statut: p.statut || 'a_contacter',
    dateProchainContact: p.dateProchainContact || '',
    nbFichesLiees: Array.isArray(p.fichesIds) ? p.fichesIds.length : 0,
    updated_at: p.updated_at,
    updated_by: p.updated_by
  };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

function fmtTrace(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}`;
}

// === Bascule de vue ===
export function setCrmView(view) {
  const wrapTable = document.getElementById('crmViewTable');
  const wrapKanban = document.getElementById('crmViewKanban');
  if (view === 'kanban') {
    wrapTable.classList.add('hidden');
    wrapKanban.classList.remove('hidden');
    renderCrmKanban();
  } else {
    wrapKanban.classList.add('hidden');
    wrapTable.classList.remove('hidden');
    renderCrmTable();
  }
  document.querySelectorAll('.crmViewToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}

// === Wire des listeners ===
export function registerCrmListeners() {
  // Bouton nouveau prospect
  document.getElementById('btnNewProspect')?.addEventListener('click', () => openProspectEditor(null));
  // Toggle vue
  document.querySelectorAll('.crmViewToggle button').forEach(b => {
    b.addEventListener('click', () => setCrmView(b.dataset.view));
  });
  // Filtres (table)
  document.getElementById('crmFilterQuery')?.addEventListener('input', e => {
    filters.query = e.target.value;
    renderCrmTable();
    renderCrmKanban();
  });
  document.getElementById('crmFilterStatut')?.addEventListener('change', e => {
    filters.statut = e.target.value;
    renderCrmTable();
    renderCrmKanban();
  });
  document.getElementById('crmFilterSource')?.addEventListener('change', e => {
    filters.source = e.target.value;
    renderCrmTable();
    renderCrmKanban();
  });
  document.getElementById('crmFilterType')?.addEventListener('change', e => {
    filters.typeEvenement = e.target.value;
    renderCrmTable();
    renderCrmKanban();
  });
  // Clic sur une ligne du tableau → ouvre l'éditeur
  document.querySelector('#crmTable tbody')?.addEventListener('click', e => {
    const tr = e.target.closest('tr.crmRow');
    if (tr && tr.dataset.prospectId) openProspectEditor(tr.dataset.prospectId);
  });
  // Fermeture modale au clic backdrop
  document.getElementById('crmModal')?.addEventListener('click', e => {
    if (e.target.id === 'crmModal') closeProspectEditor();
  });

  // TODO manuelles : bouton + ajouter + Enter dans le textarea
  document.getElementById('btnCrmTodoAdd')?.addEventListener('click', addTodoItem);
  document.getElementById('crmTodoInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addTodoItem();
    }
  });
}

// Initialise les <select> des filtres avec les options de domaine
export function initCrmFilters() {
  const selS = document.getElementById('crmFilterStatut');
  if (selS) selS.innerHTML = '<option value="">Tous statuts</option>' + CRM_STATUTS.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  const selSrc = document.getElementById('crmFilterSource');
  if (selSrc) selSrc.innerHTML = '<option value="">Toutes sources</option>' + CRM_SOURCES.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  const selT = document.getElementById('crmFilterType');
  if (selT) selT.innerHTML = '<option value="">Tous types</option>' + CRM_TYPES_EVENT.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
}
