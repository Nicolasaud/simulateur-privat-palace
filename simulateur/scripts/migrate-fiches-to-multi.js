#!/usr/bin/env node
// Migration cloud : convertit toutes les fiches mono-formule (legacy)
// vers le format multi-formules pur (config.formules[]).
//
// USAGE (depuis la racine du repo) :
//   # 1. Dry-run contre dev local (lecture seule, log ce qui serait migré)
//   COOKIE='palace_session=...' node scripts/migrate-fiches-to-multi.js --dry-run
//
//   # 2. Migration effective contre dev local
//   COOKIE='palace_session=...' node scripts/migrate-fiches-to-multi.js --write
//
//   # 3. Contre prod
//   BASE_URL=https://votre-site.netlify.app COOKIE='palace_session=...' \
//     node scripts/migrate-fiches-to-multi.js --write
//
// PRINCIPE
// - GET /api/fiches → liste des fiches (index léger)
// - Pour chaque fiche : GET /api/fiches/:id
// - Si elle a déjà config.formules valide → SKIP (idempotent)
// - Sinon → construit config.formules[0] depuis les champs racine legacy
//   (formuleId, format, nbPers, items, formuleType, snapshot, overrides)
//   et PUT la fiche au nouveau format (sans champs legacy au niveau config).
// - Les champs partagés (day, periodeOverride, vueClient, fondreFraisResa,
//   forfaitLibelle, forfaitSousLibelle) sont conservés.
//
// SÉCURITÉ
// - --dry-run par défaut : aucun PUT n'est envoyé
// - --write requis pour effectivement migrer
// - Compteurs détaillés à la fin (scannées / migrées / déjà au nouveau format / erreurs)

const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';
const COOKIE = process.env.COOKIE || '';
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const DRY = !WRITE; // par défaut on est en dry-run

if (!COOKIE) {
  console.error('❌ COOKIE manquant. Usage : COOKIE="palace_session=..." node scripts/migrate-fiches-to-multi.js [--dry-run|--write]');
  process.exit(1);
}

function newBlocId() {
  return 'bloc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// Construit un bloc unique depuis les champs legacy racine d'une fiche.
function buildBlocFromLegacyConfig(config) {
  return {
    blocId: newBlocId(),
    formuleId: config.formuleId || null,
    typeId: config.format || 'privat-full',
    nbPers: Math.max(1, parseInt(config.nbPers) || 50),
    items: Array.isArray(config.items) ? JSON.parse(JSON.stringify(config.items)) : [],
    overrides: (config.overrides && typeof config.overrides === 'object') ? { ...config.overrides } : {},
    snapshot: config.snapshot || null,
    formuleType: config.formuleType || 'custom'
  };
}

// Nettoie une config : ne garde que les champs autorisés post-cleanup radical.
function cleanConfig(config) {
  const out = {};
  // Champs partagés (PAS legacy)
  ['day', 'periodeOverride', 'vueClient', 'fondreFraisResa', 'forfaitLibelle', 'forfaitSousLibelle'].forEach(k => {
    if (k in config) out[k] = config[k];
  });
  // Source de vérité multi-formules
  if (Array.isArray(config.formules) && config.formules.length > 0) {
    out.formules = config.formules;
  }
  return out;
}

async function apiGet(path) {
  const r = await fetch(BASE_URL + path, {
    headers: { Cookie: COOKIE },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${r.statusText}`);
  return r.json();
}

async function apiPut(path, body) {
  const r = await fetch(BASE_URL + path, {
    method: 'PUT',
    headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`PUT ${path} → ${r.status} ${r.statusText} ${text}`);
  }
  return r.json();
}

async function main() {
  console.log(`Migration cloud fiches mono → multi`);
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Mode     : ${DRY ? 'DRY-RUN (lecture seule)' : 'WRITE (migration effective)'}`);
  console.log('─'.repeat(60));

  const index = await apiGet('/api/fiches');
  console.log(`📋 ${index.length} fiche(s) dans l'index\n`);

  const counters = {
    scanned: 0,
    alreadyMulti: 0,
    needMigration: 0,
    migrated: 0,
    cleanupOnly: 0, // a déjà formules mais a aussi des champs legacy à retirer
    errors: 0
  };

  for (const entry of index) {
    counters.scanned++;
    const label = `${entry.client || entry.nomFiche || '?'} (${entry.id})`;
    let fiche;
    try {
      fiche = await apiGet(`/api/fiches/${encodeURIComponent(entry.id)}`);
    } catch (e) {
      console.error(`  ❌ ${label} — GET échoué : ${e.message}`);
      counters.errors++;
      continue;
    }

    const config = fiche.config || {};
    const hasMulti = Array.isArray(config.formules) && config.formules.length > 0;
    const hasLegacyRoot = ['format', 'nbPers', 'formuleType', 'formuleId', 'items', 'snapshot', 'overrides']
      .some(k => k in config);

    if (hasMulti && !hasLegacyRoot) {
      counters.alreadyMulti++;
      console.log(`  ✓ déjà migré : ${label}`);
      continue;
    }

    // Construire le nouveau config nettoyé
    let formules;
    if (hasMulti) {
      formules = config.formules;
      counters.cleanupOnly++;
    } else {
      formules = [buildBlocFromLegacyConfig(config)];
      counters.needMigration++;
    }

    const cleaned = cleanConfig({ ...config, formules });
    const newFiche = { ...fiche, config: cleaned };

    const action = hasMulti ? 'cleanup legacy fields' : 'mono→multi';
    if (DRY) {
      console.log(`  → ${label} : ${action} [DRY]`);
      console.log(`      avant config keys: ${Object.keys(config).sort().join(', ')}`);
      console.log(`      après config keys: ${Object.keys(cleaned).sort().join(', ')}`);
      if (!hasMulti) {
        console.log(`      bloc construit: typeId=${formules[0].typeId} nbPers=${formules[0].nbPers} items=${formules[0].items.length}`);
      }
    } else {
      try {
        await apiPut(`/api/fiches/${encodeURIComponent(entry.id)}`, newFiche);
        counters.migrated++;
        console.log(`  ✓ ${label} : ${action} ÉCRIT`);
      } catch (e) {
        console.error(`  ❌ ${label} — PUT échoué : ${e.message}`);
        counters.errors++;
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Résumé :');
  console.log(`  Fiches scannées            : ${counters.scanned}`);
  console.log(`  Déjà au nouveau format pur : ${counters.alreadyMulti}`);
  console.log(`  À migrer (mono → multi)    : ${counters.needMigration}`);
  console.log(`  À cleanup (multi + legacy) : ${counters.cleanupOnly}`);
  if (!DRY) {
    console.log(`  ✓ Migrées avec succès      : ${counters.migrated}`);
  }
  console.log(`  ❌ Erreurs                  : ${counters.errors}`);
  if (DRY) {
    console.log('\n🔍 DRY-RUN : aucun PUT envoyé. Pour migrer effectivement :');
    console.log(`   COOKIE='${COOKIE.slice(0, 30)}...' node scripts/migrate-fiches-to-multi.js --write`);
  }
}

main().catch(e => {
  console.error('❌ Erreur fatale :', e.message);
  process.exit(1);
});
