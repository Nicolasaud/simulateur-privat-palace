// Bibliothèque libre — nouvel onglet Paramètres pour gérer :
//   - Catégories (paramétrables : Restauration, Bar, Spectacle, Animation…)
//   - Items libres (Café, Digestif, Photobooth…) avec coût/prix/marge auto
//   - Formules libres (assemblages d'items avec typeInterne optionnel legacy)
//
// Coexiste avec l'ancien système (bdd-items, formules, types-internes) qui
// pilote toujours le calcul. Aucun impact sur le benchmark Nicolas 5775€.

import { state } from './state.js';
import { fmt, fmtPct } from './helpers.js';
import {
  getItemsLib, putItemsLib,
  getCategories, putCategories,
  getFormulesLib, putFormulesLib
} from './api.js';
import { showToast } from './ui-feedback.js';
import { SYSTEM_ITEMS, LEGACY_SYSTEM_ITEMS, describeSystemItem } from './items-systeme.js';
import { seedLegacyFormulesLibIfMissing, purgeLegacyFormulesLibFromCloud } from './formules-lib-seed.js';
import { showOnboarding } from './onboarding.js';

// Lookup unifié : items du catalogue + items système "legacy" (non seedés
// dans items-lib pour éviter la pollution UI).
function lookupItemAny(id) {
  return (state.bibItems || []).find(i => i.id === id)
      || LEGACY_SYSTEM_ITEMS.find(i => i.id === id)
      || null;
}

const DEFAULT_CATEGORIES = [
  { id: 'cat_resto',      nom: 'Restauration', ordre: 1, couleur: '#22c55e' },
  { id: 'cat_bar',        nom: 'Bar',          ordre: 2, couleur: '#f59e0b' },
  { id: 'cat_spectacle',  nom: 'Spectacle',    ordre: 3, couleur: '#8b5cf6' },
  { id: 'cat_animation',  nom: 'Animation',    ordre: 4, couleur: '#3b82f6' },
  { id: 'cat_prestation', nom: 'Prestation',   ordre: 5, couleur: '#6366f1' },
];

const TVA_CATS = [
  { id: 'spectacle',   label: 'Spectacle (5,5 %)' },
  { id: 'restauration',label: 'Restauration (10 %)' },
  { id: 'bar',         label: 'Bar (20 %)' },
  { id: 'prestation',  label: 'Prestation (20 %)' },
];

function genId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// === Load ===
export async function loadBibliothequeLibre() {
  try {
    const [cats, items, formules] = await Promise.all([
      getCategories(), getItemsLib(), getFormulesLib()
    ]);
    state.bibCategories = Array.isArray(cats) ? cats : [];
    state.bibItems = Array.isArray(items) ? items : [];
    state.bibFormules = Array.isArray(formules) ? formules : [];
    // Seed catégories par défaut si vide (au 1er chargement)
    if (state.bibCategories.length === 0) {
      state.bibCategories = [...DEFAULT_CATEGORIES];
      await putCategories(state.bibCategories);
    }
    // Seed items système (non éditables) si absents — ré-inject à chaque
    // chargement pour garantir leur présence même après import/suppression.
    let itemsChanged = false;
    for (const sys of SYSTEM_ITEMS) {
      if (!state.bibItems.some(i => i.id === sys.id)) {
        state.bibItems.push({ ...sys });
        itemsChanged = true;
      }
    }
    if (itemsChanged) await putItemsLib(state.bibItems);

    // Purge one-shot des 5 formules legacy si elles traînent encore dans le
    // cloud. Le moteur libre les gère via un fallback interne (LEGACY_FORMULES_LIB).
    await purgeLegacyFormulesLibFromCloud();
  } catch (e) {
    console.warn('load bibliothèque libre', e);
    state.bibCategories = state.bibCategories || [];
    state.bibItems = state.bibItems || [];
    state.bibFormules = state.bibFormules || [];
  }
}

