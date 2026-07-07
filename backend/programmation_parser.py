"""
Parser Python du PDF de programmation artistique mensuelle (Palace Comedy).

C'est le pendant Python de netlify/lib/parse-programmation.js. La logique
est identique — la seule différence est que pdfplumber renvoie déjà des
tableaux de cellules (au lieu de texte tab-séparé pour pdf-parse Node).

Utilisation :
    from programmation_parser import parse_programmation_pdf
    result, log = parse_programmation_pdf(pdf_bytes)
    # result = { "YYYY-MM-DD": { "artistes": [...], "creneaux": [...], "notes": "..." } }
"""
from __future__ import annotations

import base64
import io
import re
from typing import Any

import pdfplumber

DATE_RE = re.compile(r'(\d{2})/(\d{2})/(\d{4})')
HEURE_RE = re.compile(r'^\d{1,2}h\d{0,2}$')
OUINON_RE = re.compile(r'^(OUI|NON)$', re.IGNORECASE)
END_MARKER_RE = re.compile(r'TAUX\s+DE\s+REMPLISSAGE\s+MOYEN', re.IGNORECASE)
IGNORE_LINE_RE = re.compile(
    r'^(taux\s+de\s+remplissage|TAUX\s+DE\s+REMPLISSAGE|TOTAL\s+MOIS|MC\s+VIOLET|BLEU\s+PLATEAU|ROUGE\s+SPECTACLE|VERT\s+OFF|GRIS\s+FONC)',
    re.IGNORECASE,
)
JOUR_HEADERS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']


def _flat_cells(row: list) -> list[str]:
    """Convertit une ligne pdfplumber (avec None/empty) en liste de cellules non-vides."""
    out: list[str] = []
    for c in row:
        if c is None:
            continue
        s = str(c).strip()
        if s:
            # Une cellule pdfplumber peut contenir plusieurs lignes (\n) — on
            # les traite comme cellules distinctes pour matcher la logique JS
            # qui splitte sur \n.
            for part in s.split('\n'):
                part = part.strip()
                if part:
                    out.append(part)
    return out


def _is_jour_header_row(cells: list[str]) -> bool:
    matched = sum(1 for c in cells if c in JOUR_HEADERS)
    return matched >= 3


def _extract_dates_from_row(cells: list[str]) -> list[dict]:
    dates = []
    for c in cells:
        m = DATE_RE.search(c)
        if m:
            dates.append({'iso': f'{m.group(3)}-{m.group(2)}-{m.group(1)}', 'raw': m.group(0)})
    return dates


def _extract_horaires_per_day(cells: list[str]) -> list[list[str]]:
    """Cellules du row horaires : Artiste 🏠 H1 H2 Artiste 🏠 H1 H2 …
    Retourne [ [h1,h2], [h1,h2], … ] (un sous-tableau par jour).
    """
    per_day: list[list[str]] = []
    current: list[str] | None = None
    for cell in cells:
        cell = cell.strip()
        if cell == 'Artiste':
            if current is not None:
                per_day.append(current)
            current = []
        elif current is not None:
            if HEURE_RE.match(cell):
                current.append(cell)
    if current is not None:
        per_day.append(current)
    return per_day


def _extract_artistes_per_day(cells: list[str]) -> list[str | None]:
    """Retourne 1 nom (ou None si vide) par jour.
    OUI/NON ferme la cellule d'un jour. Le dernier texte non-parasite avant est le nom.
    """
    per_day: list[str | None] = []
    current: str | None = None
    for cell in cells:
        cell = cell.strip()
        if cell == '':
            continue
        if OUINON_RE.match(cell):
            per_day.append(current)
            current = None
            continue
        # Filtres : tokens parasites qui ne sont pas des noms
        if HEURE_RE.match(cell):
            continue
        if re.match(r'^\d+([,.]\d+)?\s*%$', cell):
            continue
        if re.match(r'^-{2,}\s*\d+\s*of\s*\d+\s*-{2,}$', cell, re.IGNORECASE):
            continue
        current = cell
    if current is not None:
        per_day.append(current)
    return per_day


def _extract_notes_per_day(cells: list[str]) -> list[str]:
    per_day = []
    for cell in cells:
        cell = cell.strip()
        if not re.match(r'^Notes\s*:', cell):
            continue
        after = re.sub(r'^Notes\s*:\s*', '', cell).strip()
        per_day.append(after)
    return per_day


