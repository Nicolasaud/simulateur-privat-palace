// Bibliothèque des formules de prestation (bundles type + params + items).
//
// Modèle d'une formule :
//   {
//     id: 'fm_xxx',
//     nom: 'Privatisation full standard',
//     type: 'privat-full' | 'privat-salle' | 'atelier-cocktail'
//         | 'formation-impro' | 'groupe-classique',
//     params: { ... },           // overrides spécifiques au type (voir TYPES_META)
//     items: [                    // items resto rattachés (snapshot)
//       { libelle, coutHT, prixHT, tvaCat, personnesParUnite }
//     ],
//     builtIn: true|false,        // formules de base verrouillées côté UI
//     dateCreation, dateModification
//   }
//
// Au premier login (blob vide), on seede les 5 formules de base avec les
// valeurs courantes des inputs globaux (déjà chargées via loadParamsFromCloud
// ou valeurs HTML par défaut), puis on PUT immédiatement pour matérialiser
// côté cloud.

import { $, val } from './helpers.js';
import { state } from './state.js';
import { getFormulesV2, putFormulesV2, scheduleFlush } from './api.js';
import { recalcul } from './calcul.js';
import { renderItems } from './items.js';
import { setDirty } from './fiches.js';
import { saveItemToBdd } from './bdd-items.js';
import { getTypeInterneById, getDefaultParam, getTypeLabel } from './types-internes.js';

// Métadonnées par type : libellé, IDs des inputs globaux à migrer dans params.
export const TYPES_META = {
  'privat-full': {
    label: 'Privatisation show + repas',
    paramIds: ['paramSpecPrix', 'paramSpecCout']
  },
  'privat-salle': {
    label: 'Privatisation sans show',
    paramIds: ['forfaitSalleSeule', 'coutSalleSeule']
  },
  'atelier-cocktail': {
    label: 'Atelier cocktail',
    paramIds: ['coutInterCocktail', 'coutMatCocktail', 'margeAtelier']
  },
  'formation-impro': {
    label: 'Formation impro / team building',
    paramIds: ['coutInterImpro', 'prixPersImpro']
  },
  'groupe-classique': {
    label: 'Groupe sur soirée Palace classique',
    paramIds: ['prixGroupe', 'coutGroupe']
  }
};

export const TYPE_IDS = Object.keys(TYPES_META);

// Helpers
export const nowIso = () => new Date().toISOString();
export const newFormuleId = () => 'fm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
const builtInId = (type) => `fm_base_${type}`;

export function getFormuleById(id) {
  return state.formulesPrestation.find(f => f.id === id) || null;
}

export function getFormulesByType(typeId) {
  return state.formulesPrestation.filter(f => (f.typeId || f.type) === typeId);
}

// Snapshot des valeurs actuelles des inputs globaux pour un type donné.
// Utilisé seulement au seed initial — ensuite les params vivent dans la formule.
function snapshotParamsForType(type) {
  const meta = TYPES_META[type];
  if (!meta) return {};
  const out = {};
  meta.paramIds.forEach(id => {
    const el = $(id);
    if (el) out[id] = parseFloat(el.value) || 0;
  });
  return out;
}

// Construit les 5 formules de base — Modèle C : référence un typeId,
// overrides vide (tous les params hérités du type interne).
// Appelée uniquement si le blob /api/formules-v2 est vide.
function buildDefaultFormules() {
  const stamp = nowIso();
  return TYPE_IDS.map(typeId => ({
    id: builtInId(typeId),
    nom: TYPES_META[typeId].label,
    typeId,
    overrides: {},
    items: [],
    builtIn: true,
    dateCreation: stamp,
    dateModification: stamp
  }));
}

// Tolérance utilisée pour décider qu'une valeur est "identique au défaut"
// au moment de la migration params → overrides.
const FLOAT_EPSILON = 0.001;
const closeEnough = (a, b) => Math.abs((+a || 0) - (+b || 0)) < FLOAT_EPSILON;