// === Rendu principal — Onglet "Bibliothèque de formules" ==============
export function renderBibliotheque() {
  const root = document.getElementById('bibliothequeContent');
  if (!root) return;
  root.innerHTML = `
    <div class="bibHero">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
        <div>
          <h1 style="margin-bottom:6px">📋 Bibliothèque de formules</h1>
          <p class="meta" style="margin-bottom:0">Compose tes offres commerciales à partir de la <a href="#" data-goto-bibitems style="color:var(--accent);text-decoration:underline">bibliothèque d'items</a>. Chaque formule = liste ordonnée d'items + tag visuel + type de rendu. Utilisées automatiquement dans le simulateur.</p>
        </div>
        <button class="bibGuideBtn" id="btnBibGuide" title="Guide de démarrage (5 slides)">❓ Guide</button>
      </div>
    </div>

    <div class="bibSection">
      <div class="bibSectionHeader">
        <h2>📋 Formules</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="selectTemplateFormule" title="Créer une formule composable à partir d'un template pré-configuré" style="max-width:280px;font-size:0.9em;padding:6px 10px">
            <option value="">🧪 Créer depuis un template…</option>
          </select>
          <button class="primary" id="btnAddFormule">+ Formule vierge</button>
        </div>
      </div>
      <div id="formulesList" class="bibFormulesList"></div>
    </div>
  `;
  renderFormules();
  wireBibliothequeHandlers();
  document.querySelector('[data-goto-bibitems]')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof window.switchTab === 'function') window.switchTab('bibitems');
  });
}

// === Rendu — Onglet "Bibliothèque d'items" =============================
export function renderBibliothequeItems() {
  const root = document.getElementById('bibitemsContent');
  if (!root) return;
  root.innerHTML = `
    <div class="bibSection">
      <div class="bibSectionHeader">
        <h2>📂 Catégories</h2>
        <button class="primary" id="btnAddCategorie">+ Ajouter</button>
      </div>
      <table class="bibTable" id="tableCategories">
        <thead><tr><th style="width:28px"></th><th>Nom</th><th style="width:110px">Couleur</th><th style="width:80px">Ordre</th><th style="width:44px"></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <div class="bibSection">
      <div class="bibSectionHeader">
        <h2>🍽️ Items</h2>
        <button class="primary" id="btnAddItem">+ Ajouter</button>
      </div>
      <table class="bibTable" id="tableItems">
        <thead><tr>
          <th>Libellé</th>
          <th style="width:140px">Catégorie</th>
          <th class="num" style="width:120px" title="Coût de revient HT par personne (ou fixe selon le mode)">Coût HT (€)</th>
          <th style="width:150px">TVA</th>
          <th style="width:120px" title="Fixe = total unique · × nb pers = ×nb pers du devis">Mode</th>
          <th style="width:44px"></th>
        </tr></thead>
        <tbody></tbody>
      </table>
      <p class="legend" style="margin-top:6px">💡 <strong>Item = coût de revient</strong>. Le prix de vente se règle au niveau de la <strong>Formule</strong> (bibliothèque de formules) qui regroupe plusieurs items.</p>
    </div>
  `;
  renderCategories();
  renderItems();
  wireBibItemsHandlers();
  // Note : les Types internes (paramètres système) ne sont plus exposés dans
  // l'UI (retirés sur demande utilisateur). Les valeurs restent chargées en
  // RAM (state.typesInternes) et utilisées par le moteur libre.
}

function wireBibItemsHandlers() {
  document.getElementById('btnAddCategorie')?.addEventListener('click', addCategorie);
  document.getElementById('btnAddItem')?.addEventListener('click', addItem);
}


// === Catégories ===
function renderCategories() {
  const tbody = document.querySelector('#tableCategories tbody');
  if (!tbody) return;
  const cats = state.bibCategories || [];
  tbody.innerHTML = cats.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:#888;padding:16px;font-style:italic">Aucune catégorie — ajoute la première</td></tr>'
    : cats.map(c => `
        <tr data-cat-id="${c.id}">
          <td><span class="bibColorDot" style="background:${c.couleur || '#999'}"></span></td>
          <td><input type="text" class="bib-cat-nom" value="${escapeHtml(c.nom)}"></td>
          <td><input type="color" class="bib-cat-couleur" value="${c.couleur || '#6366f1'}" style="width:100%;height:32px;padding:2px"></td>
          <td class="num"><input type="number" class="bib-cat-ordre" value="${c.ordre || 0}" min="0" style="width:100%"></td>
          <td><button class="delete bib-del" title="Supprimer">×</button></td>
        </tr>`).join('');
  wireCategorieRows();
}

