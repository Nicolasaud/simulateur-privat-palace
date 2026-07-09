// Moteur de calcul LIBRE — Étape 3 de la refonte "items libres".
//
// Rôle : produire un devis complet (lignes + KPIs) à partir de :
//   - une fiche (avec ses blocs et ses items resto)
//   - une bibliothèque d'items libres (catalogue de coûts/prix)
//   - une bibliothèque de formules libres (assemblages ordonnés d'items)
//   - les items système (Personnel auto, Frais résa auto, spectacle, atelier...)
//   - les params globaux + les types internes (défauts + snapshots)
//
// Différence fondamentale avec calcul.js legacy : le déroulé du calcul n'est
// PAS dispatché par une chaîne if/else sur le format. Le format est simplement
// une convention pour choisir la formule libre associée (5 formules "legacy_*"
// seedées automatiquement au boot). Tout le reste = itération sur la liste
// ordonnée d'items de la formule.
//
// Ce moteur est PUR : aucune lecture DOM, aucun state global. Toutes les
// données arrivent via `ctx`. Il peut donc être testé en Node facilement.

import { computeSystemItem, getSystemItem } from './items-systeme.js';

// Résout la formule libre à appliquer pour un bloc de fiche donné.
// - Si bloc.formuleLibId est renseigné → cette formule (utile futur)
// - Sinon fallback sur la formule 'legacy_<typeId>' (seedée d'office)
export function resolveFormuleLibForBloc(bloc, formulesLib) {
  const list = Array.isArray(formulesLib) ? formulesLib : [];
  if (bloc && bloc.formuleLibId) {
    const f = list.find(x => x.id === bloc.formuleLibId);
    if (f) return f;
  }
  const typeId = bloc?.typeId || bloc?.type;
  if (typeId) {
    const legacy = list.find(x => x._legacyTypeId === typeId || x.id === `fl_legacy_${typeId}`);
    if (legacy) return legacy;
  }
  return null;
}

// Résout un item (libre ou système) par son ID depuis les bibliothèques.
export function resolveItem(itemId, itemsLib) {
  if (!itemId) return null;
  // 1. Item système ?
  const sys = getSystemItem(itemId);
  if (sys) return sys;
  // 2. Item libre du catalogue ?
  const list = Array.isArray(itemsLib) ? itemsLib : [];
  return list.find(x => x.id === itemId) || null;
}

// Résout les params effectifs d'un bloc :
//   snapshot bloc > overrides bloc > overrides formule (v2) > défaut type interne
// Cette chaîne suit celle du moteur legacy (calcul.js:getParamForBloc).
export function resolveTypeParamsForBloc(bloc, ctx) {
  const typeInterne = (ctx.typesInternes || []).find(t => t.id === (bloc?.typeId || bloc?.type));
  const defaults = (typeInterne && typeInterne.params) ? { ...typeInterne.params } : {};

  const snap = bloc?.snapshot;
  if (snap && snap.params && typeof snap.params === 'object') {
    return { ...defaults, ...snap.params };
  }

  const overridesFormuleV2 = bloc?.formuleId
    ? (ctx.formulesPrestation || []).find(f => f.id === bloc.formuleId)?.overrides
    : null;
  const overridesBloc = bloc?.overrides || {};
  return { ...defaults, ...(overridesFormuleV2 || {}), ...overridesBloc };
}

