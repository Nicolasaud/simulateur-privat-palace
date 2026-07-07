// Parser de PDF de programmation artistique mensuelle (Palace Comedy).
//
// LE FORMAT DU PDF
// Le document est un tableau hebdomadaire à 7 colonnes (Lundi → Dimanche).
// pdf-parse extrait chaque ligne du tableau en une ligne texte, les colonnes
// étant séparées par des TABULATIONS. Une semaine = bloc de plusieurs lignes :
//
//   Lundi \t Mardi \t … \t Dimanche                       ← entête (optionnel)
//   01/05/2026 \t 02/05/2026 \t 03/05/2026               ← row dates
//   Artiste \t 🏠 \t 19h \t 21h \t Artiste \t 🏠 \t …    ← row horaires
//   MATT MORANE \t OUI \t FRED BAZILE \t OUI \t …        ← 1er artiste par jour
//   <vide> \t YANN PEDILUVE \t OUI \t Aurélien \t OUI    ← 2e artiste, etc.
//   …
//   Notes : \t Notes : \t Notes :                         ← row notes
//   IMPRO                                                 ← note multi-ligne
//   Taux de remplissage/séance \t 100% \t …               ← à ignorer
//
// MAPPING COLONNE → JOUR (subtil)
// - Row dates : 1 cellule = 1 jour
// - Row horaires : "Artiste 🏠 H1 H2 …" = chaque jour occupe (2 + nbHoraires) cellules
// - Rows artistes : chaque jour occupe 1 ou 2 cellules :
//     * 2 si artiste présent : [nom, OUI|NON]
//     * 1 si artiste absent   : [OUI|NON]
//   → Le marqueur OUI/NON FERME la cellule d'un jour. C'est notre pivot.
//
// SORTIE
// { "YYYY-MM-DD": { artistes: [...], creneaux: [...], notes: "..." } }
// Les artistes jouent sur tous les créneaux du jour (modèle simplifié).

const DATE_RE = /(\d{2})\/(\d{2})\/(\d{4})/g;
const HEURE_RE = /^\d{1,2}h\d{0,2}$/;
const OUINON_RE = /^(OUI|NON)$/i;
// Marqueur de FIN de la programmation : début du tableau récap mensuel des
// taux de remplissage. Tout ce qui suit est re-parsé par erreur sinon.
const END_MARKER_RE = /TAUX\s+DE\s+REMPLISSAGE\s+MOYEN/i;

// Lignes à ignorer (entêtes, totaux, etc.)
const IGNORE_LINE_RE = /^(taux\s+de\s+remplissage|TAUX\s+DE\s+REMPLISSAGE|TOTAL\s+MOIS|MC\s+VIOLET|BLEU\s+PLATEAU|ROUGE\s+SPECTACLE|VERT\s+OFF|GRIS\s+FONC)/i;

const JOUR_HEADERS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function isJourHeaderRow(cells) {
  // Une ligne avec au moins 3 noms de jours
  const matched = cells.filter(c => JOUR_HEADERS.includes(c.trim())).length;
  return matched >= 3;
}

function extractDatesFromRow(cells) {
  // Pour chaque cellule, voir si elle contient une date DD/MM/YYYY
  const dates = [];
  for (const c of cells) {
    const m = c.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) dates.push({ iso: `${m[3]}-${m[2]}-${m[1]}`, raw: m[0] });
  }
  return dates;
}

// Pour la ligne d'horaires : extraire la liste des horaires par jour.
// Format : ["Artiste", "🏠", "H1", "H2", "Artiste", "🏠", "H1", ...]
// Retourne : [ [h1,h2], [h1,h2], [h1,h2] ] (un sous-tableau par jour)
function extractHorairesPerDay(cells) {
  const perDay = [];
  let currentDay = null;
  for (const cellRaw of cells) {
    const cell = (cellRaw || '').trim();
    if (cell === 'Artiste') {
      if (currentDay !== null) perDay.push(currentDay);
      currentDay = [];
    } else if (currentDay !== null) {
      if (HEURE_RE.test(cell)) currentDay.push(cell);
      // Sinon (🏠, vide, autre) → on ignore
    }
  }
  if (currentDay !== null) perDay.push(currentDay);
  return perDay;
}