function wireCategorieRows() {
  document.querySelectorAll('#tableCategories tbody tr[data-cat-id]').forEach(tr => {
    const id = tr.dataset.catId;
    tr.querySelector('.bib-cat-nom')?.addEventListener('change', e => updateCategorie(id, { nom: e.target.value }));
    tr.querySelector('.bib-cat-couleur')?.addEventListener('change', e => updateCategorie(id, { couleur: e.target.value }));
    tr.querySelector('.bib-cat-ordre')?.addEventListener('change', e => updateCategorie(id, { ordre: Number(e.target.value) }));
    tr.querySelector('.bib-del')?.addEventListener('click', () => deleteCategorie(id));
  });
}

async function updateCategorie(id, patch) {
  const c = state.bibCategories.find(x => x.id === id);
  if (!c) return;
  Object.assign(c, patch);
  await persistCategories();
}

async function deleteCategorie(id) {
  const inUse = state.bibItems.some(i => i.categorieId === id) || state.bibFormules.some(f => f.categorieId === id);
  if (inUse && !confirm('Cette catégorie est utilisée par des items ou formules. Supprimer quand même ?')) return;
  state.bibCategories = state.bibCategories.filter(c => c.id !== id);
  await persistCategories();
  renderCategories();
  renderItems();  // les catégories sont référencées
  renderFormules();
}

function addCategorie() {
  state.bibCategories.push({
    id: genId('cat'),
    nom: 'Nouvelle catégorie',
    couleur: '#6366f1',
    ordre: (state.bibCategories.reduce((m, c) => Math.max(m, c.ordre || 0), 0)) + 1
  });
  persistCategories();
  renderCategories();
}

async function persistCategories() {
  try { await putCategories(state.bibCategories); }
  catch (e) { showToast('Sauvegarde catégories échouée', 'error'); console.warn(e); }
}

// === Items ===
function renderItems() {
  const tbody = document.querySelector('#tableItems tbody');
  if (!tbody) return;
  const items = state.bibItems || [];
  tbody.innerHTML = items.length === 0
    ? '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px;font-style:italic">Aucun item libre — ajoute le premier</td></tr>'
    : items.map(it => {
        const isSys = !!it.systemFn;
        const readonly = isSys ? 'readonly disabled' : '';
        const sysBadge = isSys ? `<span class="bibSysBadge" title="${escapeHtml(describeSystemItem(it) || '')}">⚡ auto</span>` : '';
        const effectiveMode = it.mode || (['restauration', 'bar'].includes(it.tvaCat) ? 'perPers' : 'unit');
        return `
          <tr data-item-id="${it.id}" class="${isSys ? 'bibItemSys' : ''}">
            <td><input type="text" class="bib-it-lib" value="${escapeHtml(it.libelle)}" ${readonly}>${sysBadge}</td>
            <td><select class="bib-it-cat" ${isSys ? 'disabled' : ''}>${categoriesOptions(it.categorieId)}</select></td>
            <td class="num"><input type="number" class="bib-it-cout" value="${it.coutHT ?? 0}" step="0.01" min="0" ${readonly}></td>
            <td><select class="bib-it-tva" ${isSys ? 'disabled' : ''}>${tvaOptions(it.tvaCat)}</select></td>
            <td><select class="bib-it-mode" ${isSys ? 'disabled' : ''} title="Fixe = total · × nb pers = ×nb pers du devis">
              <option value="perPers" ${effectiveMode === 'perPers' ? 'selected' : ''}>× nb pers</option>
              <option value="unit" ${effectiveMode === 'unit' ? 'selected' : ''}>Fixe</option>
            </select></td>
            <td>${isSys ? '' : '<button class="delete bib-del" title="Supprimer">×</button>'}</td>
          </tr>`;
      }).join('');
  wireItemRows();
}

