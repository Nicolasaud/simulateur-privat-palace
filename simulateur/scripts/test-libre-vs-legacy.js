#!/usr/bin/env node
/**
 * Test de parité entre le moteur legacy (calcul.js — via resultsSnapshot des
 * fiches déjà sauvegardées) et le nouveau moteur libre (calcul-libre.js).
 *
 * Pour chaque fiche du blob, on relance le moteur libre avec les mêmes
 * données d'entrée et on vérifie que totalHT, prixPers, margeBrute matchent
 * (tolérance 1 cent) le snapshot cloud.
 *
 * Usage :
 *   node scripts/test-libre-vs-legacy.js --api http://localhost:8888 --code PALACE2026
 *   node scripts/test-libre-vs-legacy.js --only-nicolas       # ne teste que Nicolas
 *
 * Codes de sortie :
 *   0 = OK (tous les résultats matchent)
 *   1 = au moins une divergence
 *   2 = erreur infra
 */

// Charger le module ESM du moteur libre + items système
import { calculerFicheLibre } from '../public/js/calcul-libre.js';
import { LEGACY_FORMULES_LIB } from '../public/js/formules-lib-seed.js';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const hasFlag = name => args.includes(name);

const API = argValue('--api', 'http://localhost:8888');
const CODE = argValue('--code', process.env.PALACE_ACCESS_CODE || 'PALACE2026');
const NOM = argValue('--nom', 'Nicolas');
const ONLY_NICOLAS = hasFlag('--only-nicolas');
const VERBOSE = hasFlag('--verbose');
const TOL = 0.01;

