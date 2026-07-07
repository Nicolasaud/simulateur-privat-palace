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
  { id: 'a_contacter',      label: 'À contacter' },
  { id: 'en_discussion',    label: 'En discussion' },
  { id: 'devis_envoye',     label: 'Devis envoyé' },
  { id: 'gagne',            label: 'Gagné' },
  { id: 'acompte_facture',  label: 'Acompte facturé' },
  { id: 'facture_solde',    label: 'Facture soldée' },
  { id: 'perdu',            label: 'Perdu' }
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

// Statuts considérés comme "gagné" (pipeline post-signature).
// Utilisés pour les stats de conversion et pour ignorer les rappels.
export const CRM_STATUTS_GAGNES = ['gagne', 'acompte_facture', 'facture_solde'];
export function isStatutGagne(id) { return CRM_STATUTS_GAGNES.includes(id); }
export function isStatutClos(id) { return isStatutGagne(id) || id === 'perdu'; }

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

// === À FAIRE CETTE SEMAINE — liste auto (relances en retard + ≤ 7j) + notes manuelles ===
function isWithinWeek(iso) {
  if (!iso) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(today.getDate() + 7);
  const d = new Date(iso); if (isNaN(d)) return false;
  d.setHours(0, 0, 0, 0);
  return d >= today && d <= week;
}

function isOverdue(iso, statut) {
  if (!iso) return false;
  // Prospects clos (gagnés ou perdus) : plus de relance nécessaire
  if (isStatutClos(statut)) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso); if (isNaN(d)) return false;
  d.setHours(0, 0, 0, 0);
  return d < today;
}