export async function loadFormulesV2FromCloud() {
  try {
    const list = await getFormulesV2();
    state.formulesPrestation = Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Lecture formules-v2 cloud échouée', e);
    state.formulesPrestation = [];
  }
}

// Migration douce vers le Modèle C — appelée APRÈS loadTypesInternesFromCloud
// et seedTypesInternesIfEmpty (besoin des defaults pour calculer les diffs).
// Transforme : { type, params: {…} }  →  { typeId, overrides: {…} }
// - "type" alias vers "typeId" si absent
// - chaque entry de "params" non close au défaut du type → mise dans overrides
// - les autres (au défaut) sont éliminées (héritées du type)
// - le champ legacy "params" est supprimé
// Idempotente : un re-passage sur des données déjà migrées ne change rien.
export function migrateFormulesToModelC() {
  let touched = false;
  state.formulesPrestation.forEach(f => {
    // type → typeId
    if (!f.typeId && f.type) {
      f.typeId = f.type;
      delete f.type;
      touched = true;
    } else if (f.typeId && f.type) {
      // les deux présents : on garde typeId comme source de vérité
      delete f.type;
      touched = true;
    }
    // params → overrides
    if (f.params && typeof f.params === 'object') {
      const overrides = f.overrides && typeof f.overrides === 'object' ? { ...f.overrides } : {};
      Object.entries(f.params).forEach(([pid, value]) => {
        const def = getDefaultParam(f.typeId, pid);
        if (!closeEnough(value, def)) {
          overrides[pid] = +value;
        }
      });
      f.overrides = overrides;
      delete f.params;
      touched = true;
    }
    // S'assurer que overrides existe toujours (même vide)
    if (!f.overrides || typeof f.overrides !== 'object') {
      f.overrides = {};
      touched = true;
    }
    // builtIn n'est plus utilisé pour le verrou (commit 1) — on le garde quand
    // même comme info historique. Pas de delete pour ne pas perdre info.
  });
  if (touched) persistFormulesV2();
}

// Valeur effective d'un paramètre pour une formule donnée : override > défaut type.
// Le snapshot fiche est résolu côté calcul.js (commit 7).
export function getEffectiveParam(formule, paramId) {
  if (!formule) return 0;
  if (formule.overrides && (paramId in formule.overrides)) {
    return +formule.overrides[paramId];
  }
  return getDefaultParam(formule.typeId || formule.type, paramId);
}

export function persistFormulesV2() {
  scheduleFlush('formules-v2', () => putFormulesV2(state.formulesPrestation));
}

// Si le blob est vide, on seede les 5 formules de base et on persiste IMMÉDIATEMENT
// (sans debounce — première fois unique, on veut que ce soit visible côté cloud
// avant tout autre PUT).
// IMPORTANT : à appeler APRÈS loadParamsFromCloud() pour que les inputs globaux
// contiennent les bonnes valeurs.
export async function seedFormulesIfEmpty() {
  if (state.formulesPrestation.length > 0) return false;
  const defaults = buildDefaultFormules();
  state.formulesPrestation = defaults;
  try {
    await putFormulesV2(defaults);
    console.info(`[formules-v2] Seed initial : ${defaults.length} formules de base créées.`);
    return true;
  } catch (e) {
    console.error('Seed formules-v2 échoué', e);
    return false;
  }
}

// Migration douce des formules de base au boot. Idempotent.
const LEGACY_BUILTIN_NAMES = {
  'fm_base_privat-full':  { old: 'Privatisation full + show + repas',     newLabel: 'Privatisation show + repas' },
  'fm_base_privat-salle': { old: 'Privatisation salle seule (sans show)', newLabel: 'Privatisation sans show' }
};

export function reconcileBuiltInFormules() {
  let touched = false;
  state.formulesPrestation.forEach(f => {
    const rule = LEGACY_BUILTIN_NAMES[f.id];
    if (rule && f.nom === rule.old) {
      f.nom = rule.newLabel;
      f.dateModification = nowIso();
      touched = true;
    }
  });
  if (touched) persistFormulesV2();
}