// Pour une ligne d'artistes : retourne 1 nom (ou null si vide) PAR JOUR.
// La règle : OUI/NON ferme la cellule d'un jour. Tout token texte précédent
// non-vide est le nom potentiel pour ce jour.
// Filtres : on rejette les tokens qui sont en fait des horaires (\d+h\d*),
// des "%" / pourcentages parasites, ou des marqueurs PDF (-- N of N --).
function extractArtistesPerDay(cells) {
  const perDay = [];
  let currentArtist = null;
  for (const cellRaw of cells) {
    const cell = (cellRaw || '').trim();
    if (cell === '') continue;
    if (OUINON_RE.test(cell)) {
      perDay.push(currentArtist);
      currentArtist = null;
      continue;
    }
    // Filtres : tokens parasites qui ne sont pas des noms
    if (HEURE_RE.test(cell)) continue;             // "22h", "21h30"…
    if (/^\d+([,.]\d+)?\s*%$/.test(cell)) continue; // "42%", "100,00%"
    if (/^-{2,}\s*\d+\s*of\s*\d+\s*-{2,}$/i.test(cell)) continue; // "-- 1 of 1 --"
    // Candidat nom (on accepte mixed case pour ne pas perdre "Aurélien Daunay")
    currentArtist = cell;
  }
  // Si un nom n'est pas clôturé en fin de ligne (cas rare), on l'ajoute quand même
  if (currentArtist !== null) perDay.push(currentArtist);
  return perDay;
}

// Pour le row "Notes :" — extrait UNIQUEMENT le contenu inline d'une cellule
// de type "Notes : <texte>".
//
// On NE TENTE PAS d'attribuer le contenu d'une cellule intermédiaire à un jour :
// la mise en page PDF est trop ambiguë (le contenu peut appartenir au jour
// précédent ou au jour suivant, et certains cellules "Notes :" peuvent
// absorber plusieurs colonnes d'un coup). Plutôt ignorer que mal attribuer.
//
// Les notes multilignes (ex: samedi 09/05 avec "Alicia / Juloze / Chloé"
// répartis sur 2 lignes) ne sont PAS capturées en Phase 2a — sera ajouté
// en Phase 2b avec une heuristique plus fiable basée sur l'alignement
// colonne/cellule.
function extractNotesPerDay(cells) {
  const perDay = [];
  for (const cellRaw of cells) {
    const cell = (cellRaw || '').trim();
    if (!/^Notes\s*:/.test(cell)) continue;
    const after = cell.replace(/^Notes\s*:\s*/, '').trim();
    perDay.push(after); // peut être '' si juste "Notes :"
  }
  return perDay;
}

