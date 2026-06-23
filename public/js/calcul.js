// Moteur de calcul du devis + rendu (KPIs, vue interne, vue client, alertes, couverture).

import {
  $, val, fmt, fmtPct,
  getTva, getCaJour, getPeriodeEffective, jourEstFerme, getPlafond, getPersonnel
} from './helpers.js';
import { state } from './state.js';

// Lecture d'un paramètre de type interne pour UN BLOC précis (multi-formules).
// Chaîne du Modèle C étendue au niveau bloc :
//   1. snapshot du bloc (post-save) → immuable
//   2. overrides du bloc (commits ultérieurs : UI bloc-spécifique)
//   3. overrides de la formule référencée par le bloc
//   4. défaut du type interne (state.typesInternes[bloc.typeId].params)
//   5. fallback val() — utile seulement pour le bloc actif (DOM legacy)
export function getParamForBloc(bloc, paramId) {
  if (!bloc) return val(paramId);
  if (bloc.snapshot && bloc.snapshot.params && paramId in bloc.snapshot.params) {
    return +bloc.snapshot.params[paramId] || 0;
  }
  if (bloc.overrides && paramId in bloc.overrides) {
    return +bloc.overrides[paramId] || 0;
  }
  const f = bloc.formuleId
    ? state.formulesPrestation.find(x => x.id === bloc.formuleId)
    : null;
  if (f && f.overrides && paramId in f.overrides) {
    return +f.overrides[paramId] || 0;
  }
  const typeId = bloc.typeId || (f && (f.typeId || f.type));
  const t = typeId ? state.typesInternes.find(x => x.id === typeId) : null;
  if (t && t.params && paramId in t.params) {
    return +t.params[paramId] || 0;
  }
  return val(paramId);
}

// Synchronise state.formules[0] depuis le DOM. Garantit qu'on a toujours au
// moins un bloc en RAM cohérent avec les inputs UI courants (commit 2 : UI
// inchangée donc 1 seul bloc édité via #format/#nbPers/state.items).
// Crée le bloc s'il n'existe pas. Préserve blocId et snapshot existants.
export function syncCurrentBlocFromDom() {
  const typeId = $('format').value;
  const nbPers = Math.max(1, parseInt($('nbPers').value) || 1);
  const formuleType = $('formuleType').value;
  const formuleId = state.currentFormuleId || null;
  if (!Array.isArray(state.formules) || state.formules.length === 0) {
    state.formules = [{
      blocId: state.currentBlocId || ('bloc_' + Date.now().toString(36)),
      formuleId,
      typeId,
      nbPers,
      items: state.items,
      overrides: {},
      snapshot: state.currentSnapshot || null,
      formuleType
    }];
    state.currentBlocId = state.formules[0].blocId;
  } else {
    const b = state.formules[0];
    b.typeId = typeId;
    b.nbPers = nbPers;
    b.formuleType = formuleType;
    b.formuleId = formuleId;
    b.items = state.items;  // re-binding au cas où state.items a été réassigné
    b.snapshot = state.currentSnapshot || null;
  }
  return state.formules;
}

// Compute snapshot des params effectifs d'un bloc donné.
// Capturés au moment du save dans bloc.snapshot.
export function computeBlocSnapshot(bloc) {
  if (!bloc) return null;
  const typeId = bloc.typeId || 'privat-full';
  const t = state.typesInternes.find(x => x.id === typeId);
  const paramIds = t && t.params ? Object.keys(t.params) : [];
  const params = {};
  paramIds.forEach(pid => { params[pid] = getParamForBloc(bloc, pid); });
  return {
    typeId,
    formuleId: bloc.formuleId || null,
    params,
    dateSnapshot: new Date().toISOString()
  };
}

// Alias rétro-compat utilisé par fiches.saveFiche : capture le snapshot du
// bloc principal de la fiche en cours.
export function computeCurrentSnapshot() {
  syncCurrentBlocFromDom();
  return computeBlocSnapshot(state.formules[0]);
}

// Alias rétro-compat pour le bloc principal — utilisé en interne ci-dessous.
function getParamForCurrentFiche(paramId) {
  syncCurrentBlocFromDom();
  return getParamForBloc(state.formules[0], paramId);
}

