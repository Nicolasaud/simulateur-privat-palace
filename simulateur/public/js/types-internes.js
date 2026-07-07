// Types internes (Modèle C — niveau 1).
//
// 5 types figés correspondant aux 5 logiques de calcul de calcul.js.
// Chaque type porte :
//   - un libellé éditable (state.typesInternes[i].nom)
//   - les valeurs PAR DÉFAUT de ses paramètres (state.typesInternes[i].params)
//
// Les formules-v2 référencent un typeId et stockent seulement leurs overrides.
// Le moteur de calcul lit chaque param via la chaîne :
//   snapshot fiche > override formule > défaut type interne
//
// Au premier login (blob vide), on seede les 5 types avec les valeurs courantes
// des inputs globaux (mêmes valeurs que celles utilisées par les formules de
// base déjà seedées en cloud → diff = 0 → overrides = {}).

import { $ } from './helpers.js';
import { state } from './state.js';
import { getTypesInternes, putTypesInternes, scheduleFlush } from './api.js';
import { TYPES_META, TYPE_IDS } from './formules-prestation.js';

// Helpers de lookup
export function getTypeInterneById(id) {
  return state.typesInternes.find(t => t.id === id) || null;
}

// Valeur par défaut d'un paramètre pour un type donné (0 si type ou param absent).
export function getDefaultParam(typeId, paramId) {
  const t = getTypeInterneById(typeId);
  if (!t) return 0;
  const v = t.params?.[paramId];
  return (typeof v === 'number' && !isNaN(v)) ? v : 0;
}

// Libellé affichable d'un type (depuis le blob, ou fallback TYPES_META).
export function getTypeLabel(typeId) {
  const t = getTypeInterneById(typeId);
  return t?.nom || TYPES_META[typeId]?.label || typeId;
}

// Snapshot des valeurs actuelles des inputs globaux pour un type donné.
// Utilisé seulement au seed initial.
function snapshotParamsForType(typeId) {
  const meta = TYPES_META[typeId];
  if (!meta) return {};
  const out = {};
  meta.paramIds.forEach(pid => {
    const el = $(pid);
    if (el) out[pid] = parseFloat(el.value) || 0;
  });
  return out;
}

function buildDefaultTypes() {
  return TYPE_IDS.map(typeId => ({
    id: typeId,
    nom: TYPES_META[typeId].label,
    params: snapshotParamsForType(typeId)
  }));
}

export async function loadTypesInternesFromCloud() {
  try {
    const list = await getTypesInternes();
    state.typesInternes = Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Lecture types-internes cloud échouée', e);
    state.typesInternes = [];
  }
}

export function persistTypesInternes() {
  scheduleFlush('types-internes', () => putTypesInternes(state.typesInternes));
}

// Si le blob est vide, on seede les 5 types depuis les inputs globaux et
// on persiste immédiatement. À appeler APRÈS loadParamsFromCloud().
export async function seedTypesInternesIfEmpty() {
  if (state.typesInternes.length > 0) return false;
  const defaults = buildDefaultTypes();
  state.typesInternes = defaults;
  try {
    await putTypesInternes(defaults);
    console.info(`[types-internes] Seed initial : ${defaults.length} types créés.`);
    return true;
  } catch (e) {
    console.error('Seed types-internes échoué', e);
    return false;
  }
}

// Migration douce : si un type a un paramId nouveau qu'il n'a pas en mémoire
// (parce qu'on a ajouté un paramètre côté code après le seed initial),
// on le complète depuis l'input global (ou 0).
export function reconcileTypesInternes() {
  let touched = false;
  state.typesInternes.forEach(t => {
    const meta = TYPES_META[t.id];
    if (!meta) return;
    if (!t.params) t.params = {};
    meta.paramIds.forEach(pid => {
      if (!(pid in t.params)) {
        const el = $(pid);
        t.params[pid] = el ? (parseFloat(el.value) || 0) : 0;
        touched = true;
      }
    });
  });
  if (touched) persistTypesInternes();
}

// Update champ params d'un type (setter unifié pour l'UI).
export function updateTypeInterneParam(typeId, paramId, value) {
  const t = getTypeInterneById(typeId);
  if (!t) return;
  if (!t.params) t.params = {};
  t.params[paramId] = parseFloat(value) || 0;
  persistTypesInternes();
}

export function updateTypeInterneNom(typeId, nom) {
  const t = getTypeInterneById(typeId);
  if (!t) return;
  t.nom = String(nom || '').trim() || TYPES_META[typeId]?.label || typeId;
  persistTypesInternes();
}

// =====================================================================
// UI — section "Types internes (logique de calcul)"
// =====================================================================

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Libellés UI des paramètres (réutilisés depuis l'éditeur de formule)
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

export function refreshTypesInternesUI() {
  const container = document.getElementById('typesInternesList');
  if (!container) return;
  container.innerHTML = '';
  // Ordre fixe = TYPE_IDS
  TYPE_IDS.forEach(typeId => {
    const t = getTypeInterneById(typeId);
    if (!t) return;
    const meta = TYPES_META[typeId];
    const gridClass = (meta.paramIds.length >= 3) ? 'grid-3' : 'grid-2';

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.tiTypeId = typeId;
    card.style.cssText = 'margin-bottom:12px;padding:14px;border:1px solid rgba(0,0,0,0.08);border-radius:6px;background:#fafafa';

    const paramsHtml = meta.paramIds.map(pid => {
      const v = t.params?.[pid] ?? 0;
      return `
        <div>
          <label style="font-size:0.85em">${escapeHtml(PARAM_LABELS[pid] || pid)}</label>
          <input type="number" step="0.01" data-ti-param="${pid}" value="${v}">
        </div>`;
    }).join('');

    card.innerHTML = `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;align-items:end;margin-bottom:12px">
        <div>
          <label style="font-size:0.85em">Nom affiché</label>
          <input type="text" data-ti-key="nom" value="${escapeHtml(t.nom)}">
        </div>
        <div style="font-family:'Lexend',monospace;font-size:0.75em;color:#888;padding-bottom:10px">
          ID interne : <code>${escapeHtml(typeId)}</code>
        </div>
      </div>
      <div class="${gridClass}">
        ${paramsHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

// Wire listener délégué — appelé une seule fois au boot.
let _tiListenersRegistered = false;
export function registerTypesInternesListeners() {
  if (_tiListenersRegistered) return;
  _tiListenersRegistered = true;
  document.addEventListener('input', e => {
    const card = e.target.closest('[data-ti-type-id]');
    if (!card) return;
    const typeId = card.dataset.tiTypeId;
    if (e.target.dataset.tiKey === 'nom') {
      updateTypeInterneNom(typeId, e.target.value);
      // Le libellé change → refresh table biblio + select fiche
      // (déclenchés par window pour éviter import circulaire)
      window.refreshFormulesPrestaTable?.();
      window.refreshFormuleSelectInFiche?.();
      return;
    }
    const pid = e.target.dataset.tiParam;
    if (pid) {
      updateTypeInterneParam(typeId, pid, e.target.value);
      // ⚠️ Important : ne pas re-render la card sinon le focus saute pendant la saisie.
      // Les formules de fiche qui héritent du défaut verront la nouvelle valeur
      // au prochain recalcul (déclenché par syncHiddenInputsFromFormule au
      // changement de formule, ou au save de fiche).
    }
  });
}

