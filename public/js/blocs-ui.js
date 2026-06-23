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

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

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

  const formulesOpts = state.formulesPrestation.map(f =>
    `<option value="${f.id}"${bloc.formuleId === f.id ? ' selected' : ''}>${escapeHtml(f.nom)}</option>`
  ).join('');

  const itemsHtml = (bloc.items || []).length === 0
    ? '<p class="legend" style="margin:4px 0 6px">Aucun item resto.</p>'
    : '<div class="bloc-items">' + (bloc.items || []).map((it, i) => `
        <div class="bloc-item-row" style="display:grid;grid-template-columns:1fr 70px 70px 1fr auto;gap:4px;align-items:center;margin-bottom:3px">
          <input type="text" value="${escapeHtml(it.libelle)}" data-bloc-item-key="libelle" data-bloc-idx="${idx}" data-i="${i}" placeholder="Libellé" style="font-size:0.85em;padding:3px 5px">
          <input type="number" step="0.1" value="${it.coutHT}" data-bloc-item-key="coutHT" data-bloc-idx="${idx}" data-i="${i}" style="text-align:right;font-size:0.85em;padding:3px 5px" title="Coût €/p">
          <input type="number" step="0.1" value="${it.prixHT}" data-bloc-item-key="prixHT" data-bloc-idx="${idx}" data-i="${i}" style="text-align:right;font-size:0.85em;padding:3px 5px" title="Prix €/p">
          <select data-bloc-item-key="tvaCat" data-bloc-idx="${idx}" data-i="${i}" style="font-size:0.85em;padding:3px 5px">
            <option value="restauration"${it.tvaCat==='restauration'?' selected':''}>Resto 10%</option>
            <option value="bar"${it.tvaCat==='bar'?' selected':''}>Bar 20%</option>
          </select>
          <button class="delete" onclick="removeBlocItem(${idx},${i})" style="padding:2px 7px">×</button>
        </div>`).join('') + '</div>';

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

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px;margin-bottom:10px">
      <div style="flex:1">
        <label style="font-size:0.78em;color:#666;margin-bottom:2px">Formule</label>
        <select data-bloc-field="formuleId" data-bloc-idx="${idx}" style="width:100%">
          <option value="">— Sélectionner —</option>
          ${formulesOpts}
        </select>
      </div>
      <div style="width:90px">
        <label style="font-size:0.78em;color:#666;margin-bottom:2px">Nb pers</label>
        <input type="number" min="1" value="${bloc.nbPers}" data-bloc-field="nbPers" data-bloc-idx="${idx}" style="width:100%">
      </div>
      <button class="delete" onclick="removeBloc(${idx})" ${canDelete?'':'disabled'} style="${canDelete?'':'opacity:0.3;cursor:not-allowed;'}padding:6px 10px;height:36px" title="${canDelete?'Supprimer cette formule':'Au moins une formule requise'}">×</button>
    </div>

    <details ${(bloc.items||[]).length>0?'open':''} style="margin:8px 0">
      <summary style="font-size:0.85em;font-weight:500;cursor:pointer;padding:4px 0">Items restauration (${(bloc.items||[]).length})</summary>
      ${itemsHtml}
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button onclick="addBlocItem(${idx})" style="font-size:0.85em;padding:3px 8px">+ Vide</button>
        <select data-bloc-bdd-import="${idx}" style="flex:1;min-width:140px;font-size:0.85em">
          <option value="">+ Importer depuis BDD…</option>
          ${bddOpts}
        </select>
      </div>
    </details>

    <div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(0,0,0,0.1);display:flex;justify-content:space-between;font-size:0.85em">
      <span style="color:#666">Sous-total bloc</span>
      <span><strong>${fmt(blocHT)} € HT</strong> · ${fmt(blocTTC)} € TTC</span>
    </div>
  `;

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
    typeId: 'privat-full',
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
  b.items.push({ libelle: 'Nouvel item', coutHT: 0, prixHT: 0, tvaCat: 'restauration' });
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
  } else if (field === 'formuleId') {
    const newFormuleId = rawValue || null;
    if (newFormuleId === b.formuleId) return;
    const formule = newFormuleId ? state.formulesPrestation.find(f => f.id === newFormuleId) : null;
    // Confirmation si items existants vont être remplacés
    if (formule && Array.isArray(b.items) && b.items.length > 0 && Array.isArray(formule.items) && formule.items.length > 0) {
      if (!confirm(`Remplacer la composition actuelle (${b.items.length} items) par celle de la formule « ${formule.nom} » (${formule.items.length} items) ?`)) {
        // Reset le select à l'ancienne valeur
        const sel = document.querySelector(`[data-bloc-field="formuleId"][data-bloc-idx="${idx}"]`);
        if (sel) sel.value = b.formuleId || '';
        return;
      }
    }
    b.formuleId = newFormuleId;
    if (formule) {
      b.typeId = formule.typeId || formule.type;
      b.items = Array.isArray(formule.items) ? JSON.parse(JSON.stringify(formule.items)) : [];
    }
    // Changement de formule → snapshot obsolète
    b.snapshot = null;
    // Si c'est le bloc principal, sync les globaux
    if (idx === 0) {
      state.currentFormuleId = newFormuleId;
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
}

function importItemFromBdd(blocIdx, bddId) {
  const b = state.formules[blocIdx];
  if (!b || !bddId) return;
  const src = state.bddItems.find(x => x.id === bddId);
  if (!src) return;
  if (!Array.isArray(b.items)) b.items = [];
  b.items.push({ libelle: src.libelle, coutHT: src.coutHT, prixHT: src.prixHT, tvaCat: src.tvaCat });
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