// Calcule les lignes d'un bloc isolé. Toute la logique du dispatch par type
// vit ici. Au commit 2, calculer() itère sur state.formules avec 1 seul
// élément (UI inchangée). Au commit 3, la boucle traitera N blocs.
//
// Les valeurs non-bloc-spécifiques (margePersonnel, margeIntervenants,
// bufferCouverture, CA habituels, getPersonnel, jourEstFerme...) sont lues
// via val() / helpers globaux. Les params de type interne passent par
// getParamForBloc(bloc, paramId) qui suit la chaîne du Modèle C.
export function calculerBloc(bloc, jour) {
  const format = bloc.typeId;
  const nbPers = Math.max(1, bloc.nbPers || 1);
  const formuleType = bloc.formuleType || 'custom';
  const items = Array.isArray(bloc.items) ? bloc.items : [];
  const margeInter = val('margeIntervenants') / 100;

  const lignes = [];

  if (format === 'privat-full') {
    lignes.push({
      libelle: 'Spectacle (plateau humour)',
      qte: 1,
      puHT: getParamForBloc(bloc, 'paramSpecPrix'),
      totalHT: getParamForBloc(bloc, 'paramSpecPrix'),
      coutHT: getParamForBloc(bloc, 'paramSpecCout'),
      tvaCat: 'prestation',
      type: 'spectacle'
    });

    const perso = getPersonnel(nbPers);
    const margePerso = val('margePersonnel') / 100;
    const prixPersoHT = perso.cout * (1 + margePerso);
    lignes.push({
      libelle: `Service en salle (${perso.nbStaff} personnes &times; ${perso.duree}h)`,
      qte: 1,
      puHT: prixPersoHT,
      totalHT: prixPersoHT,
      coutHT: perso.cout,
      tvaCat: 'prestation',
      type: 'personnel'
    });

    if (formuleType === 'custom') {
      items.forEach(item => {
        lignes.push({
          libelle: item.libelle,
          qte: nbPers,
          puHT: item.prixHT,
          totalHT: item.prixHT * nbPers,
          coutHT: item.coutHT * nbPers,
          tvaCat: item.tvaCat,
          type: 'resto'
        });
      });
    }

    if (!jourEstFerme(jour)) {
      const periode = getPeriodeEffective();
      const caJour = getCaJour(jour, periode);
      const buffer = val('bufferCouverture') / 100;
      const seuil = caJour * (1 + buffer);
      const caHorsResa = lignes.reduce((s, l) => s + l.totalHT, 0);
      const fraisResa = Math.max(0, seuil - caHorsResa);
      if (fraisResa > 0) {
        lignes.push({
          libelle: `Frais de réservation (couverture ${jour} ${periode})`,
          qte: 1,
          puHT: fraisResa,
          totalHT: fraisResa,
          coutHT: 0,
          tvaCat: 'prestation',
          type: 'fraisResa'
        });
      }
    }
  }
  else if (format === 'privat-salle') {
    lignes.push({
      libelle: 'Privatisation salle seule (sans spectacle)',
      qte: 1,
      puHT: getParamForBloc(bloc, 'forfaitSalleSeule'),
      totalHT: getParamForBloc(bloc, 'forfaitSalleSeule'),
      coutHT: getParamForBloc(bloc, 'coutSalleSeule'),
      tvaCat: 'prestation',
      type: 'privatSalle'
    });
    if (formuleType === 'custom') {
      const perso = getPersonnel(nbPers);
      const margePerso = val('margePersonnel') / 100;
      if (perso.cout > 0) {
        lignes.push({
          libelle: `Service en salle (${perso.nbStaff} personnes &times; ${perso.duree}h)`,
          qte: 1,
          puHT: perso.cout * (1 + margePerso),
          totalHT: perso.cout * (1 + margePerso),
          coutHT: perso.cout,
          tvaCat: 'prestation',
          type: 'personnel'
        });
      }
      items.forEach(item => {
        lignes.push({
          libelle: item.libelle,
          qte: nbPers,
          puHT: item.prixHT,
          totalHT: item.prixHT * nbPers,
          coutHT: item.coutHT * nbPers,
          tvaCat: item.tvaCat,
          type: 'resto'
        });
      });
    }
    if (!jourEstFerme(jour)) {
      const periode = getPeriodeEffective();
      const caJour = getCaJour(jour, periode);
      const buffer = val('bufferCouverture') / 100;
      const seuil = caJour * (1 + buffer);
      const caHorsResa = lignes.reduce((s, l) => s + l.totalHT, 0);
      const fraisResa = Math.max(0, seuil - caHorsResa);
      if (fraisResa > 0) {
        lignes.push({
          libelle: `Frais de réservation (couverture ${jour} ${periode})`,
          qte: 1,
          puHT: fraisResa,
          totalHT: fraisResa,
          coutHT: 0,
          tvaCat: 'prestation',
          type: 'fraisResa'
        });
      }
    }
  }
  else if (format === 'atelier-cocktail') {
    const coutInter = getParamForBloc(bloc, 'coutInterCocktail');
    const coutMat = getParamForBloc(bloc, 'coutMatCocktail');
    const margeAtelier = getParamForBloc(bloc, 'margeAtelier') / 100;
    lignes.push({
      libelle: 'Animation atelier cocktail (intervenant)',
      qte: 1,
      puHT: coutInter * (1 + margeAtelier),
      totalHT: coutInter * (1 + margeAtelier),
      coutHT: coutInter,
      tvaCat: 'prestation',
      type: 'inter'
    });
    const prixMatPers = coutMat * (1 + margeAtelier);
    lignes.push({
      libelle: 'Atelier cocktail — matières & boissons (par participant)',
      qte: nbPers,
      puHT: prixMatPers,
      totalHT: prixMatPers * nbPers,
      coutHT: coutMat * nbPers,
      tvaCat: 'bar',
      type: 'matieres'
    });
  }
  else if (format === 'formation-impro') {
    const coutInter = getParamForBloc(bloc, 'coutInterImpro');
    const prixInter = coutInter * (1 + margeInter);
    lignes.push({
      libelle: 'Animation formation impro (intervenant)',
      qte: 1,
      puHT: prixInter,
      totalHT: prixInter,
      coutHT: coutInter,
      tvaCat: 'prestation',
      type: 'inter'
    });
    const prixParticip = getParamForBloc(bloc, 'prixPersImpro');
    const prixParticipNet = Math.max(0, prixParticip - prixInter / nbPers);
    lignes.push({
      libelle: 'Formation impro — par participant',
      qte: nbPers,
      puHT: prixParticipNet,
      totalHT: prixParticipNet * nbPers,
      coutHT: 0,
      tvaCat: 'prestation',
      type: 'pers'
    });
  }
  else if (format === 'groupe-classique') {
    const prixGroupe = getParamForBloc(bloc, 'prixGroupe');
    const coutGroupe = getParamForBloc(bloc, 'coutGroupe');
    lignes.push({
      libelle: 'Soirée Palace Comedy — billet groupe',
      qte: nbPers,
      puHT: prixGroupe,
      totalHT: prixGroupe * nbPers,
      coutHT: coutGroupe * nbPers,
      tvaCat: 'spectacle',
      type: 'billet'
    });
    if (formuleType === 'custom') {
      items.forEach(item => {
        lignes.push({
          libelle: item.libelle,
          qte: nbPers,
          puHT: item.prixHT,
          totalHT: item.prixHT * nbPers,
          coutHT: item.coutHT * nbPers,
          tvaCat: item.tvaCat,
          type: 'resto'
        });
      });
    }
  }

  return lignes;
}