export function parseProgrammation(rawText) {
  const log = [];
  log.push(`Text length : ${rawText.length} chars`);

  // Anomalie 1 — tronquer AVANT le tableau récap mensuel pour éviter le
  // re-parsing fantôme (TAUX DE REMPLISSAGE MOYEN / JOUR + footer pagination).
  const endIdx = rawText.search(END_MARKER_RE);
  let working = rawText;
  if (endIdx >= 0) {
    log.push(`✂ Texte tronqué à l'index ${endIdx} (marqueur "TAUX DE REMPLISSAGE MOYEN")`);
    working = rawText.slice(0, endIdx);
  }

  // Split en lignes — pdf-parse utilise \n
  const lines = working.split('\n').map(l => l.replace(/\r$/, ''));
  log.push(`${lines.length} lignes utiles\n`);

  const result = {};

  // On parcourt les lignes en repérant les "row dates" (les pivots de semaine).
  // À partir d'un row dates, on consomme les lignes suivantes jusqu'au prochain
  // row dates / Lundi-header / fin du document.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const cells = line.split('\t');

    const dates = extractDatesFromRow(cells);
    if (dates.length === 0) {
      i++;
      continue;
    }

    log.push(`\n══ Semaine ${dates.map(d => d.iso).join(' | ')} (ligne ${i + 1})`);

    // Consomme les lignes de cette semaine
    let horairesPerDay = [];
    const artistesPerDay = dates.map(() => []); // tableau de listes
    let notesPerDay = dates.map(() => '');
    let foundHorairesRow = false;

    i++;
    while (i < lines.length) {
      const cur = lines[i];
      const curCells = cur.split('\t');

      // Stop si on rencontre une nouvelle semaine (row dates) ou un row jour-headers
      const curDates = extractDatesFromRow(curCells);
      if (curDates.length > 0) break;
      if (isJourHeaderRow(curCells)) { i++; break; } // header → on saute et on stop

      // Ligne à ignorer
      const trimmedJoined = cur.trim();
      if (IGNORE_LINE_RE.test(trimmedJoined)) {
        i++;
        continue;
      }

      // Row horaires : contient "Artiste"
      if (!foundHorairesRow && curCells.some(c => c.trim() === 'Artiste')) {
        horairesPerDay = extractHorairesPerDay(curCells);
        log.push(`  Horaires : ${horairesPerDay.map((h, j) => `${dates[j]?.iso || '?'}=[${h.join(',')}]`).join(' · ')}`);
        foundHorairesRow = true;
        i++;
        continue;
      }

      // Row Notes : (anomalie 2 — version simplifiée, on ne capture que l'inline)
      if (curCells.some(c => /^Notes\s*:/.test(c.trim()))) {
        const notes = extractNotesPerDay(curCells);
        notes.forEach((n, j) => { if (j < notesPerDay.length && n) notesPerDay[j] = n; });
        log.push(`  Notes (inline only) : [${notesPerDay.map((n, j) => `${dates[j].iso}="${n}"`).join(' · ')}]`);
        i++;
        continue;
      }

      // Garde : un VRAI row d'artistes contient toujours au moins un OUI/NON
      // (marqueur de fin de cellule de jour). Si aucun, c'est une note
      // orpheline (suite multiligne) ou une ligne parasite. Ex : "IMPRO",
      // "Chloé	" (avec tab final).
      if (!curCells.some(c => OUINON_RE.test(c.trim()))) {
        if (cur.trim()) log.push(`  ↪ ligne orpheline ignorée : "${cur.trim()}"`);
        i++;
        continue;
      }

      // Row d'artistes (par défaut, si on est dans la semaine et que rien d'autre)
      const artistesRow = extractArtistesPerDay(curCells);
      if (artistesRow.length > 0) {
        artistesRow.forEach((name, j) => {
          if (j < artistesPerDay.length && name) {
            artistesPerDay[j].push(name);
          }
        });
      }
      i++;
    }

    // Composer la fiche jour pour chaque date de la semaine (nouveau modèle :
    // artistes au niveau jour, créneaux = liste plate des horaires).
    dates.forEach((d, j) => {
      const horaires = horairesPerDay[j] || [];
      // Dédup artistes (préserve l'ordre d'apparition)
      const seen = new Set();
      const artistesDedup = [];
      for (const a of (artistesPerDay[j] || [])) {
        const k = a.toUpperCase();
        if (seen.has(k)) continue;
        seen.add(k);
        artistesDedup.push(a);
      }
      const notes = notesPerDay[j] || '';

      // Skip si jour totalement vide
      if (horaires.length === 0 && artistesDedup.length === 0 && !notes) {
        log.push(`  ∅ ${d.iso} : aucun contenu`);
        return;
      }

      // Fusion si la date apparaît plusieurs fois dans le PDF (récap fantôme,
      // double passage…). Improbable en pratique mais on accumule proprement.
      if (!result[d.iso]) {
        result[d.iso] = { artistes: artistesDedup, creneaux: horaires, notes };
      } else {
        const cur = result[d.iso];
        const seenCur = new Set(cur.artistes.map(a => a.toUpperCase()));
        artistesDedup.forEach(a => {
          if (!seenCur.has(a.toUpperCase())) cur.artistes.push(a);
        });
        const seenH = new Set(cur.creneaux);
        horaires.forEach(h => { if (!seenH.has(h)) cur.creneaux.push(h); });
        if (notes && !cur.notes.includes(notes)) {
          cur.notes = cur.notes ? `${cur.notes} ${notes}` : notes;
        }
      }
      log.push(`  ✓ ${d.iso} : ${horaires.length} créneau(x), ${artistesDedup.length} artiste(s)${notes ? ', notes="' + notes + '"' : ''}`);
    });
  }

  log.push(`\n══ Parsing terminé : ${Object.keys(result).length} dates avec créneaux`);
  return { result, log };
}
