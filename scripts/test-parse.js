#!/usr/bin/env node
// Test local du parser PDF de programmation, sans passer par la function.
//
// USAGE
//   node scripts/test-parse.js <chemin/vers/le/pdf.pdf>
//
// Affiche :
//   - Stats brutes (chars extraits par pdf-parse)
//   - Log de parsing détaillé
//   - JSON final structuré par date

import { readFile } from 'node:fs/promises';
import { parseProgrammation } from '../netlify/lib/parse-programmation.js';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('❌ Usage : node scripts/test-parse.js <chemin/vers/le/pdf.pdf>');
  process.exit(1);
}

(async () => {
  console.log(`📄 Lecture du PDF : ${pdfPath}\n`);
  const buffer = await readFile(pdfPath);
  console.log(`   Taille buffer : ${buffer.length} octets\n`);

  console.log('⚙️  Extraction texte via pdf-parse…');
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const pdfData = await parser.getText();
  await parser.destroy?.();
  console.log(`   ${pdfData.total ?? '?'} pages, ${pdfData.text.length} chars extraits\n`);

  console.log('─'.repeat(70));
  console.log('TEXTE BRUT (premiers 2000 chars) :');
  console.log('─'.repeat(70));
  console.log(pdfData.text.slice(0, 2000));
  console.log('─'.repeat(70));

  console.log('\n⚙️  Parsing structurel…\n');
  const { result, log } = parseProgrammation(pdfData.text);

  console.log('─'.repeat(70));
  console.log('LOG DE PARSING :');
  console.log('─'.repeat(70));
  log.forEach(line => console.log(line));

  console.log('\n' + '═'.repeat(70));
  console.log('JSON RÉSULTAT :');
  console.log('═'.repeat(70));
  console.log(JSON.stringify(result, null, 2));

  console.log('\n' + '─'.repeat(70));
  console.log('RÉSUMÉ :');
  console.log('─'.repeat(70));
  const dates = Object.keys(result).sort();
  console.log(`Total dates avec créneaux : ${dates.length}`);
  dates.forEach(d => {
    const creneaux = result[d];
    const totalArtistes = creneaux.reduce((s, c) => s + c.artistes.length, 0);
    console.log(`  ${d} : ${creneaux.length} créneau(x), ${totalArtistes} artiste(s)${creneaux.some(c => c.notes) ? ' [+ notes]' : ''}`);
  });
})().catch(e => {
  console.error('❌ Erreur :', e.message);
  console.error(e.stack);
  process.exit(1);
});