function categoriesOptions(selected) {
  return `<option value="">—</option>` +
    (state.bibCategories || []).map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(c.nom)}</option>`).join('');
}
function tvaOptions(selected) {
  return TVA_CATS.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('');
}

function wireItemRows() {
  document.querySelectorAll('#tableItems tbody tr[data-item-id]').forEach(tr => {
    const id = tr.dataset.itemId;
    const upd = patch => updateItem(id, patch);
    tr.querySelector('.bib-it-lib')?.addEventListener('change', e => upd({ libelle: e.target.value }));
    tr.querySelector('.bib-it-cat')?.addEventListener('change', e => upd({ categorieId: e.target.value }));
    tr.querySelector('.bib-it-cout')?.addEventListener('change', e => upd({ coutHT: Number(e.target.value) }));
    tr.querySelector('.bib-it-tva')?.addEventListener('change', e => upd({ tvaCat: e.target.value }));
    tr.querySelector('.bib-it-mode')?.addEventListener('change', e => upd({ mode: e.target.value }));
    tr.querySelector('.bib-del')?.addEventListener('click', () => deleteItem(id));
  });
}

async function updateItem(id, patch) {
  const it = state.bibItems.find(x => x.id === id);
  if (!it) return;
  Object.assign(it, patch);
  await persistItems();
}
async function deleteItem(id) {
  const inUse = state.bibFormules.some(f => (f.itemIds || []).includes(id));
  if (inUse && !confirm('Cet item est utilisé dans des formules. Supprimer quand même ?')) return;
  state.bibItems = state.bibItems.filter(x => x.id !== id);
  await persistItems();
  renderItems();
  renderFormules();
}
function addItem() {
  state.bibItems.push({
    id: genId('it'),
    libelle: 'Nouvel item',
    categorieId: (state.bibCategories[0] || {}).id || '',
    coutHT: 0,
    prixHT: 0,   // conservé pour rétro-compat, non affiché
    tvaCat: 'prestation',
    mode: 'perPers'
  });
  persistItems();
  renderItems();
}
async function persistItems() {
  try { await putItemsLib(state.bibItems); }
  catch (e) { showToast('Sauvegarde items échouée', 'error'); console.warn(e); }
}

// === Formules ===
function renderFormules() {
  const root = document.getElementById('formulesList');
  if (!root) return;
  // Filtrage : on n'affiche PAS les formules legacy _builtIn (Étape refonte).
  // Elles restent dans le blob pour le fallback rétro-compat du moteur
  // mais deviennent invisibles côté UI.
  const list = (state.bibFormules || []).filter(f => !f._builtIn);
  root.innerHTML = list.length === 0
    ? '<p class="legend" style="text-align:center;padding:20px">Aucune formule — clique sur <strong>+ Formule vierge</strong> ou choisis un <strong>🧪 template</strong></p>'
    : list.map(f => renderFormuleCard(f)).join('');
  wireFormuleRows();
}

function renderFormuleCard(f) {
  const items = (f.itemIds || []).map(id => lookupItemAny(id)).filter(Boolean);
  const totalCout = items.reduce((s, i) => s + (i.coutHT || 0), 0);
  const totalPrix = items.reduce((s, i) => s + (i.prixHT || 0), 0);
  const marge = totalPrix > 0 ? ((totalPrix - totalCout) / totalPrix * 100) : 0;
  const isBuiltIn = !!f._builtIn;
  const hasSystemItems = items.some(i => i._system);
  const allSystemItems = items.length > 0 && items.every(i => i._system);
  const readonly = isBuiltIn ? 'readonly' : '';
  const legacyBadge = isBuiltIn
    ? `<span class="bibLegacyBadge" title="Formule figée — reproduit la logique legacy du moteur historique. Utilisée par le moteur libre pour ${escapeHtml(f._legacyTypeId || '')}">🔒 legacy</span>`
    : '';
  const tagOptions = FORMULE_TAG_OPTIONS.map(t =>
    `<option value="${t.emoji}" ${f.tag === t.emoji ? 'selected' : ''}>${t.emoji} ${t.label}</option>`
  ).join('');
  const typeIdRenduOptions = FORMULE_TYPE_RENDU_OPTIONS.map(t =>
    `<option value="${t.id}" ${(f._typeIdRendu || 'privat-full') === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
  ).join('');
  const customConfig = isBuiltIn ? '' : `
    <div class="bibFormuleConfig">
      <label>Tag visuel
        <select class="bib-fo-tag">
          <option value="">Auto (aucun)</option>
          ${tagOptions}
        </select>
      </label>
      <label title="Prix de vente HT de la formule (côté client). Laisse à 0 pour utiliser la somme des items.">💰 Prix vente HT
        <input type="number" class="bib-fo-prix" value="${f.prixHT ?? 0}" step="0.01" min="0" placeholder="0.00">
      </label>
      <label title="× nb pers = prix × nombre de personnes du devis · Fixe = prix total unique">Mode
        <select class="bib-fo-prixmode">
          <option value="perPers" ${(f.prixMode || 'perPers') === 'perPers' ? 'selected' : ''}>× nb pers</option>
          <option value="unit" ${f.prixMode === 'unit' ? 'selected' : ''}>Fixe</option>
        </select>
      </label>
    </div>`;
  return `
    <div class="bibFormule ${isBuiltIn ? 'bibFormuleLegacy' : ''}" data-formule-id="${f.id}">
      <div class="bibFormuleHead">
        <input type="text" class="bib-fo-nom" value="${escapeHtml(f.nom)}" placeholder="Nom de la formule" ${readonly}>
        ${legacyBadge}
        <select class="bib-fo-cat" style="max-width:180px" ${isBuiltIn ? 'disabled' : ''}>${categoriesOptions(f.categorieId)}</select>
        ${isBuiltIn ? '' : '<button class="delete bib-del">×</button>'}
      </div>
      ${customConfig}
      <div class="bibFormuleItems">
        ${items.length === 0
          ? '<p class="legend" style="margin:8px 0">Aucun item — clique sur « + » pour en ajouter</p>'
          : items.map(i => {
              const sysBadge = i._system ? ' <span style="font-size:0.72em;color:#666">⚡</span>' : '';
              const coutChip = i._system ? '<span class="bibItemChipPrix" style="font-style:italic;color:#666">auto</span>' : `<span class="bibItemChipPrix" title="Coût de revient HT">${fmt(i.coutHT || 0)} coût</span>`;
              const rem = isBuiltIn ? '' : `<button class="bib-fo-rem" data-item-id="${i.id}" title="Retirer">×</button>`;
              return `<span class="bibItemChip" data-item-id="${i.id}" title="${escapeHtml(describeSystemItem(i) || '')}">${escapeHtml(i.libelle)}${sysBadge} ${coutChip} ${rem}</span>`;
            }).join('')}
      </div>
      ${isBuiltIn ? '' : `
        <div class="bibFormuleAdd">
          <select class="bib-fo-add">${itemsAddOptions(f.itemIds)}</select>
          <button class="bib-fo-add-btn">+ Ajouter cet item</button>
        </div>
      `}
      <div class="bibFormuleTotals">
        ${isBuiltIn || allSystemItems
          ? '<span style="font-style:italic;color:#666">Coûts &amp; prix calculés à la volée selon la fiche (nb pers, jour, params).</span>'
          : (() => {
              const prixFormule = Number(f.prixHT || 0);
              const modeLbl = (f.prixMode || 'perPers') === 'perPers' ? '/ pers' : 'fixe';
              const margeFormule = prixFormule > 0 ? ((prixFormule - totalCout) / prixFormule * 100) : 0;
              return `
                <span title="Somme des coûts de revient des items">Coût HT items : <strong>${fmt(totalCout)}</strong> ${(f.prixMode || 'perPers') === 'perPers' ? '/ pers' : ''}</span>
                ${prixFormule > 0
                  ? `<span>Prix vente : <strong style="color:#0a5c2c">${fmt(prixFormule)}</strong> ${modeLbl}</span>
                     <span>Marge : <strong style="color:${margeFormule >= 60 ? '#0a5c2c' : margeFormule >= 40 ? '#7a4400' : '#8a1a1a'}">${fmtPct(margeFormule)}</strong></span>`
                  : '<span style="font-style:italic;color:#888">💡 Renseigne un <strong>Prix vente HT</strong> ci-dessus pour voir la marge</span>'}
                ${hasSystemItems ? '<span style="font-size:0.82em;font-style:italic;color:#888;margin-left:auto">(hors items auto ⚡ recalculés en fiche)</span>' : ''}
              `;
            })()}
      </div>
    </div>
  `;
}