// Calcule les lignes d'un bloc via la nouvelle logique "formule libre".
// Retourne un tableau de lignes au même format que calcul.js legacy :
// { libelle, qte, puHT, totalHT, coutHT, tvaCat, type }
export function calculerBlocLibre(bloc, ctx) {
  const formuleLib = resolveFormuleLibForBloc(bloc, ctx.formulesLib);
  if (!formuleLib) {
    // Impossible de produire un devis sans formule associée
    return { lignes: [], warning: `Aucune formule libre associée au type "${bloc?.typeId || '?'}"` };
  }

  const nbPers = Math.max(1, bloc?.nbPers || 1);
  const typeParams = resolveTypeParamsForBloc(bloc, ctx);
  const jour = ctx.jour;
  const periode = ctx.periode;

  const lignes = [];
  // Deux passes : (1) toutes les lignes SAUF fraisResa, pour calculer caHorsResa.
  //               (2) frais résa (dépend du total des autres lignes).
  const itemsIds = Array.isArray(formuleLib.itemIds) ? formuleLib.itemIds : [];

  // Matérialisation : si le bloc a déjà copié des items libres non-système
  // dans bloc.items[] (via updateBlocField → matérialisation), on les ignore
  // dans itemIds pour éviter le double-comptage. Ils seront comptés via
  // sys_user_resto_items OU directement injectés en pass 1 comme items libres
  // "additionnels" (voir plus bas). Les items système restent toujours calculés.
  const materializedSet = new Set(Array.isArray(bloc?.materializedItemIds) ? bloc.materializedItemIds : []);
  const shouldSkipMaterialized = (id) => materializedSet.has(id) && !getSystemItem(id);

  // Séparer l'ID frais-résa des autres
  const nonFraisIds = [];
  const fraisIds = [];
  itemsIds.forEach(id => {
    if (shouldSkipMaterialized(id)) return;
    if (id === 'sys_frais_resa') fraisIds.push(id);
    else nonFraisIds.push(id);
  });

  // Si des items ont été matérialisés dans bloc.items[] mais que la formule
  // n'inclut PAS sys_user_resto_items, on l'ajoute virtuellement pour que
  // ces items soient bien calculés (avec leur mode fixe/variable).
  const hasUserResto = itemsIds.includes('sys_user_resto_items');
  const hasMaterialized = (bloc?.items || []).length > 0 && materializedSet.size > 0;
  if (hasMaterialized && !hasUserResto) {
    nonFraisIds.push('sys_user_resto_items');
  }

  const pushLigne = (item, computed) => {
    if (!computed || computed.skip) return;
    // Item système "multi-lignes" (ex: user_resto_items)
    if (Array.isArray(computed.multi)) {
      computed.multi.forEach(sub => {
        lignes.push({
          libelle: sub.libelle,
          qte: sub.qty || 1,
          puHT: Number(sub.prixHT || 0),
          totalHT: Number(sub.prixHT || 0) * (sub.qty || 1),
          coutHT: Number(sub.coutHT || 0) * (sub.qty || 1),
          tvaCat: sub.tvaCat,
          type: sub.type
        });
      });
      return;
    }
    const qty = computed.qty || 1;
    lignes.push({
      libelle: computed.libelleDynamique || item.libelle || '',
      qte: qty,
      puHT: Number(computed.prixHT || 0),
      totalHT: Number(computed.prixHT || 0) * qty,
      coutHT: computed.perPers
        ? Number(computed.coutHT || 0) * qty
        : Number(computed.coutHT || 0),
      tvaCat: computed.tvaCat || item.tvaCat || 'prestation',
      type: computed.type || item.type || 'item'
    });
  };

  // === Pass 1 : items non-frais-résa ===
  for (const itemId of nonFraisIds) {
    const item = resolveItem(itemId, ctx.itemsLib);
    if (!item) continue;

    const itemCtx = {
      nbPers,
      jour,
      periode,
      typeParams,
      globalParams: ctx.globalParams || {},
      getPersonnelFn: ctx.getPersonnelFn,
      ficheRestoItems: bloc?.items || [],
      formuleType: bloc?.formuleType || 'custom',
      jourEstFermeFn: ctx.jourEstFermeFn,
      caJourHabituel: ctx.caJourHabituel,
      caLignesHorsResa: 0    // pas utile pour pass 1
    };

    if (item.systemFn) {
      pushLigne(item, computeSystemItem(item, itemCtx));
    } else {
      // Item libre "normal" — par défaut on considère perPers pour resto/bar,
      // unit sinon. Peut être surchargé par item.mode dans le futur.
      const mode = item.mode || (['restauration', 'bar'].includes(item.tvaCat) ? 'perPers' : 'unit');
      const qty = mode === 'perPers' ? nbPers : 1;
      lignes.push({
        libelle: item.libelle,
        qte: qty,
        puHT: Number(item.prixHT || 0),
        totalHT: Number(item.prixHT || 0) * qty,
        coutHT: Number(item.coutHT || 0) * qty,
        tvaCat: item.tvaCat || 'prestation',
        type: mode === 'perPers' && ['restauration', 'bar'].includes(item.tvaCat) ? 'resto' : 'item'
      });
    }
  }

  // === Pass 2 : frais résa (dépend du total des autres lignes) ===
  const caHors = lignes.reduce((s, l) => s + l.totalHT, 0);
  for (const itemId of fraisIds) {
    const item = resolveItem(itemId, ctx.itemsLib);
    if (!item) continue;
    const itemCtx = {
      nbPers,
      jour, periode,
      typeParams,
      globalParams: ctx.globalParams || {},
      getPersonnelFn: ctx.getPersonnelFn,
      ficheRestoItems: bloc?.items || [],
      formuleType: bloc?.formuleType || 'custom',
      jourEstFermeFn: ctx.jourEstFermeFn,
      caJourHabituel: ctx.caJourHabituel,
      caLignesHorsResa: caHors
    };
    pushLigne(item, computeSystemItem(item, itemCtx));
  }

  // === Phase "Prix formule global" =====================================
  // Si la formule libre a un prixHT > 0, on collapse toutes les lignes
  // "resto/formule" (items non-système matérialisés depuis bloc.items) en
  // UNE SEULE ligne au nom de la formule. Les coûts sont conservés, les prix
  // par item sont écrasés (→ 0) et remplacés par le prix formule.
  // Les lignes système (personnel, spectacle, frais résa, etc.) restent
  // séparées car elles ont leur propre logique de tarification.
  const formulePrix = Number(formuleLib?.prixHT || 0);
  if (formulePrix > 0 && hasMaterialized) {
    const formuleMode = formuleLib.prixMode || 'perPers';
    const formuleQty = formuleMode === 'perPers' ? nbPers : 1;
    const isRestoLine = (l) => l.type === 'resto' || l.type === 'item';

    // Coût total à conserver dans la ligne agrégée
    const coutAgrege = lignes
      .filter(isRestoLine)
      .reduce((s, l) => s + (l.coutHT || 0), 0);

    // Retire les lignes "resto/item" — elles seront remplacées
    for (let i = lignes.length - 1; i >= 0; i--) {
      if (isRestoLine(lignes[i])) lignes.splice(i, 1);
    }

    // Insère la ligne formule EN TÊTE (visible côté client comme seule ligne "formule")
    lignes.unshift({
      libelle: formuleLib.nom || 'Formule',
      qte: formuleQty,
      puHT: formulePrix,
      totalHT: formulePrix * formuleQty,
      coutHT: coutAgrege,
      tvaCat: 'prestation',   // 20% par défaut ; à affiner si besoin
      type: 'formule'
    });
  }

  return { lignes };
}

