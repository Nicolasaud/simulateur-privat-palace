// Multi-formules — rendu UI des blocs de la fiche en cours + récap global.
//
// Au commit 3 : remplacement de l'UI mono (formuleSelect + nbPers + customFormuleBlock
// + itemsList) par N cards multi-blocs. Chaque card est une formule avec son propre
// nb pers, ses items resto, son dropdown formule, son sous-total.
//
// Source de vérité : state.formules[]. Toute mutation des inputs UI passe par
// updateBlocField / updateBlocItem qui mute state.formules puis appelle recalcul().

import { $, fmt, getTva } from './helpers.js';
import { state } from './state.js';
import { calculerBloc, recalcul } from './calcul.js';
import { setDirty } from './fiches.js';
import { newBlocId } from './blocs.js';
import { getTypeLabel } from './types-internes.js';
import { createCombobox } from './combobox.js';
import { resolveFormuleLibForBloc } from './calcul-libre.js';
import { getSystemItem } from './items-systeme.js';
import { LEGACY_FORMULES_LIB } from './formules-lib-seed.js';

// Mapping typeId → emoji tag pour la combobox formule (Étape 7).
// Les formules libres personnalisées peuvent surcharger via `formule.tag`.
const TYPE_TAG_EMOJI = {
  'privat-full': '🎭',
  'privat-salle': '🏢',
  'atelier-cocktail': '🍸',
  'formation-impro': '🎬',
  'groupe-classique': '🎉'
};
function tagFor(formule) {
  if (!formule) return '';
  if (formule.tag) return formule.tag;
  const typeId = formule.typeId || formule._legacyTypeId;
  if (typeId && TYPE_TAG_EMOJI[typeId]) return TYPE_TAG_EMOJI[typeId];
  // Formule libre custom sans tag → icone composable
  if (formule.id && formule.id.startsWith('fl_') && !formule._builtIn) return '🧩';
  return '';
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Résout et affiche les items de la formule courante qui ne sont PAS gérés
// via bloc.items[] (items système auto + items libres pré-remplis depuis la
// bibliothèque). Non-éditables, juste pour info/transparence.
// Retourne du HTML prêt à injecter (chaîne vide si aucun).
function buildAutoBriquesRecap(bloc) {
  // Fusionne bibFormules (chargées du cloud) + LEGACY_FORMULES_LIB (fallback seed local)
  // — mêmes règles que calcul-libre-bridge.js pour rester cohérent avec le moteur.
  const bib = Array.isArray(state.bibFormules) ? state.bibFormules : [];
  const existing = new Set(bib.map(f => f.id));
  const merged = [...bib, ...LEGACY_FORMULES_LIB.filter(l => !existing.has(l.id))];
  const formuleLib = resolveFormuleLibForBloc(bloc, merged);
  if (!formuleLib || !Array.isArray(formuleLib.itemIds)) return '';
  const materializedSet = new Set(Array.isArray(bloc?.materializedItemIds) ? bloc.materializedItemIds : []);
  const rows = [];
  formuleLib.itemIds.forEach(id => {
    if (id === 'sys_user_resto_items') return;   // remplacé par la liste "Items" éditable
    if (materializedSet.has(id)) return;         // déjà dans bloc.items (éditable)
    const sys = getSystemItem(id);
    if (sys) {
      rows.push({ libelle: sys.libelle, behavior: autoBehaviorLabel(sys.systemFn) });
      return;
    }
  });
  if (rows.length === 0) return '';
  const html = rows.map(r => `
    <li style="display:flex;justify-content:space-between;gap:8px;padding:1px 0">
      <span>⚡ ${escapeHtml(r.libelle)}</span>
      <span style="color:#888;font-size:0.85em">${escapeHtml(r.behavior)}</span>
    </li>`).join('');
  return `
    <div style="margin-top:10px;padding:8px 10px;background:rgba(99,102,241,0.06);border:1px dashed rgba(99,102,241,0.3);border-radius:6px;font-size:0.82em">
      <div style="font-weight:500;color:#555;margin-bottom:4px">⚡ Briques auto incluses dans la formule</div>
      <ul style="margin:0;padding-left:0;list-style:none">${html}</ul>
      <p class="legend" style="margin:6px 0 0;font-size:0.9em">Ces briques s'ajoutent automatiquement au devis (pilotées par les params du type interne).</p>
    </div>
  `;
}

function autoBehaviorLabel(systemFn) {
  switch (systemFn) {
    case 'spectacle_full':      return 'Prix fixe (indépendant du nb pers)';
    case 'privat_salle_seule':  return 'Prix fixe (forfait salle)';
    case 'atelier_inter':       return 'Prix fixe (intervenant)';
    case 'atelier_mat':         return '× nb pers';
    case 'impro_inter':         return 'Prix fixe (intervenant)';
    case 'impro_particip':      return '× nb pers (net intervenant)';
    case 'groupe_billet':       return '× nb pers (billet)';
    case 'personnel_auto':      return 'Auto (paliers × durée)';
    case 'frais_resa_auto':     return 'Auto (couverture CA jour)';
    default:                    return 'Auto';
  }
}

// =====================================================================
// Rendu principal
// =====================================================================

export function renderBlocs() {
  const container = document.getElementById('blocsContainer');
  if (!container) return;
  // S'assure d'au moins un bloc (sécurité — newFiche / chargement legacy)
  if (!Array.isArray(state.formules) || state.formules.length === 0) {
    state.formules = [{
      blocId: newBlocId(),
      formuleId: state.currentFormuleId || null,
      typeId: 'privat-full',
      nbPers: 50,
      items: state.items || [],
      overrides: {},
      snapshot: null,
      formuleType: 'custom'
    }];
    state.currentBlocId = state.formules[0].blocId;
  }
  container.innerHTML = '';
  state.formules.forEach((bloc, idx) => {
    container.appendChild(buildBlocCard(bloc, idx));
  });
  renderRecapGlobal();
  wireBlocListeners();
}

function buildBlocCard(bloc, idx) {
  const card = document.createElement('div');
  card.className = 'bloc-card';
  card.dataset.blocIdx = idx;
  card.style.cssText = 'background:#fafafa;border:1px solid rgba(0,0,0,0.12);padding:12px;border-radius:8px;margin-bottom:14px';

  // === Combobox filtrable : uniquement les formules de la Bibliothèque de formules ===
  // (les formules legacy V2 et _builtIn sont masquées — le moteur libre les
  // gère en interne via bloc.typeId + fallback local pour la rétro-compat.)
  const libCustom = (state.bibFormules || []).filter(f => !f._builtIn);
  const libItems = libCustom.map(f => ({
    value: f.id,
    label: f.nom,
    tag: tagFor(f)
  }));
  const comboGroups = libItems.length
    ? [{ label: '📋 Formules', items: libItems }]
    : [];
  // Rétro-compat : si le bloc pointe vers un fp_xxx ancien, on ajoute une
  // option "Formule héritée" en tête pour éviter un select vide.
  if (bloc.formuleId && !bloc.formuleLibId && !libItems.some(o => o.value === bloc.formuleId)) {
    const label = tagFor({ typeId: bloc.typeId }) + ' Formule héritée';
    comboGroups.unshift({
      label: 'Rétro-compat',
      items: [{ value: bloc.formuleId, label: `${label} (${bloc.typeId || 'ancien type'})`, tag: '🔒' }]
    });
  }
  const currentValue = bloc.formuleLibId || bloc.formuleId || '';
  // Placeholder + montage post-DOM

  const itemsHtml = (bloc.items || []).length === 0
    ? '<p class="legend" style="margin:4px 0 6px">Aucun item.</p>'
    : '<div class="bloc-items">' + (bloc.items || []).map((it, i) => {
        const mode = it.mode === 'unit' ? 'unit' : 'perPers';
        const isPerPers = mode === 'perPers';
        return `
        <div class="bloc-item-row" style="border:1px solid rgba(0,0,0,0.08);border-radius:6px;padding:6px 7px;margin-bottom:5px;background:#fff">
          <div style="display:flex;gap:5px;align-items:center;margin-bottom:4px">
            <input type="text" value="${escapeHtml(it.libelle)}" data-bloc-item-key="libelle" data-bloc-idx="${idx}" data-i="${i}" placeholder="Libellé" style="flex:1;font-size:0.88em;padding:3px 6px;font-weight:500">
            <button class="delete" onclick="removeBlocItem(${idx},${i})" style="padding:2px 7px" title="Supprimer">×</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;align-items:center">
            <label style="display:flex;flex-direction:column;font-size:0.7em;color:#888;text-transform:uppercase;letter-spacing:0.02em">
              Coût ${isPerPers?'/pers':'total'}
              <input type="number" step="0.1" value="${it.coutHT}" data-bloc-item-key="coutHT" data-bloc-idx="${idx}" data-i="${i}" style="text-align:right;font-size:0.85em;padding:2px 4px">
            </label>
            <label style="display:flex;flex-direction:column;font-size:0.7em;color:#888;text-transform:uppercase;letter-spacing:0.02em">
              TVA
              <select data-bloc-item-key="tvaCat" data-bloc-idx="${idx}" data-i="${i}" style="font-size:0.85em;padding:2px 3px">
                <option value="restauration"${it.tvaCat==='restauration'?' selected':''}>Resto 10%</option>
                <option value="bar"${it.tvaCat==='bar'?' selected':''}>Bar 20%</option>
                <option value="prestation"${it.tvaCat==='prestation'?' selected':''}>Presta 20%</option>
                <option value="spectacle"${it.tvaCat==='spectacle'?' selected':''}>Spec 5,5%</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;font-size:0.7em;color:#888;text-transform:uppercase;letter-spacing:0.02em" title="× nb pers = coût multiplié par nb pers · Fixe = coût total unique">
              Mode
              <select data-bloc-item-key="mode" data-bloc-idx="${idx}" data-i="${i}" style="font-size:0.85em;padding:2px 3px">
                <option value="perPers"${mode==='perPers'?' selected':''}>× nb pers</option>
                <option value="unit"${mode==='unit'?' selected':''}>Fixe</option>
              </select>
            </label>
          </div>
        </div>`;
      }).join('') + '</div>';

  const bddOpts = state.bddItems.map(b =>
    `<option value="${b.id}">${escapeHtml(b.libelle)} (${fmt(b.coutHT)}→${fmt(b.prixHT)})</option>`
  ).join('');

  // Sous-total HT/TTC du bloc
  const jour = $('day')?.value || 'vendredi';
  const blocLignes = calculerBloc(bloc, jour);
  let blocHT = 0, blocTTC = 0;
  blocLignes.forEach(l => {
    const tva = getTva(l.tvaCat);
    blocHT += l.totalHT;
    blocTTC += l.totalHT * (1 + tva / 100);
  });

  const canDelete = state.formules.length > 1;
  const typeLabel = bloc.formuleId
    ? (state.formulesPrestation.find(f => f.id === bloc.formuleId)?.nom || '')
    : '';

  // Prix vente formule : bloc.prixFormule prioritaire, sinon formule.prixHT, sinon 0
  const formuleLibForBloc = (state.bibFormules || []).find(f => f.id === bloc.formuleLibId);
  const prixFormuleValue = (bloc.prixFormule !== undefined && bloc.prixFormule !== null)
    ? bloc.prixFormule
    : (formuleLibForBloc?.prixHT || 0);
  const prixModeValue = bloc.prixFormuleMode || formuleLibForBloc?.prixMode || 'perPers';
  const hasFormule = !!(bloc.formuleId || bloc.formuleLibId);

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px;margin-bottom:10px">
      <div style="flex:1">
        <label style="font-size:0.78em;color:#666;margin-bottom:2px">Formule</label>
        <div class="bloc-combobox-slot"></div>
      </div>
      <div style="width:90px">
        <label style="font-size:0.78em;color:#666;margin-bottom:2px">Nb pers</label>
        <input type="number" min="1" value="${bloc.nbPers}" data-bloc-field="nbPers" data-bloc-idx="${idx}" style="width:100%">
      </div>
      <button class="delete" onclick="removeBloc(${idx})" ${canDelete?'':'disabled'} style="${canDelete?'':'opacity:0.3;cursor:not-allowed;'}padding:6px 10px;height:36px" title="${canDelete?'Supprimer cette formule':'Au moins une formule requise'}">×</button>
    </div>

    ${hasFormule ? `
    <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;padding:8px 10px;background:linear-gradient(90deg,rgba(16,185,129,0.06),rgba(5,150,105,0.04));border:1px dashed rgba(16,185,129,0.35);border-radius:6px">
      <div style="flex:1">
        <label style="font-size:0.72em;color:#065f46;font-weight:500;text-transform:uppercase;letter-spacing:0.03em">💰 Prix vente formule</label>
        <input type="number" step="0.1" min="0" value="${prixFormuleValue}" data-bloc-field="prixFormule" data-bloc-idx="${idx}" style="width:100%;font-weight:500" placeholder="0.00">
      </div>
      <div style="width:130px">
        <label style="font-size:0.72em;color:#065f46;font-weight:500;text-transform:uppercase;letter-spacing:0.03em">Mode</label>
        <select data-bloc-field="prixFormuleMode" data-bloc-idx="${idx}" style="width:100%">
          <option value="perPers"${prixModeValue==='perPers'?' selected':''}>× nb pers</option>
          <option value="unit"${prixModeValue==='unit'?' selected':''}>Fixe</option>
        </select>
      </div>
    </div>` : ''}

    <details ${(bloc.items||[]).length>0?'open':''} style="margin:8px 0">
      <summary style="font-size:0.85em;font-weight:500;cursor:pointer;padding:4px 0">Items (${(bloc.items||[]).length}) — coûts uniquement</summary>
      ${itemsHtml}
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button onclick="addBlocItem(${idx})" style="font-size:0.85em;padding:3px 8px">+ Vide</button>
        <select data-bloc-bdd-import="${idx}" style="flex:1;min-width:140px;font-size:0.85em">
          <option value="">+ Importer depuis BDD…</option>
          ${bddOpts}
        </select>
      </div>
      ${buildAutoBriquesRecap(bloc)}
    </details>

    <div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(0,0,0,0.1);display:flex;justify-content:space-between;font-size:0.85em">
      <span style="color:#666">Sous-total bloc</span>
      <span><strong>${fmt(blocHT)} € HT</strong> · ${fmt(blocTTC)} € TTC</span>
    </div>
  `;

  // Montage de la combobox (post innerHTML, sinon les listeners sont perdus)
  const slot = card.querySelector('.bloc-combobox-slot');
  if (slot) {
    const combo = createCombobox({
      groups: comboGroups,
      value: currentValue,
      placeholder: 'Rechercher une formule…',
      onChange: (v) => updateBlocField(idx, 'formuleId', v)
    });
    slot.appendChild(combo.el);
  }

  return card;
}

export function renderRecapGlobal() {
  const container = document.getElementById('blocsRecapGlobal');
  if (!container) return;
  const jour = $('day')?.value || 'vendredi';
  let totalHT = 0, totalTTC = 0, totalNbPers = 0;
  state.formules.forEach(bloc => {
    const lignes = calculerBloc(bloc, jour);
    lignes.forEach(l => {
      const tva = getTva(l.tvaCat);
      totalHT += l.totalHT;
      totalTTC += l.totalHT * (1 + tva / 100);
    });
    totalNbPers += (bloc.nbPers || 0);
  });
  const htMoyen = totalNbPers > 0 ? totalHT / totalNbPers : 0;
  const ttcMoyen = totalNbPers > 0 ? totalTTC / totalNbPers : 0;
  const nbFormules = state.formules.length;

  container.innerHTML = `
    <div style="background:#fff;border:1px solid rgba(0,0,0,0.1);padding:10px;border-radius:6px;font-size:0.88em">
      <div style="font-weight:500;margin-bottom:6px;color:#444">Récap fiche (${nbFormules} formule${nbFormules>1?'s':''}, ${totalNbPers} pers)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px">
        <div>Total HT</div><div style="text-align:right"><strong>${fmt(totalHT)} €</strong></div>
        <div>Total TTC</div><div style="text-align:right"><strong>${fmt(totalTTC)} €</strong></div>
        <div style="color:#666">HT moyen/pers</div><div style="text-align:right;color:#666">${fmt(htMoyen)} €</div>
        <div style="color:#666">TTC moyen/pers</div><div style="text-align:right;color:#666">${fmt(ttcMoyen)} €</div>
      </div>
    </div>
  `;
}

// =====================================================================
// Handlers de mutation (appelés depuis HTML inline ou listeners délégués)
// =====================================================================

export function addBloc() {
  state.formules.push({
    blocId: newBlocId(),
    formuleId: null,
    typeId: null,
    nbPers: 50,
    items: [],
    overrides: {},
    snapshot: null,
    formuleType: 'custom'
  });
  setDirty(true);
  renderBlocs();
  recalcul();
}

export function removeBloc(idx) {
  if (state.formules.length <= 1) return;
  const b = state.formules[idx];
  if (!b) return;
  const label = state.formulesPrestation.find(f => f.id === b.formuleId)?.nom || `Formule ${idx + 1}`;
  if (!confirm(`Supprimer le bloc « ${label} » ?`)) return;
  state.formules.splice(idx, 1);
  // Si on a supprimé le bloc principal, le nouveau principal est le bloc 0
  state.currentBlocId = state.formules[0]?.blocId || null;
  state.currentFormuleId = state.formules[0]?.formuleId || null;
  state.currentSnapshot = state.formules[0]?.snapshot || null;
  state.items = state.formules[0]?.items || [];
  setDirty(true);
  renderBlocs();
  recalcul();
}

export function addBlocItem(idx) {
  const b = state.formules[idx];
  if (!b) return;
  if (!Array.isArray(b.items)) b.items = [];
  b.items.push({ libelle: 'Nouvel item', coutHT: 0, prixHT: 0, tvaCat: 'restauration', mode: 'perPers' });
  // Changement d'items → snapshot obsolète (décidé au commit 4)
  b.snapshot = null;
  setDirty(true);
  renderBlocs();
  recalcul();
}

export function removeBlocItem(blocIdx, itemIdx) {
  const b = state.formules[blocIdx];
  if (!b || !Array.isArray(b.items)) return;
  b.items.splice(itemIdx, 1);
  b.snapshot = null;
  setDirty(true);
  renderBlocs();
  recalcul();
}

function updateBlocField(idx, field, rawValue) {
  const b = state.formules[idx];
  if (!b) return;
  if (field === 'nbPers') {
    b.nbPers = Math.max(1, parseInt(rawValue) || 1);
    // nbPers seul ne purge PAS le snapshot (décision user point 4)
  } else if (field === 'prixFormule') {
    b.prixFormule = Math.max(0, parseFloat(rawValue) || 0);
    b.snapshot = null;
    setDirty(true);
    recalcul();
    return;
  } else if (field === 'prixFormuleMode') {
    b.prixFormuleMode = rawValue === 'unit' ? 'unit' : 'perPers';
    b.snapshot = null;
    setDirty(true);
    recalcul();
    return;
  } else if (field === 'formuleId') {
    const newVal = rawValue || null;
    // Étape 6 — détection : formule libre composable (id préfixé fl_) vs formule V2 classique
    const isLibId = typeof newVal === 'string' && newVal.startsWith('fl_');

    if (isLibId) {
      // === Bascule sur une formule libre composable ==================
      if (newVal === b.formuleLibId) return;
      const libF = (state.bibFormules || []).find(f => f.id === newVal);
      if (!libF) return;
      // Confirmation si items déjà saisis (custom)
      if (Array.isArray(b.items) && b.items.length > 0) {
        if (!confirm(`Remplacer la composition actuelle (${b.items.length} items) par la formule composable « ${libF.nom} » ?`)) {
          renderBlocs();   // rollback visuel de la combobox
          return;
        }
      }
      b.formuleLibId = newVal;
      b.formuleId = null;
      // typeId pour le rendu (couverture, plafonds, alertes) : hérité si legacy, sinon fallback privat-full
      b.typeId = libF._legacyTypeId || libF._typeIdRendu || 'privat-full';
      // Matérialisation : on copie les items non-système (items libres du catalogue)
      // dans bloc.items[] pour qu'ils soient éditables + togglables Fixe/Variable
      // directement depuis la fiche. Les items système ⚡ (spectacle, personnel...)
      // restent gérés par le moteur via formuleLib.itemIds.
      const materialized = [];
      const materializedIds = [];
      (libF.itemIds || []).forEach(id => {
        const sys = getSystemItem(id);
        if (sys) return;   // item système : géré côté moteur
        const src = (state.bibItems || []).find(x => x.id === id);
        if (!src) return;
        const mode = src.mode || (['restauration', 'bar'].includes(src.tvaCat) ? 'perPers' : 'unit');
        materialized.push({
          libelle: src.libelle,
          coutHT: Number(src.coutHT || 0),
          prixHT: Number(src.prixHT || 0),
          tvaCat: src.tvaCat || 'prestation',
          mode,
          _srcItemId: id     // trace : d'où vient cet item (pour éviter le double-comptage)
        });
        materializedIds.push(id);
      });
      b.items = materialized;
      b.materializedItemIds = materializedIds;
      // Init prix vente formule depuis la biblio (si défini). L'user peut ensuite ajuster au bloc.
      b.prixFormule = Number(libF.prixHT || 0);
      b.prixFormuleMode = libF.prixMode || 'perPers';
      b.snapshot = null;
    } else {
      // === Bascule sur une formule V2 classique (legacy path) =========
      if (newVal === b.formuleId && !b.formuleLibId) return;
      const formule = newVal ? state.formulesPrestation.find(f => f.id === newVal) : null;
      if (formule && Array.isArray(b.items) && b.items.length > 0 && Array.isArray(formule.items) && formule.items.length > 0) {
        if (!confirm(`Remplacer la composition actuelle (${b.items.length} items) par celle de la formule « ${formule.nom} » (${formule.items.length} items) ?`)) {
          renderBlocs();   // rollback visuel de la combobox
          return;
        }
      }
      b.formuleId = newVal;
      b.formuleLibId = null;
      b.materializedItemIds = [];  // V2 path : items copiés depuis formule.items directement, pas de matérialisation lib
      if (formule) {
        b.typeId = formule.typeId || formule.type;
        b.items = Array.isArray(formule.items) ? JSON.parse(JSON.stringify(formule.items)) : [];
      }
      b.snapshot = null;
    }

    // Si c'est le bloc principal, sync les globaux
    if (idx === 0) {
      state.currentFormuleId = b.formuleId;
      state.currentSnapshot = null;
      state.items = b.items;
    }
    renderBlocs();
  }
  setDirty(true);
  recalcul();
}

function updateBlocItem(blocIdx, itemIdx, key, rawValue) {
  const b = state.formules[blocIdx];
  if (!b || !Array.isArray(b.items) || !b.items[itemIdx]) return;
  if (key === 'coutHT' || key === 'prixHT') {
    b.items[itemIdx][key] = parseFloat(rawValue) || 0;
  } else {
    b.items[itemIdx][key] = rawValue;
  }
  // Modif d'items → snapshot obsolète (décision user point 4)
  b.snapshot = null;
  setDirty(true);
  // Pas de re-render complet sur input pour éviter de perdre le focus
  recalcul();
  // Exception : le changement de mode fait basculer les titres/tooltips (€/pers ↔ total fixe)
  if (key === 'mode') renderBlocs();
}

function importItemFromBdd(blocIdx, bddId) {
  const b = state.formules[blocIdx];
  if (!b || !bddId) return;
  const src = state.bddItems.find(x => x.id === bddId);
  if (!src) return;
  if (!Array.isArray(b.items)) b.items = [];
  b.items.push({ libelle: src.libelle, coutHT: src.coutHT, prixHT: src.prixHT, tvaCat: src.tvaCat, mode: 'perPers' });
  b.snapshot = null;
  setDirty(true);
  renderBlocs();
  recalcul();
}

// =====================================================================
// Listener délégué — input/change sur les contrôles des blocs
// =====================================================================

let _wired = false;
function wireBlocListeners() {
  if (_wired) return;
  _wired = true;
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.blocField) {
      updateBlocField(parseInt(t.dataset.blocIdx), t.dataset.blocField, t.value);
    } else if (t.dataset.blocItemKey) {
      updateBlocItem(parseInt(t.dataset.blocIdx), parseInt(t.dataset.i), t.dataset.blocItemKey, t.value);
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.blocField) {
      updateBlocField(parseInt(t.dataset.blocIdx), t.dataset.blocField, t.value);
    } else if (t.dataset.blocItemKey) {
      updateBlocItem(parseInt(t.dataset.blocIdx), parseInt(t.dataset.i), t.dataset.blocItemKey, t.value);
    } else if (t.dataset.blocBddImport !== undefined) {
      const idx = parseInt(t.dataset.blocBddImport);
      const bddId = t.value;
      if (bddId) {
        importItemFromBdd(idx, bddId);
        t.value = '';
      }
    }
  });
}