export function calculer() {
  const jour = $('day').value;
  syncCurrentBlocFromDom();
  const blocs = state.formules;

  const lignes = [];
  blocs.forEach(bloc => {
    lignes.push(...calculerBloc(bloc, jour));
  });

  // Méta retournée pour recalcul() : reflète la fiche entière.
  // Commit 2 (1 bloc) : format = type du bloc principal, nbPers = nbPers du bloc.
  // Commit 3+ : format reste celui du bloc principal (utilisé pour les alertes
  // bas-de-page), nbPers = somme des nbPers de tous les blocs.
  const principal = blocs[0];
  return {
    format: principal ? principal.typeId : 'privat-full',
    jour,
    nbPers: blocs.reduce((s, b) => s + (b.nbPers || 0), 0) || 1,
    lignes
  };
}

export function recalcul() {
  const { format, jour, nbPers, lignes } = calculer();

  let totalHT = 0, totalCout = 0, totalTTC = 0;
  const tvaParTaux = {};
  lignes.forEach(l => {
    const tva = getTva(l.tvaCat);
    const tvaMontant = l.totalHT * tva / 100;
    totalHT += l.totalHT;
    totalCout += l.coutHT;
    totalTTC += l.totalHT + tvaMontant;
    tvaParTaux[tva] = (tvaParTaux[tva] || 0) + tvaMontant;
  });

  const margeBrute = totalHT - totalCout;
  const tauxMarge = totalHT > 0 ? (margeBrute / totalHT) * 100 : 0;
  const prixPers = totalHT / nbPers;

  $('kpiTotalHT').textContent = fmt(totalHT);
  $('kpiTotalTTC').textContent = fmt(totalTTC);
  $('kpiPrixPers').textContent = fmt(prixPers);
  $('kpiMarge').textContent = fmt(margeBrute);
  $('kpiTaux').textContent = fmtPct(tauxMarge);

  const plafond = getPlafond(jour);
  $('kpiBoxPrixPers').className = 'kpi' + (prixPers > plafond ? ' error' : (prixPers > plafond * 0.85 ? ' warn' : ' ok'));
  const margeBoxClass = tauxMarge < 50 ? ' error' : (tauxMarge < 60 ? ' warn' : ' ok');
  $('kpiBoxMarge').className = 'kpi' + margeBoxClass;
  $('kpiBoxTaux').className = 'kpi' + margeBoxClass;

  const tbody = document.querySelector('#tableInterne tbody');
  tbody.innerHTML = '';
  lignes.forEach(l => {
    const tva = getTva(l.tvaCat);
    const ttc = l.totalHT * (1 + tva/100);
    const margeL = l.totalHT - l.coutHT;
    tbody.innerHTML += `<tr>
      <td>${l.libelle}</td>
      <td class="num">${fmt(l.coutHT)}</td>
      <td class="num">${fmt(l.totalHT)}</td>
      <td class="num">${fmt(margeL)}</td>
      <td class="num">${tva}%</td>
      <td class="num">${fmt(ttc)}</td>
    </tr>`;
  });
  document.querySelector('#tableInterne tfoot').innerHTML = `<tr>
    <td>Total</td>
    <td class="num">${fmt(totalCout)}</td>
    <td class="num">${fmt(totalHT)}</td>
    <td class="num">${fmt(margeBrute)}</td>
    <td></td>
    <td class="num">${fmt(totalTTC)}</td>
  </tr>`;

  renderVueClient(lignes, nbPers, totalHT, totalTTC, tvaParTaux);

  renderCouverture(format, jour, lignes);

  const alertes = computeAlertes(format, jour, nbPers, lignes, prixPers, tauxMarge, plafond);
  $('alertesBox').innerHTML = alertes.map(a => `<div class="alerte ${a.type}">${a.text}</div>`).join('');

  const periode = getPeriodeEffective();
  const override = $('periodeOverride').value;
  const dateEvent = $('ficheDateEvent') ? $('ficheDateEvent').value : '';
  const source = override === 'auto' ? (dateEvent ? `auto via date ${dateEvent}` : 'auto sans date → P2 prudent') : 'forcée manuellement';
  $('periodeIndicator').textContent = `Période effective : ${periode} (${source})`;

  window._lastDevis = { format, jour, nbPers, lignes, totalHT, totalTTC, tvaParTaux, prixPers, tauxMarge, periode };
}

