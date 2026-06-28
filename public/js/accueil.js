// Accueil — dashboard avec slider mensuel (Jan 2025 → Déc 2027)
//
// Mois en cours, mois précédents/suivants navigables via flèches ← →
//
// KPIs par mois (vue détaillée du mois sélectionné) :
//   - CA réel HT       = fiches statut="accepte" dont dateEvent ∈ mois
//   - CA objectif HT   = blob `objectifs/mensuel-YYYY-MM` (édit. mdp)
//   - Marge brute (€)  = somme margeBrute des mêmes fiches
//   - Taux de marge %  = margeBrute / CA × 100
//
// Bloc Année (toujours année courante) :
//   - CA signé / réalisé année + objectif annuel
//   - Marge brute annuelle + taux moyen

import { state } from './state.js';
import { fmt, fmtPct } from './helpers.js';
import { getObjectif, putObjectif } from './api.js';
import { showToast } from './ui-feedback.js';

// === Bornes de navigation ===
const MIN_DATE = new Date(2025, 0, 1);  // Jan 2025
const MAX_DATE = new Date(2027, 11, 1); // Déc 2027

// État local du slider : mois actuellement affiché
let currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

// === Helpers période ===
function ymKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function inMonth(iso, d) {
  if (!iso) return false;
  const dt = new Date(iso);
  if (isNaN(dt)) return false;
  return dt.getFullYear() === d.getFullYear() && dt.getMonth() === d.getMonth();
}
function inYear(iso, d) {
  if (!iso) return false;
  const dt = new Date(iso);
  if (isNaN(dt)) return false;
  return dt.getFullYear() === d.getFullYear();
}
function progressColor(pct) {
  if (pct >= 80) return 'good';
  if (pct >= 50) return 'medium';
  return 'low';
}
function clampMonth(d) {
  if (d < MIN_DATE) return new Date(MIN_DATE);
  if (d > MAX_DATE) return new Date(MAX_DATE);
  return d;
}

// === Calculs depuis state.fichesList ===
function computeMonthKpis(d) {
  const fiches = (state.fichesList || []).filter(f => f.statut === 'accepte');
  const moisFiches = fiches.filter(f => inMonth(f.dateEvent, d));
  const moisSigneFiches = fiches.filter(f => inMonth(f.updated_at, d));
  const caReel    = moisFiches.reduce((s, f) => s + (f.totalHT || 0), 0);
  const caSigne   = moisSigneFiches.reduce((s, f) => s + (f.totalHT || 0), 0);
  // Marge : uniquement les fiches qui ont margeBrute persisté
  const fichesAvecMarge = moisFiches.filter(f => typeof f.margeBrute === 'number');
  const margeBrute = fichesAvecMarge.reduce((s, f) => s + f.margeBrute, 0);
  const baseMarge  = fichesAvecMarge.reduce((s, f) => s + (f.totalHT || 0), 0);
  const tauxMarge  = baseMarge > 0 ? (margeBrute / baseMarge) * 100 : 0;
  const fichesSansMarge = moisFiches.length - fichesAvecMarge.length;

  // Prises de contact : prospects en discussion créés ce mois
  const moisContacts = (state.crmList || [])
    .filter(p => p.statut === 'en_discussion' && inMonth(p.created_at, d)).length;

  return { caReel, caSigne, margeBrute, tauxMarge, fichesSansMarge,
           nbFiches: moisFiches.length, moisContacts };
}

function computeYearKpis(d) {
  const fiches = (state.fichesList || []).filter(f => f.statut === 'accepte');
  const anFiches = fiches.filter(f => inYear(f.dateEvent, d));
  const anSigneFiches = fiches.filter(f => inYear(f.updated_at, d));
  const caReel = anFiches.reduce((s, f) => s + (f.totalHT || 0), 0);
  const caSigne = anSigneFiches.reduce((s, f) => s + (f.totalHT || 0), 0);
  const fichesAvecMarge = anFiches.filter(f => typeof f.margeBrute === 'number');
  const margeBrute = fichesAvecMarge.reduce((s, f) => s + f.margeBrute, 0);
  const baseMarge = fichesAvecMarge.reduce((s, f) => s + (f.totalHT || 0), 0);
  const tauxMarge = baseMarge > 0 ? (margeBrute / baseMarge) * 100 : 0;
  return { caReel, caSigne, margeBrute, tauxMarge };
}