const c = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', gray: '\x1b[90m', reset: '\x1b[0m', bold: '\x1b[1m' };
const log = (msg, color) => console.log((color || '') + msg + c.reset);

// === Params HTML defaults (source de vérité pour le fallback) ===
const HTML_DEFAULT_PARAMS = {
  paramDuree: 9,
  paramCoutHoraire: 25,
  margePersonnel: 40,
  margeIntervenants: 40,
  bufferCouverture: 20,
  tvaSpectacle: 5.5,
  tvaResto: 10,
  tvaBar: 20,
  tvaPresta: 20,
  caLunP1: 0, caLunP2: 0,
  caMarP1: 0, caMarP2: 0,
  caMerP1: 907, caMerP2: 1523,
  caJeuP1: 907, caJeuP2: 1523,
  caVenP1: 2613, caVenP2: 4098,
  caSamP1: 2613, caSamP2: 4098,
  caDimP1: 907, caDimP2: 1523
};

const HTML_DEFAULT_PALIERS = [
  { seuil: 30, staff: 4 },
  { seuil: 50, staff: 5 },
  { seuil: 80, staff: 6 },
  { seuil: 120, staff: 7 }
];

function makeGetPersonnelFn(paliers, params) {
  return (nbPers) => {
    let nbStaff = 0;
    let trouve = false;
    for (const p of paliers) {
      if (trouve) break;
      const seuil = Number(p.seuil || 0);
      const staff = Number(p.staff || 0);
      if (nbPers <= seuil) { nbStaff = staff; trouve = true; }
      else nbStaff = staff;
    }
    const duree = Number(params.paramDuree || 9);
    const coutH = Number(params.paramCoutHoraire || 25);
    return { nbStaff, duree, cout: nbStaff * duree * coutH };
  };
}

function jourEstFerme(jour) {
  return jour === 'lundi' || jour === 'mardi';
}

function detectPeriode(dateEvent) {
  if (!dateEvent) return 'P2';
  const m = parseInt(dateEvent.substring(5, 7), 10);
  return (m >= 5 && m <= 9) ? 'P1' : 'P2';
}

function getCaJour(jour, periode, params) {
  const map = {
    lundi: 'caLun', mardi: 'caMar', mercredi: 'caMer', jeudi: 'caJeu',
    vendredi: 'caVen', samedi: 'caSam', dimanche: 'caDim'
  };
  const id = (map[jour] || 'caVen') + (periode === 'P1' ? 'P1' : 'P2');
  return Number(params[id] || 0);
}

function getTva(tvaCat, params) {
  const map = { spectacle: 'tvaSpectacle', restauration: 'tvaResto', bar: 'tvaBar', prestation: 'tvaPresta' };
  return Number(params[map[tvaCat] || 'tvaPresta'] || 0);
}

async function fetchJson(api, cookie, path) {
  const r = await fetch(api + path, { headers: cookie ? { cookie } : {} });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

async function main() {
  log(`\n${c.bold}=== Test parité moteur libre ↔ moteur legacy ===${c.reset}`, c.b);
  log(`API : ${API}`);
  log(`Tolérance : ${TOL} €\n`);

  // 1. Login
  let cookie = '';
  try {
    const r = await fetch(`${API}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE, nom: NOM })
    });
    if (!r.ok) throw new Error(`login HTTP ${r.status}`);
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    log('✓ Login OK', c.g);
  } catch (e) {
    log(`✗ Login échoué : ${e.message}`, c.r);
    process.exit(2);
  }

  // 2. Charger les données globales (params, types, paliers, biblio libre)
  let params, typesInternes, paliers, itemsLib, formulesLib, formulesPrestation;
  try {
    [params, typesInternes, paliers, itemsLib, formulesLib, formulesPrestation] = await Promise.all([
      fetchJson(API, cookie, '/api/params'),
      fetchJson(API, cookie, '/api/types-internes'),
      fetchJson(API, cookie, '/api/paliers'),
      fetchJson(API, cookie, '/api/items-lib'),
      fetchJson(API, cookie, '/api/formules-lib'),
      fetchJson(API, cookie, '/api/formules-v2')
    ]);
    // Fallback params vides → HTML defaults
    if (!params || typeof params !== 'object' || Object.keys(params).length === 0) {
      params = { ...HTML_DEFAULT_PARAMS };
    } else {
      params = { ...HTML_DEFAULT_PARAMS, ...params };
    }
    if (!Array.isArray(paliers) || paliers.length === 0) {
      paliers = HTML_DEFAULT_PALIERS;
    }
    if (!Array.isArray(formulesLib) || formulesLib.length === 0) {
      formulesLib = LEGACY_FORMULES_LIB;
      log(`⚠ formules-lib vide côté cloud — fallback sur le seed local`, c.y);
    } else {
      // S'assurer que les formules legacy sont présentes (sinon fallback)
      const missing = LEGACY_FORMULES_LIB.filter(l => !formulesLib.find(f => f.id === l.id));
      if (missing.length > 0) {
        formulesLib = [...formulesLib, ...missing];
        log(`⚠ ${missing.length} formule(s) legacy manquante(s) → fallback local`, c.y);
      }
    }
    log(`✓ Données globales chargées (params, types, paliers, biblio)`, c.g);
    if (VERBOSE) {
      log(`  paliers: ${JSON.stringify(paliers)}`, c.gray);
      log(`  types: ${typesInternes.map(t => t.id).join(', ')}`, c.gray);
    }
  } catch (e) {
    log(`✗ Chargement données globales échoué : ${e.message}`, c.r);
    process.exit(2);
  }

  // 3. Lister les fiches
  let fichesIndex;
  try {
    fichesIndex = await fetchJson(API, cookie, '/api/fiches');
    if (!Array.isArray(fichesIndex)) fichesIndex = [];
    log(`✓ ${fichesIndex.length} fiches indexées\n`, c.g);
  } catch (e) {
    log(`✗ Liste fiches échouée : ${e.message}`, c.r);
    process.exit(2);
  }

  // 4. Pour chaque fiche, comparer moteur libre vs snapshot
  const ctxBase = {
    itemsLib,
    formulesLib,
    typesInternes,
    formulesPrestation,
    globalParams: params,
    tvaFn: (cat) => getTva(cat, params),
    jourEstFermeFn: jourEstFerme
  };

  let ok = 0, ko = 0, skip = 0;
  const failures = [];

  for (const idx of fichesIndex) {
    if (ONLY_NICOLAS && !((idx.nomFiche || '').toLowerCase().includes('nicolas') || (idx.client || '').toLowerCase().includes('nicolas'))) {
      continue;
    }
    const fiche = await fetchJson(API, cookie, `/api/fiches/${encodeURIComponent(idx.id)}`);
    const snap = fiche.resultsSnapshot;
    if (!snap || typeof snap.totalHT !== 'number') {
      log(`⚠ ${idx.nomFiche || idx.id} — pas de snapshot legacy, SKIP`, c.y);
      skip++;
      continue;
    }
    // Skip les fiches d'ancien format sans config.formules (multi-blocs manquants)
    if (!Array.isArray(fiche.config?.formules) || fiche.config.formules.length === 0) {
      log(`⚠ ${idx.nomFiche || idx.id} — ancien format sans blocs (config.formules absent), SKIP`, c.y);
      skip++;
      continue;
    }

    // Contexte spécifique à la fiche : période, CA jour, palier personnel
    const config = fiche.config || {};
    const jour = config.day || 'vendredi';
    const overridePer = config.periodeOverride;
    const periode = (overridePer === 'P1' || overridePer === 'P2') ? overridePer : detectPeriode(fiche.dateEvent);
    const caJourHabituel = getCaJour(jour, periode, params);
    const getPersonnelFn = makeGetPersonnelFn(paliers, params);

    const result = calculerFicheLibre(fiche, {
      ...ctxBase,
      periode,
      caJourHabituel,
      getPersonnelFn
    });

    const dHT = result.totalHT - snap.totalHT;
    const dPPP = result.prixPers - (snap.prixPers || snap.prixPersHT || 0);
    // Ne compare la marge que si le snapshot en contient une (les vieux
    // snapshots pré-refactor n'ont pas margeBrute)
    const hasLegacyMarge = typeof snap.margeBrute === 'number' && snap.margeBrute > 0;
    const dMarge = hasLegacyMarge ? result.margeBrute - snap.margeBrute : 0;
    const match = Math.abs(dHT) <= TOL && Math.abs(dPPP) <= TOL && Math.abs(dMarge) <= TOL;

    if (match) {
      ok++;
      log(`✓ ${idx.nomFiche || idx.id}  →  ${result.totalHT.toFixed(2)}€ / ${result.prixPers.toFixed(2)}€/p`, c.g);
    } else {
      ko++;
      failures.push({ id: idx.id, nom: idx.nomFiche, dHT, dPPP, dMarge, snap, result });
      log(`✗ ${idx.nomFiche || idx.id}`, c.r);
      log(`   legacy : ${snap.totalHT.toFixed(2)}€ / ${(snap.prixPers || 0).toFixed(2)}€/p / marge ${(snap.margeBrute || 0).toFixed(2)}`, c.r);
      log(`   libre  : ${result.totalHT.toFixed(2)}€ / ${result.prixPers.toFixed(2)}€/p / marge ${result.margeBrute.toFixed(2)}`, c.r);
      log(`   Δ HT ${dHT.toFixed(2)} | Δ €/p ${dPPP.toFixed(2)} | Δ marge ${dMarge.toFixed(2)}`, c.r);
      if (VERBOSE) {
        log(`   lignes libre :`, c.gray);
        result.lignes.forEach(l => log(`     - ${l.libelle} | q=${l.qte} | pu=${l.puHT.toFixed(2)} | tot=${l.totalHT.toFixed(2)} | tvaCat=${l.tvaCat}`, c.gray));
      }
    }
  }

  log('');
  log(`${c.bold}Résumé :${c.reset} ${c.g}${ok} OK${c.reset}, ${c.r}${ko} KO${c.reset}, ${c.y}${skip} SKIP${c.reset}`);

  if (ko === 0) {
    log(`\n✓ PARITÉ CONFIRMÉE — moteur libre reproduit le moteur legacy à ${TOL}€ près.\n`, c.g);
    process.exit(0);
  } else {
    log(`\n✗ ${ko} divergence(s) détectée(s).\n`, c.r);
    process.exit(1);
  }
}

main().catch(e => {
  log(`✗ Erreur inattendue : ${e.message}`, c.r);
  console.error(e);
  process.exit(2);
});
