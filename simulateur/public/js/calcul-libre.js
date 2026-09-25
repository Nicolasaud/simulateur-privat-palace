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
    // Groupe ou réservation en journée : pas de service en salle facturé, même
    // si la formule du bloc porte la brique ⚡ Personnel. Le garde-fou de
    // calculerPersonnelFiche ne couvrait que la ligne automatique.
    if (id === 'sys_personnel' && ctx.modePrivatisation === false) return;
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
  // Sauf si la fiche les consolide en une seule ligne après tous les blocs
  // (ctx.fraisResaParFiche) — cf. calculerFraisResaFiche.
  const caHors = lignes.reduce((s, l) => s + l.totalHT, 0);
  for (const itemId of (ctx.fraisResaParFiche ? [] : fraisIds)) {
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
  // Priorité : bloc.prixFormule (override bloc) > formuleLib.prixHT (biblio).
  // Si > 0 ET des items ont été matérialisés → collapse les lignes 'resto/item'
  // en UNE ligne au nom de la formule + prix formule × qty. Les items
  // système (personnel, spectacle, frais résa) restent séparés.
  const formulePrix = Number(
    (bloc?.prixFormule !== undefined && bloc?.prixFormule !== null && bloc.prixFormule > 0)
      ? bloc.prixFormule
      : (formuleLib?.prixHT || 0)
  );
  const formuleMode = bloc?.prixFormuleMode || formuleLib?.prixMode || 'perPers';
  // TVA du forfait : réglage du bloc prioritaire, sinon celui de la formule en
  // bibliothèque, sinon prestation (20 %). Elle s'applique à tout le forfait,
  // les TVA des items fusionnés n'ayant plus de ligne propre.
  const formuleTva = bloc?.tvaFormule || formuleLib?.tvaCat || 'prestation';
  if (formulePrix > 0 && hasMaterialized) {
    const formuleQty = formuleMode === 'perPers' ? nbPers : 1;
    const isRestoLine = (l) => l.type === 'resto' || l.type === 'item';

    // Coût total à conserver dans la ligne agrégée
    const coutAgrege = lignes
      .filter(isRestoLine)
      .reduce((s, l) => s + (l.coutHT || 0), 0);

    // Détail des items fusionnés — affiché sous la ligne formule dans la vue
    // interne (libellé + coût HT). N'entre pas dans les totaux : ces lignes
    // sont déjà comptées par la ligne agrégée.
    const detail = lignes
      .filter(isRestoLine)
      .map(l => ({ libelle: l.libelle, coutHT: l.coutHT || 0 }));

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
      tvaCat: formuleTva,
      type: 'formule',
      detail
    });
  }

  return { lignes };
}

// Personnel de salle de la fiche — même logique automatique que les frais de
// réservation : en privatisation, la brique ⚡ Personnel n'est pas un prérequis.
// Une seule ligne pour la fiche, dimensionnée sur le total des convives.
// Si un bloc a déjà produit sa propre ligne personnel (via sa formule), on ne
// double pas : la ligne automatique n'est ajoutée que s'il n'y en a aucune.
// Retourne { ligne, blocIdx } ou null.
export function calculerPersonnelFiche(blocs, lignes, ctx) {
  if (ctx.modePrivatisation === false) return null;
  const list = Array.isArray(blocs) ? blocs : [];
  if (list.length === 0) return null;
  if ((lignes || []).some(l => l.type === 'personnel')) return null;

  const item = resolveItem('sys_personnel', ctx.itemsLib);
  if (!item) return null;

  const nbPersTotal = list.reduce((s, b) => s + (b?.nbPers || 0), 0) || 1;
  const computed = computeSystemItem(item, {
    nbPers: nbPersTotal,
    jour: ctx.jour,
    periode: ctx.periode,
    typeParams: resolveTypeParamsForBloc(list[0], ctx),
    globalParams: ctx.globalParams || {},
    getPersonnelFn: ctx.getPersonnelFn,
    ficheRestoItems: list[0]?.items || [],
    formuleType: list[0]?.formuleType || 'custom',
    jourEstFermeFn: ctx.jourEstFermeFn,
    caJourHabituel: ctx.caJourHabituel,
    caLignesHorsResa: 0
  });
  if (!computed || computed.skip) return null;

  const qty = computed.qty || 1;
  return {
    blocIdx: 0,
    ligne: {
      libelle: computed.libelleDynamique || item.libelle || 'Service en salle',
      qte: qty,
      puHT: Number(computed.prixHT || 0),
      totalHT: Number(computed.prixHT || 0) * qty,
      coutHT: Number(computed.coutHT || 0),
      tvaCat: computed.tvaCat || item.tvaCat || 'prestation',
      type: 'personnel'
    }
  };
}