// === Rendu principal ===
export async function renderAccueil() {
  const root = document.getElementById('accueilContent');
  if (!root) return;
  const userName = localStorage.getItem('palace_nom') || '';
  // Clamp si jamais on est en dehors des bornes
  currentMonth = clampMonth(currentMonth);
  const moisKey = `mensuel-${ymKey(currentMonth)}`;
  const anneeNow = new Date();
  const anneeKey = `annuel-${currentMonth.getFullYear()}`;

  // Charge en parallèle si pas en cache
  const tasks = [];
  if (!state.objectifs[moisKey])  tasks.push(getObjectif(moisKey).then(v => state.objectifs[moisKey] = v || { ca: 0 }).catch(() => state.objectifs[moisKey] = { ca: 0 }));
  if (!state.objectifs[anneeKey]) tasks.push(getObjectif(anneeKey).then(v => state.objectifs[anneeKey] = v || { ca: 0 }).catch(() => state.objectifs[anneeKey] = { ca: 0 }));
  await Promise.all(tasks);

  const mk = computeMonthKpis(currentMonth);
  const yk = computeYearKpis(currentMonth);
  const objMois = state.objectifs[moisKey]?.ca || 0;
  const objAn   = state.objectifs[anneeKey]?.ca || 0;
  const refMois = Math.max(mk.caSigne, mk.caReel);
  const refAn   = Math.max(yk.caSigne, yk.caReel);
  const pctMois = objMois > 0 ? Math.round((refMois / objMois) * 100) : 0;
  const pctAn   = objAn   > 0 ? Math.round((refAn   / objAn)   * 100) : 0;
  const moisLabel = currentMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const canPrev = currentMonth > MIN_DATE;
  const canNext = currentMonth < MAX_DATE;
  const isCurrent = currentMonth.getFullYear() === anneeNow.getFullYear() && currentMonth.getMonth() === anneeNow.getMonth();

  root.innerHTML = `
    <div class="accueilHero">
      <h1>Tableau de bord</h1>
      <p class="meta" style="margin-bottom:0">Bonjour <strong>${escapeHtml(userName)}</strong> — vue d'ensemble de l'activité commerciale.</p>
    </div>

    <section class="accueilBlock">
      <div class="accueilBlockHeader">
        <div class="accueilMonthSlider">
          <button class="sliderBtn" id="prevMonthBtn" ${canPrev ? '' : 'disabled'} title="Mois précédent">‹</button>
          <h2 class="accueilMonthLabel">${capitalize(moisLabel)}</h2>
          <button class="sliderBtn" id="nextMonthBtn" ${canNext ? '' : 'disabled'} title="Mois suivant">›</button>
          ${isCurrent ? '' : `<button class="sliderTodayBtn" id="todayMonthBtn" title="Revenir au mois en cours">Aujourd'hui</button>`}
        </div>
        <span class="accueilBlockTag">${isCurrent ? 'Mois en cours' : 'Mois sélectionné'}</span>
      </div>

      <div class="accueilKpiGrid">
        <div class="accueilKpi">
          <span class="lbl">CA signé</span>
          <span class="val">${fmt(mk.caSigne)}</span>
          <span class="sub">Devis acceptés (signés) ce mois</span>
        </div>
        <div class="accueilKpi">
          <span class="lbl">CA réalisé</span>
          <span class="val">${fmt(mk.caReel)}</span>
          <span class="sub">Événements ayant lieu ce mois (${mk.nbFiches})</span>
        </div>
        <div class="accueilKpi accueilObjectif" data-key="${moisKey}">
          <span class="lbl">Objectif ${renderLockIcon(moisKey)}</span>
          <span class="val" data-objval="${moisKey}">${fmt(objMois)}</span>
          <span class="sub">Cible commerciale</span>
        </div>
        <div class="accueilKpi">
          <span class="lbl">Prises de contact</span>
          <span class="val">${mk.moisContacts}</span>
          <span class="sub">Nouveaux prospects « En discussion »</span>
        </div>
      </div>

      <div class="accueilProgressWrap">
        <div class="accueilProgressLabel">
          <span>Avancement vers l'objectif</span>
          <span class="accueilProgressPct ${progressColor(pctMois)}">${pctMois} %</span>
        </div>
        <div class="accueilProgressBar"><div class="accueilProgressFill ${progressColor(pctMois)}" style="width:${Math.min(pctMois, 100)}%"></div></div>
      </div>

      <div class="accueilMargeRow">
        <div class="accueilMargeKpi">
          <span class="lbl">Marge brute réalisée</span>
          <span class="val">${fmt(mk.margeBrute)}</span>
          ${mk.fichesSansMarge > 0 ? `<span class="sub warn">${mk.fichesSansMarge} fiche(s) sans données de marge — re-sauve les fiches pour les inclure</span>` : '<span class="sub">Bénéfice avant frais fixes</span>'}
        </div>
        <div class="accueilMargeKpi">
          <span class="lbl">Taux de marge moyen</span>
          <span class="val">${fmtPct(mk.tauxMarge)}</span>
          <span class="sub">Marge brute / CA réalisé</span>
        </div>
      </div>
    </section>

    <section class="accueilBlock">
      <div class="accueilBlockHeader">
        <h2>${currentMonth.getFullYear()}</h2>
        <span class="accueilBlockTag">Année</span>
      </div>
      <div class="accueilKpiGrid accueilKpiGrid-3">
        <div class="accueilKpi">
          <span class="lbl">CA signé sur l'année</span>
          <span class="val">${fmt(yk.caSigne)}</span>
          <span class="sub">Devis acceptés depuis janvier</span>
        </div>
        <div class="accueilKpi">
          <span class="lbl">CA réalisé sur l'année</span>
          <span class="val">${fmt(yk.caReel)}</span>
          <span class="sub">Événements ayant lieu cette année</span>
        </div>
        <div class="accueilKpi accueilObjectif" data-key="${anneeKey}">
          <span class="lbl">Objectif annuel ${renderLockIcon(anneeKey)}</span>
          <span class="val" data-objval="${anneeKey}">${fmt(objAn)}</span>
          <span class="sub">Cible annuelle</span>
        </div>
      </div>
      <div class="accueilProgressWrap">
        <div class="accueilProgressLabel">
          <span>Avancement vers l'objectif annuel</span>
          <span class="accueilProgressPct ${progressColor(pctAn)}">${pctAn} %</span>
        </div>
        <div class="accueilProgressBar"><div class="accueilProgressFill ${progressColor(pctAn)}" style="width:${Math.min(pctAn, 100)}%"></div></div>
      </div>
      <div class="accueilMargeRow">
        <div class="accueilMargeKpi">
          <span class="lbl">Marge brute annuelle</span>
          <span class="val">${fmt(yk.margeBrute)}</span>
          <span class="sub">Bénéfice cumulé</span>
        </div>
        <div class="accueilMargeKpi">
          <span class="lbl">Taux de marge annuel</span>
          <span class="val">${fmtPct(yk.tauxMarge)}</span>
          <span class="sub">Marge brute / CA réalisé</span>
        </div>
      </div>
    </section>

    <p class="legend" style="text-align:center;margin-top:14px">Les chiffres sont calculés en temps réel depuis les fiches devis et le CRM.</p>
  `;

  wireAccueilHandlers();
}

function renderLockIcon(key) {
  if (state.objectifsUnlocked) {
    return `<button class="objBtn" data-action="edit" data-key="${key}" title="Modifier l'objectif">✏️</button>`;
  }
  return `<button class="objBtn" data-action="unlock" data-key="${key}" title="Saisir le mot de passe pour modifier">🔒</button>`;
}

function wireAccueilHandlers() {
  document.querySelectorAll('.accueilObjectif .objBtn').forEach(b => {
    b.addEventListener('click', e => {
      e.preventDefault();
      const action = b.dataset.action;
      const key = b.dataset.key;
      if (action === 'unlock') promptUnlock(key);
      else if (action === 'edit') promptEditObjectif(key);
    });
  });
  document.getElementById('prevMonthBtn')?.addEventListener('click', () => {
    currentMonth = clampMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    renderAccueil();
  });
  document.getElementById('nextMonthBtn')?.addEventListener('click', () => {
    currentMonth = clampMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    renderAccueil();
  });
  document.getElementById('todayMonthBtn')?.addEventListener('click', () => {
    const now = new Date();
    currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    renderAccueil();
  });
}

// === Modal mdp ===
function promptUnlock(focusKey) {
  showInputModal({
    title: 'Modification verrouillée',
    body: 'Saisis le mot de passe administrateur pour modifier les objectifs.',
    placeholder: 'Mot de passe',
    inputType: 'password',
    okLabel: 'Déverrouiller'
  }).then(pwd => {
    if (!pwd) return;
    state.objectifsPassword = pwd;
    state.objectifsUnlocked = true;
    showToast('Objectifs déverrouillés pour cette session', 'success', 1800);
    renderAccueil();
    if (focusKey) setTimeout(() => promptEditObjectif(focusKey), 200);
  });
}

function promptEditObjectif(key) {
  const current = state.objectifs[key]?.ca || 0;
  const labelPeriode = key.startsWith('mensuel') ? 'mensuel' : 'annuel';
  showInputModal({
    title: `Objectif ${labelPeriode}`,
    body: `Saisis le CA cible en € HT pour la période <strong>${key.replace('mensuel-', '').replace('annuel-', '')}</strong>.`,
    placeholder: 'Ex : 50000',
    inputType: 'number',
    defaultValue: current,
    okLabel: 'Enregistrer'
  }).then(async value => {
    if (value === null) return;
    const ca = Number(value);
    if (!isFinite(ca) || ca < 0) {
      showToast('Valeur invalide', 'error');
      return;
    }
    try {
      const saved = await putObjectif(key, ca, state.objectifsPassword || '');
      state.objectifs[key] = saved;
      showToast('Objectif mis à jour', 'success', 1500);
      renderAccueil();
    } catch (e) {
      if (e.status === 403) {
        state.objectifsUnlocked = false;
        state.objectifsPassword = null;
        showToast('Mot de passe incorrect — modifications refusées', 'error');
        renderAccueil();
      } else {
        showToast(`Échec : ${e.body?.error || e.message}`, 'error');
      }
    }
  });
}

// === Mini-modal d'input réutilisable ===
function showInputModal({ title, body, placeholder, inputType = 'text', defaultValue = '', okLabel = 'OK' }) {
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `
      <div class="modalContent" style="max-width:440px">
        <h2 style="margin-top:0">${escapeHtml(title)}</h2>
        <p style="margin:8px 0 14px;color:#555;font-size:0.9em">${body}</p>
        <input type="${inputType}" class="objInput" placeholder="${escapeHtml(placeholder || '')}" value="${escapeHtml(String(defaultValue))}" autofocus>
        <div class="modalActions">
          <button data-act="cancel">Annuler</button>
          <button class="primary" data-act="ok">${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const input = m.querySelector('.objInput');
    setTimeout(() => input.focus(), 30);
    const close = (val) => { m.remove(); resolve(val); };
    m.addEventListener('click', e => {
      if (e.target === m) close(null);
      if (e.target.dataset.act === 'cancel') close(null);
      if (e.target.dataset.act === 'ok') close(input.value);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    });
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