def parse_programmation_pdf(pdf_bytes: bytes) -> tuple[dict, list[str]]:
    log: list[str] = []
    log.append(f'PDF reçu : {len(pdf_bytes)} bytes')

    # === Extraction pdfplumber → structure tabulaire ===
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        log.append(f'PDF pages : {len(pdf.pages)}')
        all_rows: list[list[str]] = []
        for pi, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            for ti, table in enumerate(tables):
                for row in table:
                    cells = _flat_cells(row)
                    all_rows.append(cells)
        log.append(f'Lignes utiles extraites : {len(all_rows)}')

    # === Anomalie 1 — troncature après le marqueur ===
    end_idx = -1
    for i, cells in enumerate(all_rows):
        joined = ' '.join(cells)
        if END_MARKER_RE.search(joined):
            end_idx = i
            break
    if end_idx >= 0:
        log.append(f'✂ Tronqué à la ligne {end_idx} (marqueur "TAUX DE REMPLISSAGE MOYEN")')
        all_rows = all_rows[:end_idx]

    # === Boucle principale — repérage row dates ===
    result: dict[str, dict[str, Any]] = {}
    i = 0
    while i < len(all_rows):
        cells = all_rows[i]
        dates = _extract_dates_from_row(cells)
        if not dates:
            i += 1
            continue

        log.append(f'══ Semaine {" | ".join(d["iso"] for d in dates)} (ligne {i + 1})')

        horaires_per_day: list[list[str]] = []
        artistes_per_day: list[list[str]] = [[] for _ in dates]
        notes_per_day: list[str] = ['' for _ in dates]
        found_horaires = False

        i += 1
        while i < len(all_rows):
            cur = all_rows[i]

            cur_dates = _extract_dates_from_row(cur)
            if cur_dates:
                break
            if _is_jour_header_row(cur):
                i += 1
                break

            joined = ' '.join(cur).strip()
            if joined and IGNORE_LINE_RE.match(joined):
                i += 1
                continue

            # Row horaires
            if not found_horaires and any(c.strip() == 'Artiste' for c in cur):
                horaires_per_day = _extract_horaires_per_day(cur)
                log.append('  Horaires : ' + ' · '.join(
                    f'{dates[j]["iso"] if j < len(dates) else "?"}=[{",".join(h)}]'
                    for j, h in enumerate(horaires_per_day)
                ))
                found_horaires = True
                i += 1
                continue

            # Row Notes :
            if any(re.match(r'^Notes\s*:', c.strip()) for c in cur):
                notes = _extract_notes_per_day(cur)
                for j, n in enumerate(notes):
                    if j < len(notes_per_day) and n:
                        notes_per_day[j] = n
                log.append('  Notes (inline) : ' + ' · '.join(
                    f'{dates[j]["iso"]}="{n}"' for j, n in enumerate(notes_per_day)
                ))
                i += 1
                continue

            # Garde : un vrai row d'artistes contient au moins un OUI/NON
            if not any(OUINON_RE.match(c.strip()) for c in cur):
                if joined:
                    log.append(f'  ↪ ligne orpheline ignorée : "{joined[:80]}"')
                i += 1
                continue

            artistes_row = _extract_artistes_per_day(cur)
            for j, name in enumerate(artistes_row):
                if j < len(artistes_per_day) and name:
                    artistes_per_day[j].append(name)
            i += 1

        # === Composer les résultats jour par jour ===
        for j, d in enumerate(dates):
            horaires = horaires_per_day[j] if j < len(horaires_per_day) else []
            # Dédup artistes
            seen: set[str] = set()
            artistes_dedup: list[str] = []
            for a in artistes_per_day[j]:
                k = a.upper()
                if k in seen:
                    continue
                seen.add(k)
                artistes_dedup.append(a)
            notes = notes_per_day[j] or ''

            if not horaires and not artistes_dedup and not notes:
                log.append(f'  ∅ {d["iso"]} : aucun contenu')
                continue

            if d['iso'] not in result:
                result[d['iso']] = {'artistes': artistes_dedup, 'creneaux': horaires, 'notes': notes}
            else:
                cur = result[d['iso']]
                seen_cur = {a.upper() for a in cur['artistes']}
                for a in artistes_dedup:
                    if a.upper() not in seen_cur:
                        cur['artistes'].append(a)
                seen_h = set(cur['creneaux'])
                for h in horaires:
                    if h not in seen_h:
                        cur['creneaux'].append(h)
                if notes and notes not in cur['notes']:
                    cur['notes'] = f'{cur["notes"]} {notes}' if cur['notes'] else notes

            log.append(
                f'  ✓ {d["iso"]} : {len(horaires)} créneau(x), {len(artistes_dedup)} artiste(s)'
                + (f', notes="{notes}"' if notes else '')
            )

    log.append(f'══ Parsing terminé : {len(result)} dates avec créneaux')
    return result, log


def parse_from_base64(pdf_b64: str) -> tuple[dict, list[str]]:
    """Wrapper : décode le base64 puis parse."""
    # Retirer un éventuel préfixe data:application/pdf;base64,
    if ',' in pdf_b64 and pdf_b64.startswith('data:'):
        pdf_b64 = pdf_b64.split(',', 1)[1]
    pdf_bytes = base64.b64decode(pdf_b64)
    return parse_programmation_pdf(pdf_bytes)