function renderCouverture(format, jour, lignes) {
  const box = $('couvertureBox');
  const content = $('couvertureContent');
  if (!['privat-full','privat-salle'].includes(format) || jourEstFerme(jour)) {
    box.style.display = 'none';
    return;
  }
  const periode = getPeriodeEffective();
  const caJour = getCaJour(jour, periode);
  const buffer = val('bufferCouverture');
  const seuil = caJour * (1 + buffer / 100);
  const fraisResaLigne = lignes.find(l => l.type === 'fraisResa');
  const fraisResa = fraisResaLigne ? fraisResaLigne.totalHT : 0;
  const caHorsResa = lignes.filter(l => l.type !== 'fraisResa').reduce((s, l) => s + l.totalHT, 0);
  const couverturePct = caJour > 0 ? Math.round(caHorsResa / caJour * 100) : 0;
  const couvertureSeuilPct = seuil > 0 ? Math.round(caHorsResa / seuil * 100) : 0;

  const couleur = fraisResa === 0 ? '#0a5c2c' : (couvertureSeuilPct < 50 ? '#8a1a1a' : '#7a4400');
  const message = fraisResa === 0
    ? `<strong style="color:${couleur}">✓ Le devis couvre le CA habituel + buffer. Aucun frais de réservation appliqué.</strong>`
    : `<strong style="color:${couleur}">Frais de réservation appliqués pour atteindre le seuil : ${fmt(fraisResa)}</strong>`;

  content.innerHTML = `
    <table style="width:100%;font-size:0.88em;margin:0">
      <tr><td>Période effective</td><td class="num"><strong>${periode}</strong> ${periode === 'P1' ? '(mai-sept, basse saison)' : '(oct-avr, haute saison)'}</td></tr>
      <tr><td>CA habituel B2C ${jour} ${periode}</td><td class="num">${fmt(caJour)}</td></tr>
      <tr><td>Seuil de couverture (CA &times; ${(1 + buffer/100).toFixed(2)})</td><td class="num"><strong>${fmt(seuil)}</strong></td></tr>
      <tr><td>CA HT du devis hors frais de résa</td><td class="num">${fmt(caHorsResa)}</td></tr>
      <tr><td>Couverture du CA habituel</td><td class="num">${couverturePct}%</td></tr>
      <tr><td>Couverture du seuil</td><td class="num"><strong style="color:${couleur}">${couvertureSeuilPct}%</strong></td></tr>
    </table>
    <p style="margin-top:10px;font-size:0.88em">${message}</p>
  `;
  box.style.display = 'block';
}