// Frais de réservation de la fiche — une seule ligne pour l'ensemble des blocs
// (audit b-a). Calculés APRÈS consolidation, donc sur un CA qui inclut le prix
// de vente forfaitaire des formules (audit b-b) : la base des frais est alors
// exactement le « CA du devis hors frais de résa » affiché par la couverture.
// Retourne { ligne, blocIdx } ou null si aucun frais n'est dû.
export function calculerFraisResaFiche(blocs, lignes, ctx) {
  // Réservation de groupe : la salle n'est pas privatisée, aucun frais dû.
  if (ctx.modePrivatisation === false) return null;
  const list = Array.isArray(blocs) ? blocs : [];
  if (list.length === 0) return null;
  // La brique ⚡ Frais de réservation n'est PAS un prérequis : dès que la fiche
  // est une privatisation et que le devis passe sous le seuil de couverture,
  // les frais s'appliquent. On garde le bloc porteur comme contexte de calcul
  // s'il existe (ses params de type), sinon le premier bloc de la fiche.
  const idxPorteur = list.findIndex(b =>
    (resolveFormuleLibForBloc(b, ctx.formulesLib)?.itemIds || []).includes('sys_frais_resa')
  );
  const blocIdx = idxPorteur >= 0 ? idxPorteur : 0;
  const item = resolveItem('sys_frais_resa', ctx.itemsLib);
  if (!item) return null;

  const bloc = list[blocIdx];
  const caLignesHorsResa = (lignes || [])
    .filter(l => l.type !== 'fraisResa')
    .reduce((s, l) => s + (l.totalHT || 0), 0);

  const computed = computeSystemItem(item, {
    nbPers: Math.max(1, bloc?.nbPers || 1),
    jour: ctx.jour,
    periode: ctx.periode,
    typeParams: resolveTypeParamsForBloc(bloc, ctx),
    globalParams: ctx.globalParams || {},
    getPersonnelFn: ctx.getPersonnelFn,
    ficheRestoItems: bloc?.items || [],
    formuleType: bloc?.formuleType || 'custom',
    jourEstFermeFn: ctx.jourEstFermeFn,
    caJourHabituel: ctx.caJourHabituel,
    caLignesHorsResa
  });
  if (!computed || computed.skip) return null;

  return {
    blocIdx,
    ligne: {
      libelle: computed.libelleDynamique || item.libelle || 'Frais de réservation',
      qte: 1,
      puHT: Number(computed.prixHT || 0),
      totalHT: Number(computed.prixHT || 0),
      coutHT: 0,
      tvaCat: computed.tvaCat || item.tvaCat || 'prestation',
      type: 'fraisResa'
    }
  };
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
  // Le mode vient de la fiche elle-même (défaut privatisation pour les fiches
  // enregistrées avant l'ajout du champ), sauf si le caller l'impose.
  const modePrivatisation = ctx.modePrivatisation !== undefined
    ? ctx.modePrivatisation
    : config.modePrivatisation !== false;
  const enrichedCtx = { ...ctx, jour, fraisResaParFiche: true, modePrivatisation };

  const lignes = [];
  const warnings = [];
  blocs.forEach((bloc, idx) => {
    const r = calculerBlocLibre(bloc, enrichedCtx);
    if (r.warning) warnings.push(r.warning);
    r.lignes.forEach(l => lignes.push({ ...l, blocIdx: idx }));
  });

  // Personnel puis frais de réservation : le personnel fait partie du CA qui
  // sert de base au calcul des frais, il doit donc être ajouté avant.
  const perso = calculerPersonnelFiche(blocs, lignes, enrichedCtx);
  if (perso) lignes.push({ ...perso.ligne, blocIdx: perso.blocIdx });

  // Frais de réservation : une seule fois pour la fiche, après tous les blocs.
  const frais = calculerFraisResaFiche(blocs, lignes, enrichedCtx);
  if (frais) lignes.push({ ...frais.ligne, blocIdx: frais.blocIdx });

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