// Étape 7 — Tags visuels + typeIdRendu pour formules libres custom
const FORMULE_TAG_OPTIONS = [
  { emoji: '💼', label: 'Corporate' },
  { emoji: '🎂', label: 'Anniversaire' },
  { emoji: '🍸', label: 'Team-building' },
  { emoji: '🎭', label: 'Show' },
  { emoji: '🏢', label: 'Séminaire' },
  { emoji: '🎬', label: 'Impro' },
  { emoji: '🥂', label: 'Cocktail' },
  { emoji: '🎉', label: 'Fête / soirée' }
];
const FORMULE_TYPE_RENDU_OPTIONS = [
  { id: 'privat-full',        label: 'Privatisation show + repas' },
  { id: 'privat-salle',       label: 'Privatisation sans show' },
  { id: 'atelier-cocktail',   label: 'Atelier cocktail' },
  { id: 'formation-impro',    label: 'Formation impro' },
  { id: 'groupe-classique',   label: 'Groupe soirée Palace' }
];

function itemsAddOptions(selectedIds) {
  const items = state.bibItems || [];
  return '<option value="">— Choisir un item —</option>' +
    items.map(i => `<option value="${i.id}">${escapeHtml(i.libelle)} — coût ${fmt(i.coutHT || 0)}</option>`).join('');
}