function renderVueClient(lignes, nbPers, totalHT, totalTTC, tvaParTaux) {
  const vueMode = document.querySelector('input[name="vueClient"]:checked').value;
  const fondreFraisResa = $('fondreFraisResa').checked;
  const tbodyC = document.querySelector('#tableClient tbody');
  const tfootC = document.querySelector('#tableClient tfoot');
  tbodyC.innerHTML = '';

  let lignesClient = lignes.map(l => ({ ...l }));

  if (fondreFraisResa) {
    const fraisResa = lignesClient.find(l => l.type === 'fraisResa');
    if (fraisResa) {
      lignesClient = lignesClient.filter(l => l.type !== 'fraisResa');
      const cibles = lignesClient.filter(l => ['personnel','resto'].includes(l.type));
      const totalCibles = cibles.reduce((s, l) => s + l.totalHT, 0);
      if (totalCibles > 0) {
        cibles.forEach(c => {
          const ratio = c.totalHT / totalCibles;
          const aRepartir = fraisResa.totalHT * ratio;
          c.totalHT += aRepartir;
          c.puHT = c.totalHT / c.qte;
        });
      } else {
        lignesClient.push(fraisResa);
      }
    }
  }

  if (vueMode === 'decomposee') {
    const lignesGrp = [];
    const restoBuckets = {};
    lignesClient.forEach(l => {
      if (l.type === 'resto') {
        const tva = getTva(l.tvaCat);
        const k = `${tva}`;
        if (!restoBuckets[k]) restoBuckets[k] = { totalHT: 0, qte: nbPers, tvaCat: l.tvaCat, tva };
        restoBuckets[k].totalHT += l.totalHT;
      } else {
        lignesGrp.push(l);
      }
    });
    Object.values(restoBuckets).forEach(b => {
      lignesGrp.push({
        libelle: b.tva === 10 ? 'Prestation restauration' : (b.tva === 20 ? 'Boissons (bar)' : `Restauration (TVA ${b.tva}%)`),
        qte: b.qte,
        puHT: b.totalHT / b.qte,
        totalHT: b.totalHT,
        tvaCat: b.tvaCat
      });
    });

    lignesGrp.forEach(l => {
      const tva = getTva(l.tvaCat);
      const ttc = l.totalHT * (1 + tva/100);
      tbodyC.innerHTML += `<tr>
        <td>${l.libelle}</td>
        <td class="num">${l.qte}</td>
        <td class="num">${fmt(l.puHT)}</td>
        <td class="num">${fmt(l.totalHT)}</td>
        <td class="num">${tva}%</td>
        <td class="num">${fmt(ttc)}</td>
      </tr>`;
    });
  } else {
    const prixPers = totalHT / nbPers;
    const libellePrincipal = ($('forfaitLibelle').value || 'Forfait événementiel tout inclus').replace(/</g, '&lt;');
    const sousLibelle = ($('forfaitSousLibelle').value || '').replace(/</g, '&lt;');
    tbodyC.innerHTML += `<tr>
      <td>${libellePrincipal}${sousLibelle ? `<br><span style="font-size:0.85em;color:#666">${sousLibelle}</span>` : ''}</td>
      <td class="num">${nbPers}</td>
      <td class="num">${fmt(prixPers)}</td>
      <td class="num">${fmt(totalHT)}</td>
      <td class="num">— mixte</td>
      <td class="num">${fmt(totalTTC)}</td>
    </tr>`;
  }

  let tfootHTML = `<tr><td colspan="3">Total HT</td><td class="num">${fmt(totalHT)}</td><td></td><td></td></tr>`;
  Object.entries(tvaParTaux).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0])).forEach(([taux, montant]) => {
    tfootHTML += `<tr><td colspan="4" style="text-align:right">TVA ${taux}%</td><td></td><td class="num">${fmt(montant)}</td></tr>`;
  });
  tfootHTML += `<tr><td colspan="5">Total TTC</td><td class="num">${fmt(totalTTC)}</td></tr>`;
  tfootC.innerHTML = tfootHTML;
}