// Calcule TOUS les blocs d'une fiche et agrège les totaux.
// ctx doit contenir : itemsLib, formulesLib, typesInternes, formulesPrestation,
// globalParams, jour/periode/caJourHabituel, getPersonnelFn, jourEstFermeFn,
// tvaFn(tvaCat) → nombre (pour totalTTC).
export function calculerFicheLibre(fiche, ctx) {
  const config = fiche?.config || {};
  const blocs = Array.isArray(config.formules) ? config.formules : [];
  const jour = config.day || 'vendredi';

  // Le CA jour dépend de la période effective — on laisse le caller le
  // résoudre et le passer via ctx. Idem pour jour fermé.
  const enrichedCtx = { ...ctx, jour };

  const lignes = [];
  const warnings = [];
  blocs.forEach((bloc, idx) => {
    const r = calculerBlocLibre(bloc, enrichedCtx);
    if (r.warning) warnings.push(r.warning);
    r.lignes.forEach(l => lignes.push({ ...l, blocIdx: idx }));
  });

  const tvaFn = ctx.tvaFn || (() => 0);
  let totalHT = 0, totalCout = 0, totalTTC = 0;
  const tvaParTaux = {};
  lignes.forEach(l => {
    const tva = tvaFn(l.tvaCat);
    const tvaMontant = l.totalHT * tva / 100;
    totalHT += l.totalHT;
    totalCout += l.coutHT;
    totalTTC += l.totalHT + tvaMontant;
    tvaParTaux[tva] = (tvaParTaux[tva] || 0) + tvaMontant;
  });

  const nbPersTotal = blocs.reduce((s, b) => s + (b?.nbPers || 0), 0) || 1;
  const margeBrute = totalHT - totalCout;

  return {
    lignes,
    warnings,
    totalHT: Math.round(totalHT * 100) / 100,
    totalCout: Math.round(totalCout * 100) / 100,
    totalTTC: Math.round(totalTTC * 100) / 100,
    margeBrute: Math.round(margeBrute * 100) / 100,
    tauxMarge: totalHT > 0 ? (margeBrute / totalHT) * 100 : 0,
    prixPers: Math.round((totalHT / nbPersTotal) * 100) / 100,
    tvaParTaux,
    nbPers: nbPersTotal
  };
}
