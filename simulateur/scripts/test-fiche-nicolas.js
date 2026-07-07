#!/usr/bin/env node
/**
 * Test de non-régression : la fiche "Nicolas" doit toujours retourner
 * exactement 5 775,00 € HT et 115,50 € HT/pers.
 *
 * À lancer avant chaque commit qui touche calcul.js, formules, types
 * internes, paliers, ou tout ce qui impacte le pricing.
 *
 * Usage :
 *   node scripts/test-fiche-nicolas.js
 *   node scripts/test-fiche-nicolas.js --api https://ton-site.netlify.app --code PALACE2026
 *
 * Codes de sortie :
 *   0 = OK (benchmark respecté)
 *   1 = ÉCHEC de régression (les chiffres ont bougé)
 *   2 = erreur d'infra (login, réseau, fiche introuvable...)
 */

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const API = argValue('--api', 'http://localhost:8888');
const CODE = argValue('--code', process.env.PALACE_ACCESS_CODE || 'PALACE2026');
const NOM = argValue('--nom', 'Nicolas');
const EXPECTED_HT = 5775.00;
const EXPECTED_PPP = 115.50;
const TOLERANCE = 0.01;

const c = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m' };
const log = (msg, color) => console.log((color || '') + msg + c.reset);

async function main() {
  log(`\n${c.bold}=== Test de non-régression fiche Nicolas ===${c.reset}`, c.b);
  log(`API      : ${API}`);
  log(`Utilisateur : ${NOM}`);
  log(`Attendu  : ${EXPECTED_HT.toFixed(2)} € HT / ${EXPECTED_PPP.toFixed(2)} €/pers\n`);

  // 1. Login
  let cookie = '';
  try {
    const r = await fetch(`${API}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE, nom: NOM })
    });
    if (!r.ok) throw new Error(`login failed: HTTP ${r.status}`);
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    if (!cookie) throw new Error('no session cookie returned');
    log('✓ Login OK', c.g);
  } catch (e) {
    log(`✗ Login échoué : ${e.message}`, c.r);
    process.exit(2);
  }

  // 2. Trouver la fiche Nicolas
  let ficheId = null;
  try {
    const r = await fetch(`${API}/api/fiches`, { headers: { cookie } });
    if (!r.ok) throw new Error(`list fiches: HTTP ${r.status}`);
    const list = await r.json();
    const nicolas = list.find(f =>
      (f.nomFiche || '').toLowerCase().includes('nicolas') ||
      (f.client || '').toLowerCase().includes('nicolas')
    );
    if (!nicolas) throw new Error(`aucune fiche avec "nicolas" trouvée (${list.length} fiches au total)`);
    ficheId = nicolas.id;
    log(`✓ Fiche Nicolas trouvée : ${ficheId} (${nicolas.nomFiche || '(sans nom)'})`, c.g);
  } catch (e) {
    log(`✗ Recherche fiche : ${e.message}`, c.r);
    process.exit(2);
  }

  // 3. Récupérer resultsSnapshot
  try {
    const r = await fetch(`${API}/api/fiches/${encodeURIComponent(ficheId)}`, { headers: { cookie } });
    if (!r.ok) throw new Error(`get fiche: HTTP ${r.status}`);
    const fiche = await r.json();
    const snap = fiche.resultsSnapshot || {};
    const totalHT = snap.totalHT;
    const prixPers = snap.prixPers;

    if (typeof totalHT !== 'number' || typeof prixPers !== 'number') {
      log(`⚠ resultsSnapshot manquant. Ouvre la fiche dans le simulateur puis re-sauvegarde.`, c.y);
      log(`  Contenu snapshot : ${JSON.stringify(snap)}`, c.y);
      process.exit(2);
    }

    log(`\n${c.bold}Résultat :${c.reset}`);
    log(`  Total HT        : ${totalHT.toFixed(2)} €  (attendu ${EXPECTED_HT.toFixed(2)} €)`);
    log(`  Prix HT / pers  : ${prixPers.toFixed(2)} €  (attendu ${EXPECTED_PPP.toFixed(2)} €)`);

    const diffHT = Math.abs(totalHT - EXPECTED_HT);
    const diffPPP = Math.abs(prixPers - EXPECTED_PPP);

    if (diffHT <= TOLERANCE && diffPPP <= TOLERANCE) {
      log(`\n✓ BENCHMARK OK — aucune régression détectée.\n`, c.g);
      process.exit(0);
    } else {
      log(`\n✗ RÉGRESSION DÉTECTÉE`, c.r);
      log(`  Delta Total HT   : ${(totalHT - EXPECTED_HT).toFixed(2)} €`, c.r);
      log(`  Delta Prix/pers  : ${(prixPers - EXPECTED_PPP).toFixed(2)} €\n`, c.r);
      process.exit(1);
    }
  } catch (e) {
    log(`✗ Récupération fiche : ${e.message}`, c.r);
    process.exit(2);
  }
}

main().catch(e => {
  log(`✗ Erreur inattendue : ${e.message}`, c.r);
  process.exit(2);
});