function computeAlertes(format, jour, nbPers, lignes, prixPers, tauxMarge, plafond) {
  const alertes = [];

  if (prixPers > plafond) {
    alertes.push({
      type: 'error',
      text: `Prix par personne (${fmt(prixPers)}) au-dessus du plafond commercial recommandé (${fmt(plafond)}/pers le ${jour}). Risque de devis « invendable ». Solutions : augmenter le nombre de pers, basculer sur un jour fermé (lun-mar), ou réduire la formule resto.`
    });
  } else if (prixPers > plafond * 0.85) {
    alertes.push({
      type: 'warn',
      text: `Prix par personne (${fmt(prixPers)}) proche du plafond ${fmt(plafond)}. À justifier commercialement.`
    });
  }

  if (tauxMarge < 50) {
    alertes.push({
      type: 'error',
      text: `Taux de marge brute (${fmtPct(tauxMarge)}) sous le plancher 50% du cadrage stratégique. Augmenter le prix client ou réduire les coûts.`
    });
  } else if (tauxMarge < 60) {
    alertes.push({
      type: 'warn',
      text: `Taux de marge (${fmtPct(tauxMarge)}) sous l'objectif 60% du cadrage. À surveiller.`
    });
  }

  if (nbPers > 70 && (format === 'privat-full' || format === 'privat-salle')) {
    alertes.push({
      type: 'info',
      text: `Capacité Palace = 70 pers assis. Au-delà : configuration cocktail debout uniquement.`
    });
  }

  if (format === 'privat-salle' && !['lundi','mardi'].includes(jour)) {
    const hasFraisResa = lignes.some(l => l.type === 'fraisResa');
    if (!hasFraisResa) {
      alertes.push({
        type: 'info',
        text: `Pas de frais de réservation appliqués : la prestation couvre déjà le CA habituel + buffer du jour. Vérifie cohérence commerciale.`
      });
    }
  }

  if (format === 'privat-full' && (jour === 'lundi' || jour === 'mardi')) {
    alertes.push({
      type: 'info',
      text: `Lun-Mar = cible commerciale prioritaire (cadrage stratégique). Aucun manque à gagner, journées normalement non-génératrices de revenus.`
    });
  }

  if (alertes.length === 0) {
    alertes.push({ type: 'ok', text: `Devis dans les rails commerciaux et de marge.` });
  }

  return alertes;
}

export function copyDevisText() {
  const d = window._lastDevis;
  if (!d) return;
  let txt = `DEVIS PRIVATISATION PALACE COMEDY\n`;
  txt += `Format : ${d.format}\n`;
  txt += `Jour : ${d.jour} — ${d.nbPers} personnes\n\n`;
  txt += `--- Détail ---\n`;
  d.lignes.forEach(l => {
    txt += `${l.libelle} | qté ${l.qte} | ${fmt(l.puHT)}/u | total ${fmt(l.totalHT)} HT\n`;
  });
  txt += `\nTotal HT : ${fmt(d.totalHT)}\n`;
  Object.entries(d.tvaParTaux).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0])).forEach(([taux, m]) => {
    txt += `TVA ${taux}% : ${fmt(m)}\n`;
  });
  txt += `Total TTC : ${fmt(d.totalTTC)}\n`;
  txt += `Prix HT/pers : ${fmt(d.prixPers)}\n`;
  txt += `Marge brute : ${fmt(d.totalHT - d.lignes.reduce((s,l) => s + l.coutHT, 0))} (${fmtPct(d.tauxMarge)})\n`;
  navigator.clipboard.writeText(txt).then(() => {
    alert('Devis copié dans le presse-papiers.');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    alert('Devis copié.');
  });
}

export function refreshForfaitLibelleVisibility() {
  const vue = document.querySelector('input[name="vueClient"]:checked').value;
  $('forfaitLibelleBlock').style.display = vue === 'prixPers' ? 'block' : 'none';
}

export function registerCalculListeners() {
  $('formuleType').addEventListener('change', e => {
    $('customFormuleBlock').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  document.querySelectorAll('input[name="vueClient"]').forEach(r => {
    r.addEventListener('change', refreshForfaitLibelleVisibility);
  });
}