function wireFormuleRows() {
  document.querySelectorAll('.bibFormule').forEach(card => {
    const id = card.dataset.formuleId;
    card.querySelector('.bib-fo-nom')?.addEventListener('change', e => updateFormule(id, { nom: e.target.value }));
    card.querySelector('.bib-fo-cat')?.addEventListener('change', e => updateFormule(id, { categorieId: e.target.value }));
    card.querySelector('.bib-fo-tag')?.addEventListener('change', e => updateFormule(id, { tag: e.target.value || null }));
    card.querySelector('.bib-fo-prix')?.addEventListener('change', e => updateFormule(id, { prixHT: Number(e.target.value) || 0 }));
    card.querySelector('.bib-fo-prixmode')?.addEventListener('change', e => updateFormule(id, { prixMode: e.target.value }));
    card.querySelector('.bib-fo-typeidrendu')?.addEventListener('change', e => updateFormule(id, { _typeIdRendu: e.target.value }));
    card.querySelector('.bib-del')?.addEventListener('click', () => deleteFormule(id));
    card.querySelectorAll('.bib-fo-rem').forEach(b => {
      b.addEventListener('click', () => removeItemFromFormule(id, b.dataset.itemId));
    });
    const addBtn = card.querySelector('.bib-fo-add-btn');
    const addSel = card.querySelector('.bib-fo-add');
    addBtn?.addEventListener('click', () => {
      if (!addSel.value) return;
      addItemToFormule(id, addSel.value);
    });
  });
}

async function updateFormule(id, patch) {
  const f = state.bibFormules.find(x => x.id === id);
  if (!f) return;
  Object.assign(f, patch);
  await persistFormules();
  // Re-render la carte si prixHT / prixMode change → totals recalculés
  if ('prixHT' in patch || 'prixMode' in patch) {
    renderFormules();
  }
}
async function deleteFormule(id) {
  if (!confirm('Supprimer cette formule ?')) return;
  state.bibFormules = state.bibFormules.filter(x => x.id !== id);
  await persistFormules();
  renderFormules();
}
async function addItemToFormule(fid, itemId) {
  const f = state.bibFormules.find(x => x.id === fid);
  if (!f || !itemId) return;
  f.itemIds = f.itemIds || [];
  f.itemIds.push(itemId);
  await persistFormules();
  renderFormules();
}
async function removeItemFromFormule(fid, itemId) {
  const f = state.bibFormules.find(x => x.id === fid);
  if (!f) return;
  f.itemIds = (f.itemIds || []).filter(id => id !== itemId);
  await persistFormules();
  renderFormules();
}
function addFormule() {
  state.bibFormules.push({
    id: genId('fl'),
    nom: 'Nouvelle formule',
    categorieId: (state.bibCategories[0] || {}).id || '',
    itemIds: []
  });
  persistFormules();
  renderFormules();
}

