#!/usr/bin/env node
// Génère le hash scrypt d'un code d'accès pour le coller dans .env (ACCESS_CODE_HASH).
//
// Usage :
//   node scripts/hash-code.js "MonCodePartagé"
//   node scripts/hash-code.js                 ← demande le code en interactif
//
// La sortie est une seule ligne prête à coller après ACCESS_CODE_HASH=.
// Le code en clair n'est jamais écrit sur disque par ce script.

import { hashAccessCode } from '../netlify/lib/access-code.js';
import readline from 'node:readline';

async function getCode() {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr // questions sur stderr pour ne pas polluer stdout
  });
  return new Promise(resolve => {
    rl.question('Code d\'accès à hasher : ', code => {
      rl.close();
      resolve(code);
    });
  });
}

const code = (await getCode()).trim();
if (!code) {
  console.error('Code vide, abandon.');
  process.exit(1);
}
if (code.length < 6) {
  console.error('Code trop court (6 caractères min recommandés).');
  process.exit(1);
}

const hash = hashAccessCode(code);
// stdout = juste le hash, pour permettre `node scripts/hash-code.js code >> .env`
console.log(hash);
console.error('\n✓ Hash généré. Copie-colle la ligne ci-dessus dans .env après ACCESS_CODE_HASH=');