function daysBetween(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

export function renderCrmTodoSemaine() {
  const root = document.getElementById('crmTodoAuto');
  if (!root) return;

  // Prospects en retard (dateProchainContact < today, hors gagnés/perdus)
  const enRetard = (state.crmList || [])
    .filter(p => isOverdue(p.dateProchainContact, p.statut))
    .sort((a, b) => (a.dateProchainContact || '').localeCompare(b.dateProchainContact || ''));

  // Prospects à relancer cette semaine (0-7j à venir)
  const relances = (state.crmList || [])
    .filter(p => isWithinWeek(p.dateProchainContact))
    .sort((a, b) => (a.dateProchainContact || '').localeCompare(b.dateProchainContact || ''));

  if (enRetard.length === 0 && relances.length === 0) {
    root.innerHTML = '<p class="crmTodoEmpty">Aucune relance prévue cette semaine 🎉</p>';
    return;
  }

  let html = '';
  if (enRetard.length > 0) {
    html += `
      <div class="crmTodoOverdueBanner">
        <span class="crmTodoOverdueIcon">⚠️</span>
        <span><strong>${enRetard.length}</strong> relance${enRetard.length > 1 ? 's' : ''} en retard</span>
      </div>
      <ul class="crmTodoAutoList">
        ${enRetard.map(p => {
          const days = daysBetween(p.dateProchainContact);
          const retardLbl = days === -1 ? 'hier' : `il y a ${-days}j`;
          return `
            <li data-prospect-id="${p.id}" class="crmTodoAutoItem overdue" title="Relance en retard depuis ${retardLbl}">
              <span class="crmTodoDate crmTodoDateOverdue">🔴 ${fmtDate(p.dateProchainContact)} <em>(${retardLbl})</em></span>
              <span class="crmTodoSociete">${escapeHtml(p.societe || '—')}</span>
              ${p.contactNom ? `<span class="crmTodoContact">${escapeHtml(p.contactNom)}</span>` : ''}
              <span class="crmStatutBadge ${p.statut}">${statutLabel(p.statut)}</span>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  if (relances.length > 0) {
    html += `
      ${enRetard.length > 0 ? '<h4 style="margin:14px 0 6px 0;font-size:0.85em;color:#555;text-transform:uppercase;letter-spacing:0.05em">Cette semaine</h4>' : ''}
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
  }
  root.innerHTML = html;
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
      <div class="crmEmailDropdown">
        <button class="secondary" id="btnCrmEmailMenu" type="button">📧 Copier email…</button>
        <div class="crmEmailMenu" id="crmEmailMenu" hidden>
          ${EMAIL_TEMPLATES.map(t => `<button type="button" data-tpl="${t.id}"><strong>${escapeHtml(t.label)}</strong><span>${escapeHtml(t.sub)}</span></button>`).join('')}
        </div>
      </div>
      <button onclick="createDevisFromProspect()" class="primary">📄 Créer fiche devis</button>
      <button onclick="saveProspect()" class="primary">Enregistrer</button>
    </div>
  `;

  // Wire du menu email (Étape 8d)
  const btnMenu = document.getElementById('btnCrmEmailMenu');
  const menu = document.getElementById('crmEmailMenu');
  if (btnMenu && menu) {
    btnMenu.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
    });
    menu.querySelectorAll('button[data-tpl]').forEach(b => {
      b.addEventListener('click', () => {
        copyEmailTemplate(b.dataset.tpl, p);
        menu.hidden = true;
      });
    });
    document.addEventListener('click', (e) => {
      if (!btnMenu.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
    });
  }
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

// === Sync Simulateur → CRM ===
// Mapping statut fiche devis → statut prospect CRM.
const FICHE_STATUT_TO_CRM = {
  'brouillon':       'a_contacter',
  'envoye':          'devis_envoye',
  'accepte':         'gagne',
  'refuse':          'perdu',
  'acompte_facture': 'gagne',
  'facture_solde':   'gagne',
};

// Cherche un prospect existant par nom de société (match case-insensitive, trim).
function findProspectBySociete(nom) {
  const target = (nom || '').trim().toLowerCase();
  if (!target) return null;
  return state.crmList.find(p => (p.societe || '').trim().toLowerCase() === target) || null;
}

/**
 * Appelé après un putFiche() réussi côté simulateur.
 * - Si la fiche a `linkedProspectId` → propage juste le changement de statut.
 * - Sinon → cherche un prospect avec le même client, y lie la fiche.
 *   Si aucun prospect → en crée un nouveau avec le nom du client, statut = mapping.
 *
 * @param {object} saved - la fiche fraîchement enregistrée (retour de putFiche)
 * @param {object|null} oldFiche - la fiche telle qu'elle était avant le save
 *                                 (utile pour détecter les changements de statut)
 * @returns {Promise<{prospectId: string|null, action: 'linked'|'created'|'statut'|'noop'}>}
 */
export async function syncFicheToProspect(saved, oldFiche) {
  const clientName = (saved.client || '').trim();
  if (!clientName) return { prospectId: null, action: 'noop' };

  let prospectId = saved.linkedProspectId || null;

  // Cas 1 : pas de liaison → chercher/créer
  if (!prospectId) {
    let existing = findProspectBySociete(clientName);
    if (existing) {
      // Prospect trouvé → charger la version complète et lier
      try {
        const full = await getProspect(existing.id);
        full.fichesIds = Array.isArray(full.fichesIds) ? full.fichesIds : [];
        if (!full.fichesIds.includes(saved.id)) full.fichesIds.push(saved.id);
        // MAJ statut du prospect si le mapping le change
        const targetStatut = FICHE_STATUT_TO_CRM[saved.statut] || full.statut;
        if (full.statut !== targetStatut) full.statut = targetStatut;
        const savedProspect = await putProspect(full.id, full);
        updateCrmIndexLocal(savedProspect);
        prospectId = savedProspect.id;
      } catch (e) {
        console.warn('sync fiche→CRM (lier prospect existant) échoué', e);
        return { prospectId: null, action: 'noop' };
      }
    } else {
      // Créer un nouveau prospect avec ce nom
      try {
        const newId = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const newProspect = {
          societe: clientName,
          contactEmail: saved.contactEmail || '',
          contactTel: saved.contactTel || '',
          dateEnvisagee: saved.dateEvent || '',
          statut: FICHE_STATUT_TO_CRM[saved.statut] || 'a_contacter',
          fichesIds: [saved.id],
          notes: `Créé automatiquement depuis fiche devis « ${saved.nomFiche || saved.id} »`,
        };
        const savedProspect = await putProspect(newId, newProspect);
        updateCrmIndexLocal(savedProspect);
        prospectId = savedProspect.id;
        showToast(`Prospect « ${clientName} » créé dans le CRM`, 'success', 2200);
      } catch (e) {
        console.warn('sync fiche→CRM (création) échoué', e);
        return { prospectId: null, action: 'noop' };
      }
    }
    // Retour : indique au caller de persister linkedProspectId sur la fiche
    return { prospectId, action: existing ? 'linked' : 'created' };
  }

  // Cas 2 : déjà lié → propager le changement de statut si applicable
  const oldStatut = oldFiche?.statut;
  const newStatut = saved.statut;
  if (oldStatut === newStatut) return { prospectId, action: 'noop' };
  const targetCrmStatut = FICHE_STATUT_TO_CRM[newStatut];
  if (!targetCrmStatut) return { prospectId, action: 'noop' };
  try {
    const full = await getProspect(prospectId);
    if (full.statut !== targetCrmStatut) {
      full.statut = targetCrmStatut;
      const savedProspect = await putProspect(prospectId, full);
      updateCrmIndexLocal(savedProspect);
    }
    return { prospectId, action: 'statut' };
  } catch (e) {
    console.warn('sync fiche→CRM (MAJ statut) échoué', e);
    return { prospectId, action: 'noop' };
  }
}

function updateCrmIndexLocal(prospect) {
  const entry = buildIndexEntry(prospect);
  const i = state.crmList.findIndex(x => x.id === prospect.id);
  if (i >= 0) state.crmList[i] = entry; else state.crmList.push(entry);
  // Rafraîchir l'onglet CRM s'il est ouvert (best-effort)
  try {
    if (!document.getElementById('tabCrm')?.classList.contains('hidden')) {
      renderCrmTable();
      renderCrmKanban();
    }
  } catch {}
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

// === Étape 8d — Templates emails (qualification / relance / remerciement) ==
// Chaque template génère un objet {subject, body} en substituant les
// placeholders depuis le prospect : {societe}, {contactPrenom}, {contactNom},
// {dateEvent}, {nbPersonnes}. Les valeurs manquantes sont laissées vides.
export const EMAIL_TEMPLATES = [
  {
    id: 'qualification',
    label: '🎯 Qualification (1er contact)',
    sub: 'Demande des 5 infos clés (type, date, nb pers, budget, attentes)',
    subject: 'Palace Comedy — votre projet {societe}',
    body: `Bonjour{contactPrenom_slot},

Merci pour votre intérêt pour Palace Comedy 🎭. Pour vous préparer une proposition sur-mesure, j'aurais besoin de préciser quelques points :

1️⃣ Type d'événement (soirée privée, CSE, séminaire, anniv...) : 
2️⃣ Date envisagée (ou plage de dates) : {dateEvent}
3️⃣ Nombre de personnes estimé : {nbPersonnes}
4️⃣ Budget indicatif HT (fourchette) : 
5️⃣ Attentes clés (spectacle + repas assis, cocktail dînatoire, atelier team-building...) : 

Dès réception, je vous envoie un devis chiffré sous 48h avec plusieurs options.

À très vite,
L'équipe Palace Comedy
palacecomedy.com`
  },
  {
    id: 'relance_j7',
    label: '⏰ Relance J+7',
    sub: 'Suite à un devis envoyé, sans retour depuis 1 semaine',
    subject: 'Palace Comedy — {societe}, on avance ?',
    body: `Bonjour{contactPrenom_slot},

Je reviens vers vous suite à ma proposition envoyée la semaine dernière pour votre événement {societe} (~ {nbPersonnes} pers.).

Quelques questions rapides :
• Le devis correspond-il à votre cadrage ?
• Y a-t-il des ajustements souhaités (date, formule, budget) ?
• Un créneau vous conviendrait-il pour un point de 15min cette semaine ?

Nous avons quelques créneaux qui se libèrent sur {dateEvent}, dites-moi si vous voulez que je vous les bloque.

Excellente journée,
L'équipe Palace Comedy`
  },
  {
    id: 'confirmation',
    label: '✅ Confirmation (post-signature)',
    sub: 'Envoi acompte + logistique après acceptation du devis',
    subject: 'Palace Comedy — Confirmation {societe} le {dateEvent}',
    body: `Bonjour{contactPrenom_slot},

Nous confirmons avec plaisir votre événement {societe} le {dateEvent} pour {nbPersonnes} personnes 🎉

Prochaines étapes :
📌 Facture d'acompte 30% envoyée en pièce jointe (à régler sous 15 jours)
📌 Point logistique 3 semaines avant (aménagement salle, choix vins, timing)
📌 Rappel J-7 pour ajustements de dernière minute (nb pers définitif, régimes alim...)

En attendant, n'hésitez pas si des questions surgissent. Nous sommes ravis de vous accueillir !

L'équipe Palace Comedy`
  },
  {
    id: 'remerciement',
    label: '💐 Remerciement (post-événement)',
    sub: 'Après l\'événement, demande d\'avis + fidélisation',
    subject: 'Palace Comedy — Merci pour {societe} !',
    body: `Bonjour{contactPrenom_slot},

Un grand merci d'avoir choisi Palace Comedy pour votre événement {societe} 🙏

Nous serions ravis de recueillir vos retours :
✍️ Un mot sur ce qui vous a plu / ce qui pourrait être amélioré ?
⭐ Un avis Google (2 min) ferait un bien fou à notre équipe : [lien à insérer]

Et si l'envie de renouveler l'expérience vous prend (anniversaire d'équipe, prochain séminaire, soirée client...), nous offrons -10% sur toute réservation dans les 6 mois qui suivent.

Très belle continuation,
L'équipe Palace Comedy`
  }
];

function fillPlaceholders(tpl, p) {
  const prenom = (p.contactNom || '').split(' ')[0] || '';
  const dateEvent = p.dateEnvisagee
    ? new Date(p.dateEnvisagee).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '[à préciser]';
  const nbPers = p.nbPersonnes ? `${p.nbPersonnes} personnes` : '[à préciser]';
  const contactPrenomSlot = prenom ? ` ${prenom}` : '';
  const map = {
    '{societe}': p.societe || '[société]',
    '{contactPrenom}': prenom,
    '{contactPrenom_slot}': contactPrenomSlot,
    '{contactNom}': p.contactNom || '',
    '{dateEvent}': dateEvent,
    '{nbPersonnes}': nbPers
  };
  const substitute = (s) => Object.entries(map).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  return {
    subject: substitute(tpl.subject),
    body: substitute(tpl.body)
  };
}

async function copyEmailTemplate(tplId, prospect) {
  const tpl = EMAIL_TEMPLATES.find(t => t.id === tplId);
  if (!tpl) return;
  const { subject, body } = fillPlaceholders(tpl, prospect);
  const full = `Objet : ${subject}\n\n${body}`;
  try {
    await navigator.clipboard.writeText(full);
    showToast(`Email « ${tpl.label} » copié dans le presse-papiers`, 'success', 2500);
  } catch (e) {
    // Fallback : afficher dans un prompt pour copie manuelle
    prompt('Impossible de copier automatiquement — sélectionne et Ctrl+C :', full);
  }
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

  // Étape 8 CRM : Export CSV + Stats
  document.getElementById('btnCrmExport')?.addEventListener('click', exportCrmCsv);
  document.getElementById('btnCrmStats')?.addEventListener('click', toggleCrmStats);
  document.getElementById('btnCrmStatsToggle')?.addEventListener('click', () => {
    const card = document.getElementById('crmStatsCard');
    if (card) card.style.display = 'none';
  });
}

// === Étape 8a — Export CSV ================================================
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function exportCrmCsv() {
  const list = state.crmList || [];
  if (list.length === 0) {
    showToast('Aucun prospect à exporter', 'info');
    return;
  }
  const cols = [
    { key: 'societe', label: 'Société' },
    { key: 'contactNom', label: 'Contact' },
    { key: 'contactEmail', label: 'Email' },
    { key: 'contactTel', label: 'Téléphone' },
    { key: 'source', label: 'Source' },
    { key: 'typeEvenement', label: 'Type événement' },
    { key: 'nbPersonnes', label: 'Nb personnes' },
    { key: 'dateEnvisagee', label: 'Date envisagée' },
    { key: 'budgetAnnonce', label: 'Budget HT' },
    { key: 'statut', label: 'Statut', transform: statutLabel },
    { key: 'dateProchainContact', label: 'Prochaine relance' },
    { key: 'nbFiches', label: 'Nb devis', transform: (_, p) => (p.fichesIds || []).length },
    { key: 'created_at', label: 'Créé le', transform: v => v ? new Date(v).toLocaleDateString('fr-FR') : '' },
    { key: 'updated_at', label: 'Modifié le', transform: v => v ? new Date(v).toLocaleDateString('fr-FR') : '' }
  ];
  const header = cols.map(c => csvEscape(c.label)).join(';');
  const rows = list.map(p => cols.map(c => {
    const raw = p[c.key];
    const v = c.transform ? c.transform(raw, p) : raw;
    return csvEscape(v);
  }).join(';'));
  const csv = '\ufeff' + [header, ...rows].join('\r\n');   // BOM UTF-8 pour Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().substring(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crm-prospects-${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${list.length} prospect${list.length > 1 ? 's' : ''} exporté${list.length > 1 ? 's' : ''} en CSV`, 'success');
}

// === Étape 8b — Statistiques CRM =========================================
function toggleCrmStats() {
  const card = document.getElementById('crmStatsCard');
  if (!card) return;
  const visible = card.style.display !== 'none';
  if (visible) {
    card.style.display = 'none';
  } else {
    card.style.display = 'block';
    renderCrmStats();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderCrmStats() {
  const grid = document.getElementById('crmStatsGrid');
  if (!grid) return;
  const list = state.crmList || [];
  const total = list.length;
  if (total === 0) {
    grid.innerHTML = '<p class="legend" style="grid-column:1/-1;text-align:center;padding:20px">Aucun prospect encore enregistré.</p>';
    return;
  }
  const gagnes = list.filter(p => isStatutGagne(p.statut)).length;
  const perdus = list.filter(p => p.statut === 'perdu').length;
  const enCours = total - gagnes - perdus;
  const closes = gagnes + perdus;
  const tauxGlobal = closes > 0 ? (gagnes / closes * 100) : 0;

  const groupBy = (getter) => {
    const acc = new Map();
    list.forEach(p => {
      const k = getter(p) || '(non renseigné)';
      const cur = acc.get(k) || { total: 0, gagne: 0, perdu: 0 };
      cur.total++;
      if (isStatutGagne(p.statut)) cur.gagne++;
      else if (p.statut === 'perdu') cur.perdu++;
      acc.set(k, cur);
    });
    return [...acc.entries()]
      .map(([k, v]) => ({
        label: k,
        total: v.total,
        gagne: v.gagne,
        closes: v.gagne + v.perdu,
        taux: (v.gagne + v.perdu) > 0 ? (v.gagne / (v.gagne + v.perdu) * 100) : null
      }))
      .sort((a, b) => b.total - a.total);
  };
  const bySource = groupBy(p => p.source);
  const byType = groupBy(p => p.typeEvenement);

  const barRow = (item) => {
    const tauxStr = item.taux === null ? '—' : item.taux.toFixed(0) + '%';
    const widthPct = item.taux === null ? 0 : Math.max(3, item.taux);
    const color = item.taux === null ? '#ccc' : item.taux >= 50 ? '#10b981' : item.taux >= 25 ? '#f59e0b' : '#ef4444';
    return `
      <div class="crmStatBar">
        <div class="crmStatBarLabel">${escapeHtml(item.label)}</div>
        <div class="crmStatBarTrack">
          <div class="crmStatBarFill" style="width:${widthPct}%;background:${color}"></div>
          <div class="crmStatBarValue">${tauxStr} <span style="color:#888;font-weight:400">· ${item.gagne}/${item.closes} sur ${item.total}</span></div>
        </div>
      </div>
    `;
  };

  grid.innerHTML = `
    <div class="crmStatKpi">
      <div class="crmStatKpiValue">${total}</div>
      <div class="crmStatKpiLabel">Prospects total</div>
      <div class="crmStatKpiSub">${enCours} en cours · ${gagnes} gagnés · ${perdus} perdus</div>
    </div>
    <div class="crmStatKpi ${tauxGlobal >= 50 ? 'ok' : tauxGlobal >= 25 ? 'warn' : 'bad'}">
      <div class="crmStatKpiValue">${tauxGlobal.toFixed(0)}%</div>
      <div class="crmStatKpiLabel">Taux de conversion</div>
      <div class="crmStatKpiSub">${gagnes} / ${closes} dossiers clos</div>
    </div>
    <div class="crmStatBlock" style="grid-column:span 2">
      <h3>Taux par source</h3>
      ${bySource.length === 0 ? '<p class="legend">Pas encore de données</p>' : bySource.map(barRow).join('')}
    </div>
    <div class="crmStatBlock" style="grid-column:span 2">
      <h3>Taux par type d'événement</h3>
      ${byType.length === 0 ? '<p class="legend">Pas encore de données</p>' : byType.map(barRow).join('')}
    </div>
  `;
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