// === Templates pré-configurés — Étape 7c ================================
// Formules "starter" pour aider l'équipe commerciale à démarrer sans partir
// d'une page blanche. Chaque template = squelette d'items + tag + typeIdRendu.
// L'utilisateur peut ensuite éditer librement.
export const FORMULE_TEMPLATES = [
  {
    id: 'tpl_seminaire_full',
    label: '💼 Séminaire corporate journée (show + repas)',
    nom: 'Séminaire corporate',
    tag: '💼',
    _typeIdRendu: 'privat-full',
    itemIds: ['sys_spectacle_full', 'sys_personnel', 'sys_user_resto_items', 'sys_frais_resa']
  },
  {
    id: 'tpl_anniv_cocktail',
    label: '🎂 Anniversaire cocktail dînatoire',
    nom: 'Anniversaire cocktail',
    tag: '🎂',
    _typeIdRendu: 'privat-full',
    itemIds: ['sys_spectacle_full', 'sys_personnel', 'sys_user_resto_items', 'sys_frais_resa']
  },
  {
    id: 'tpl_teambuilding_impro',
    label: '🎬 Team-building impro + apéro',
    nom: 'Team-building impro + apéro',
    tag: '🎬',
    _typeIdRendu: 'formation-impro',
    itemIds: ['sys_impro_inter', 'sys_impro_particip']
  },
  {
    id: 'tpl_cocktail_apero',
    label: '🥂 Cocktail apéritif entreprise (2h)',
    nom: 'Cocktail apéritif entreprise',
    tag: '🥂',
    _typeIdRendu: 'atelier-cocktail',
    itemIds: ['sys_atelier_inter', 'sys_atelier_mat']
  }
];

function fillTemplateSelect() {
  const sel = document.getElementById('selectTemplateFormule');
  if (!sel) return;
  // Reset + ajout des options
  const currentValue = sel.value;
  sel.innerHTML = '<option value="">🧪 Créer depuis un template…</option>'
    + FORMULE_TEMPLATES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  sel.value = currentValue;
}

async function createFormuleFromTemplate(tplId) {
  const tpl = FORMULE_TEMPLATES.find(t => t.id === tplId);
  if (!tpl) return;
  const nom = prompt(`Nom de la nouvelle formule composable :`, tpl.nom);
  if (!nom || !nom.trim()) return;
  const newFormule = {
    id: genId('fl'),
    nom: nom.trim(),
    categorieId: (state.bibCategories[0] || {}).id || '',
    tag: tpl.tag,
    _typeIdRendu: tpl._typeIdRendu,
    itemIds: [...(tpl.itemIds || [])]
  };
  state.bibFormules.push(newFormule);
  await persistFormules();
  renderFormules();
  showToast(`Formule « ${nom.trim()} » créée depuis le template.`, 'success');
  // Reset select
  const sel = document.getElementById('selectTemplateFormule');
  if (sel) sel.value = '';
}
async function persistFormules() {
  try { await putFormulesLib(state.bibFormules); }
  catch (e) { showToast('Sauvegarde formules échouée', 'error'); console.warn(e); }
}

function wireBibliothequeHandlers() {
  document.getElementById('btnAddCategorie')?.addEventListener('click', addCategorie);
  document.getElementById('btnAddItem')?.addEventListener('click', addItem);
  document.getElementById('btnAddFormule')?.addEventListener('click', addFormule);
  document.getElementById('btnBibGuide')?.addEventListener('click', () => showOnboarding(true));
  fillTemplateSelect();
  const tplSel = document.getElementById('selectTemplateFormule');
  tplSel?.addEventListener('change', () => {
    if (tplSel.value) createFormuleFromTemplate(tplSel.value);
  });
  // Auto-affichage du guide au premier accès
  showOnboarding(false);
}