// =====================================================================
// UI — bibliothèque de formules (table) + modal éditeur
// =====================================================================

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const fmtNum = (n) => (typeof n === 'number' && !isNaN(n)) ? n.toLocaleString('fr-FR') : '—';

// État local de l'éditeur (modal)
let editorState = null;

// Rafraîchit le dropdown "Formule de prestation" de la fiche depuis la bibliothèque.
// Préserve la valeur sélectionnée si la formule existe encore, sinon "" + badge handled ailleurs.
export function refreshFormuleSelectInFiche() {
  const sel = document.getElementById('formuleSelect');
  if (!sel) return;
  const previousId = sel.value;
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Sélectionner —';
  sel.appendChild(placeholder);
  (state.formulesPrestation || []).forEach(f => {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.nom;
    o.dataset.type = f.type;
    sel.appendChild(o);
  });
  // Restaure la sélection si possible
  if (previousId && state.formulesPrestation.some(f => f.id === previousId)) {
    sel.value = previousId;
  }
}

// Synchronise les inputs hidden (format + paramSpecPrix/forfaitSalleSeule/etc.)
// avec la formule active. Permet à calcul.js de continuer à lire ses valeurs
// inchangées jusqu'au commit 7 (où il lira directement via la chaîne).
// Lecture : pour chaque paramId du type, override > défaut type interne.
export function syncHiddenInputsFromFormule(formuleId) {
  const f = getFormuleById(formuleId);
  if (!f) return;
  const typeId = f.typeId || f.type;
  // Type interne hidden
  const fmt = $('format');
  if (fmt && fmt.value !== typeId) {
    fmt.value = typeId;
    fmt.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Params effectifs (override ou défaut du type)
  const meta = TYPES_META[typeId];
  if (!meta) return;
  meta.paramIds.forEach(pid => {
    const el = $(pid);
    if (!el) return;
    const v = (f.overrides && pid in f.overrides) ? f.overrides[pid] : getDefaultParam(typeId, pid);
    el.value = v;
  });
}

// Handler appelé quand l'utilisateur change la formule active dans la fiche.
export function onFormuleSelectChange(selectEl) {
  const newId = selectEl?.value || '';
  if (!newId) {
    state.currentFormuleId = null;
    setDirty(true);
    return;
  }
  const f = getFormuleById(newId);
  if (!f) return;
  // Si la fiche contient déjà des items resto, confirmer le remplacement
  if (Array.isArray(state.items) && state.items.length > 0 && (f.items || []).length > 0) {
    const ok = confirm(`Remplacer la composition actuelle (${state.items.length} items) par celle de la formule « ${f.nom} » (${f.items.length} items) ?`);
    if (!ok) {
      // Revenir à l'ID précédent
      selectEl.value = state.currentFormuleId || '';
      return;
    }
  }
  state.currentFormuleId = newId;
  // Modèle C : changement de formule active = snapshot précédent obsolète.
  // On le purge → calcul utilisera la chaîne override > défaut type.
  state.currentSnapshot = null;
  // Charger les items resto (snapshot indépendant)
  state.items = JSON.parse(JSON.stringify(f.items || []));
  // Synchroniser les inputs hidden (rétro-compat avec val() partout où
  // getParamForCurrentFiche n'est pas utilisé — fonction utilitaire seulement)
  syncHiddenInputsFromFormule(newId);
  renderItems();
  recalcul();
  setDirty(true);
}

// Initialise la sélection du formuleSelect à partir du format de la fiche courante.
// Fallback : prend la première formule dont type === format.value.
export function initFormuleSelectFromCurrentFormat() {
  const sel = document.getElementById('formuleSelect');
  if (!sel) return;
  // Si l'ID en mémoire existe encore : sélectionne-le
  if (state.currentFormuleId && state.formulesPrestation.some(f => f.id === state.currentFormuleId)) {
    sel.value = state.currentFormuleId;
    syncHiddenInputsFromFormule(state.currentFormuleId);
    return;
  }
  // Sinon match par type avec le format hidden
  const fmt = document.getElementById('format');
  const targetType = fmt?.value || 'privat-full';
  const match = state.formulesPrestation.find(f => (f.typeId || f.type) === targetType);
  if (match) {
    sel.value = match.id;
    state.currentFormuleId = match.id;
    syncHiddenInputsFromFormule(match.id);
  } else {
    sel.value = '';
    state.currentFormuleId = null;
  }
}

export function refreshFormulesPrestaTable() {
  const tbody = document.querySelector('#formulesPrestaTable tbody');
  if (!tbody) return;
  const list = state.formulesPrestation || [];
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#888;padding:18px">Aucune formule pour le moment.</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  list.forEach(f => {
    const tr = document.createElement('tr');
    const typeId = f.typeId || f.type;
    const typeLabel = getTypeLabel(typeId);
    tr.innerHTML = `
      <td style="padding:6px"><strong>${escapeHtml(f.nom)}</strong></td>
      <td style="padding:6px;font-size:0.88em;color:#555">${escapeHtml(typeLabel)}</td>
      <td class="num" style="padding:6px">${(f.items || []).length}</td>
      <td class="num" style="padding:6px;white-space:nowrap">
        <button onclick="openFormulePrestaEditor('${f.id}')" style="padding:3px 8px;font-size:0.85em">Éditer</button>
        <button onclick="duplicateFormulePresta('${f.id}')" style="padding:3px 8px;font-size:0.85em">Dupliquer</button>
        <button class="delete" onclick="deleteFormulePresta('${f.id}')" style="padding:3px 7px">×</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Ouvre l'éditeur. id=null → nouvelle formule (type privat-full par défaut).
export function openFormulePrestaEditor(id) {
  if (id) {
    const f = getFormuleById(id);
    if (!f) return;
    editorState = JSON.parse(JSON.stringify(f));
    // Normalisation Modèle C (au cas où la migration douce n'a pas couru) :
    if (!editorState.typeId && editorState.type) editorState.typeId = editorState.type;
    delete editorState.type;
    if (!editorState.overrides) editorState.overrides = {};
  } else {
    editorState = {
      id: newFormuleId(),
      nom: '',
      typeId: 'privat-full',
      overrides: {},
      items: [],
      builtIn: false,
      dateCreation: nowIso(),
      dateModification: nowIso(),
      __isNew: true
    };
  }
  renderEditor();
  document.getElementById('formulePrestaModal').classList.remove('hidden');
}

export function closeFormulePrestaEditor() {
  document.getElementById('formulePrestaModal').classList.add('hidden');
  editorState = null;
}

function renderEditor() {
  const body = document.getElementById('formulePrestaModalBody');
  if (!body || !editorState) return;
  const title = editorState.__isNew ? 'Nouvelle formule de prestation' : `Éditer « ${escapeHtml(editorState.nom || '(sans nom)')} »`;

  // Champs params spécifiques au type sélectionné.
  // Distinction visuelle hérité (gris italique) vs personnalisé (noir gras),
  // + bouton "↺ reset" sur chaque param personnalisé.
  const meta = TYPES_META[editorState.typeId] || { paramIds: [] };
  const paramsHtml = meta.paramIds.map(pid => {
    const label = PARAM_LABELS[pid] || pid;
    const isOverride = !!(editorState.overrides && pid in editorState.overrides);
    const v = isOverride ? editorState.overrides[pid] : getDefaultParam(editorState.typeId, pid);
    const status = isOverride
      ? `<span style="font-size:0.7em;color:#444;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">personnalisé</span>
         <button type="button" data-fp-reset-param="${pid}" title="Réinitialiser au défaut du type" style="margin-left:6px;padding:1px 6px;font-size:0.78em;background:transparent;border:1px solid rgba(0,0,0,0.2);border-radius:4px;cursor:pointer">↺</button>`
      : `<span style="font-size:0.7em;color:#888;font-style:italic">= défaut du type</span>`;
    const inputStyle = isOverride
      ? ''
      : 'color:#888;font-style:italic;background:#fafafa';
    return `
      <div>
        <label style="font-size:0.85em;display:flex;align-items:center;gap:6px;justify-content:space-between">
          <span>${escapeHtml(label)}</span>
          <span style="display:inline-flex;align-items:center;gap:4px">${status}</span>
        </label>
        <input type="number" step="0.01" data-fp-param="${pid}" value="${v}" style="${inputStyle}">
      </div>`;
  }).join('');

  // Tableau des items resto attachés
  const itemsRowsHtml = (editorState.items || []).map((it, i) => `
    <tr data-fp-item-i="${i}">
      <td><input type="text" data-fp-item-key="libelle" data-i="${i}" value="${escapeHtml(it.libelle)}" style="width:100%"></td>
      <td><input type="number" step="0.1" data-fp-item-key="coutHT" data-i="${i}" value="${it.coutHT}" style="width:80px;text-align:right"></td>
      <td><input type="number" step="0.1" data-fp-item-key="prixHT" data-i="${i}" value="${it.prixHT}" style="width:80px;text-align:right"></td>
      <td>
        <select data-fp-item-key="tvaCat" data-i="${i}">
          <option value="restauration"${it.tvaCat==='restauration'?' selected':''}>Resto 10%</option>
          <option value="bar"${it.tvaCat==='bar'?' selected':''}>Bar 20%</option>
        </select>
      </td>
      <td><input type="number" min="1" step="1" data-fp-item-key="personnesParUnite" data-i="${i}" value="${it.personnesParUnite ?? 1}" style="width:60px;text-align:right" title="1 unité couvre N personnes"></td>
      <td style="white-space:nowrap">
        <button onclick="pushFormulePrestaItemToBdd(${i}, this)" title="Ajouter cet item à la BDD réutilisable" style="padding:3px 7px;font-size:0.8em">+ base</button>
        <button class="delete" onclick="removeFormulePrestaItem(${i})" style="padding:3px 7px">×</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6" style="text-align:center;color:#888;padding:14px;font-style:italic">Aucun item resto. Ajoute depuis la BDD ou crée-en un nouveau.</td></tr>`;

  // Select BDD
  const bddOpts = (state.bddItems || []).map(b =>
    `<option value="${b.id}">${escapeHtml(b.libelle)} (${b.coutHT}€→${b.prixHT}€)</option>`
  ).join('');

  body.innerHTML = `
    <h2 style="margin-top:0">${title}</h2>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label style="font-size:0.85em">Nom de la formule</label>
        <input type="text" id="fpNom" value="${escapeHtml(editorState.nom)}" placeholder="Ex : Apéro dînatoire 50p">
      </div>
      <div>
        <label style="font-size:0.85em">Type interne (logique de calcul)</label>
        <select id="fpType">
          ${TYPE_IDS.map(t => `<option value="${t}"${editorState.typeId===t?' selected':''}>${escapeHtml(getTypeLabel(t))}</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;margin-bottom:6px">
      <h3 style="margin:0;font-size:0.95em">Paramètres du type</h3>
      ${Object.keys(editorState.overrides || {}).length > 0
        ? `<button type="button" id="fpResetAllParams" style="padding:3px 10px;font-size:0.8em;background:transparent;border:1px solid rgba(0,0,0,0.2);border-radius:4px;cursor:pointer">↺ Réinitialiser tous les params au défaut du type</button>`
        : ''}
    </div>
    <div id="fpParams" style="display:grid;grid-template-columns:repeat(${Math.max(2, meta.paramIds.length)},1fr);gap:10px;margin-bottom:18px">
      ${paramsHtml || '<p class="legend" style="grid-column:1/-1">(Aucun paramètre pour ce type)</p>'}
    </div>

    <h3 style="font-size:0.95em">Items restauration de la formule</h3>
    <table style="font-size:0.85em;margin-bottom:10px">
      <thead>
        <tr>
          <th style="text-align:left">Libellé</th>
          <th class="num">Coût €/p</th>
          <th class="num">Prix €/p</th>
          <th>TVA</th>
          <th class="num" title="1 unité couvre N personnes">par X p</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="fpItemsBody">${itemsRowsHtml}</tbody>
    </table>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <select id="fpBddSelect" style="flex:1;min-width:200px">
        <option value="">+ Ajouter depuis la BDD…</option>
        ${bddOpts}
      </select>
      <button onclick="addFormulePrestaItemFromBdd()">+ Ajouter</button>
      <button onclick="addFormulePrestaItemNew()">+ Créer nouvel item</button>
    </div>
    <p class="legend" id="fpFeedback" style="min-height:1.2em">&nbsp;</p>

    <div class="modalActions" style="margin-top:12px">
      <button onclick="closeFormulePrestaEditor()">Annuler</button>
      <button onclick="saveFormulePrestaFromEditor()" class="primary" style="margin-top:0">Enregistrer</button>
    </div>
  `;

  // Listeners du modal (délégation locale)
  wireEditorListeners();
}

// Libellés UI pour les paramètres
const PARAM_LABELS = {
  paramSpecPrix: 'Prix client HT spectacle (€)',
  paramSpecCout: 'Coût réel HT spectacle (€)',
  forfaitSalleSeule: 'Forfait HT (€)',
  coutSalleSeule: 'Coût réel HT (€)',
  coutInterCocktail: 'Coût intervenant (€)',
  coutMatCocktail: 'Coût matières / pers (€)',
  margeAtelier: 'Marge atelier (%)',
  coutInterImpro: 'Coût intervenant (€)',
  prixPersImpro: 'Prix client HT / pers (€)',
  prixGroupe: 'Prix client HT / pers (€)',
  coutGroupe: 'Coût HT / pers (€)'
};

function wireEditorListeners() {
  const body = document.getElementById('formulePrestaModalBody');
  if (!body) return;

  // Nom
  const nomEl = document.getElementById('fpNom');
  nomEl?.addEventListener('input', e => { editorState.nom = e.target.value; });

  // Type → re-render (les params dépendent du type)
  const typeEl = document.getElementById('fpType');
  typeEl?.addEventListener('change', e => {
    editorState.typeId = e.target.value;
    // En changeant de type, on perd les overrides précédents (les paramIds diffèrent)
    editorState.overrides = {};
    renderEditor();
  });

  // Params — chaque saisie devient un override SAUF si la valeur est identique
  // au défaut du type (auquel cas on retire l'override pour rester "hérité").
  // Note : on ne re-render PAS sur input pour ne pas faire sauter le focus.
  // L'utilisateur verra le badge hérité/personnalisé se mettre à jour à la
  // prochaine ouverture du modal OU au blur.
  body.querySelectorAll('[data-fp-param]').forEach(el => {
    el.addEventListener('input', e => {
      const pid = el.dataset.fpParam;
      const v = parseFloat(e.target.value) || 0;
      const def = getDefaultParam(editorState.typeId, pid);
      if (Math.abs(v - def) < FLOAT_EPSILON) {
        delete editorState.overrides[pid];
      } else {
        editorState.overrides[pid] = v;
      }
    });
    // Au blur (perte de focus), re-render pour rafraîchir le badge hérité/personnalisé
    el.addEventListener('blur', () => renderEditor());
  });

  // Reset d'un param individuel → supprime l'override + re-render
  body.querySelectorAll('[data-fp-reset-param]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.fpResetParam;
      if (editorState.overrides && pid in editorState.overrides) {
        delete editorState.overrides[pid];
        renderEditor();
      }
    });
  });

  // Reset global de tous les overrides → confirm + clear
  const resetAllBtn = document.getElementById('fpResetAllParams');
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      if (!confirm('Réinitialiser tous les paramètres aux valeurs par défaut du type ?')) return;
      editorState.overrides = {};
      renderEditor();
    });
  }

  // Items
  body.querySelectorAll('[data-fp-item-key]').forEach(el => {
    el.addEventListener('input', e => {
      const i = parseInt(el.dataset.i);
      const k = el.dataset.fpItemKey;
      const v = e.target.value;
      if (!editorState.items[i]) return;
      if (k === 'coutHT' || k === 'prixHT') editorState.items[i][k] = parseFloat(v) || 0;
      else if (k === 'personnesParUnite') editorState.items[i][k] = Math.max(1, parseInt(v) || 1);
      else editorState.items[i][k] = v;
    });
    el.addEventListener('change', e => {
      const i = parseInt(el.dataset.i);
      const k = el.dataset.fpItemKey;
      if (editorState.items[i]) editorState.items[i][k] = e.target.value;
    });
  });
}

// Handlers globaux invoqués depuis le HTML inline
export function addFormulePrestaItemFromBdd() {
  const sel = document.getElementById('fpBddSelect');
  if (!sel || !editorState) return;
  const id = sel.value;
  if (!id) return;
  const src = state.bddItems.find(b => b.id === id);
  if (!src) return;
  editorState.items.push({
    libelle: src.libelle,
    coutHT: src.coutHT,
    prixHT: src.prixHT,
    tvaCat: src.tvaCat,
    personnesParUnite: 1
  });
  sel.value = '';
  renderEditor();
}

export function addFormulePrestaItemNew() {
  if (!editorState) return;
  editorState.items.push({
    libelle: 'Nouvel item',
    coutHT: 0,
    prixHT: 0,
    tvaCat: 'restauration',
    personnesParUnite: 1
  });
  renderEditor();
}

export function removeFormulePrestaItem(i) {
  if (!editorState) return;
  editorState.items.splice(i, 1);
  renderEditor();
}

// Pousse un item de l'éditeur vers la BDD globale (réutilisable dans d'autres formules)
export function pushFormulePrestaItemToBdd(i, btnEl) {
  if (!editorState) return;
  const it = editorState.items[i];
  if (!it) return;
  saveItemToBdd({
    libelle: it.libelle,
    coutHT: it.coutHT,
    prixHT: it.prixHT,
    tvaCat: it.tvaCat
  }, btnEl);
}

export function saveFormulePrestaFromEditor() {
  if (!editorState) return;
  const nom = (editorState.nom || '').trim();
  if (!nom) {
    const fb = document.getElementById('fpFeedback');
    if (fb) { fb.textContent = 'Nom requis.'; fb.style.color = '#8a1a1a'; }
    return;
  }
  editorState.nom = nom;
  editorState.dateModification = nowIso();
  delete editorState.__isNew;

  const existingIdx = state.formulesPrestation.findIndex(f => f.id === editorState.id);
  if (existingIdx >= 0) {
    state.formulesPrestation[existingIdx] = editorState;
  } else {
    state.formulesPrestation.push(editorState);
  }
  persistFormulesV2();
  refreshFormulesPrestaTable();
  refreshFormuleSelectInFiche();
  closeFormulePrestaEditor();
}

export function duplicateFormulePresta(id) {
  const f = getFormuleById(id);
  if (!f) return;
  const copy = JSON.parse(JSON.stringify(f));
  copy.id = newFormuleId();
  copy.nom = `${f.nom} (copie)`;
  copy.builtIn = false;
  copy.dateCreation = nowIso();
  copy.dateModification = nowIso();
  state.formulesPrestation.push(copy);
  persistFormulesV2();
  refreshFormulesPrestaTable();
  refreshFormuleSelectInFiche();
}

export function deleteFormulePresta(id) {
  const f = getFormuleById(id);
  if (!f) return;
  if (!confirm(`Supprimer la formule « ${f.nom} » ?\nLes fiches qui la référençaient afficheront « Formule supprimée » mais conserveront leur snapshot.`)) return;
  state.formulesPrestation = state.formulesPrestation.filter(x => x.id !== id);
  persistFormulesV2();
  refreshFormulesPrestaTable();
  refreshFormuleSelectInFiche();
}
