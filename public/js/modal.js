// Modal aperçu d'une fiche (depuis le calendrier).
// openFicheModal / openDayModal sont async : on récupère la fiche complète
// via /api/fiches/:id avant d'afficher.

import { $, fmt, fmtPct } from './helpers.js';
import { state } from './state.js';
import { formatHasSpectacle, loadFiche } from './fiches.js';
import { switchTab } from './onglets.js';
import { getFiche } from './api.js';
import { showToast } from './ui-feedback.js';
import { ensureMonthLoaded, getJour } from './programmation.js';

export function formatLabel(format) {
  const labels = {
    'privat-full': 'Privatisation show + repas',
    'privat-salle': 'Privatisation sans show',
    'atelier-cocktail': 'Atelier cocktail',
    'formation-impro': 'Formation impro / team building',
    'groupe-classique': 'Groupe sur Palace classique'
  };
  return labels[format] || format;
}

// Récupère les blocs d'une fiche (multi-formules) avec fallback legacy mono.
function getBlocs(f) {
  const blocs = f.config?.formules;
  if (Array.isArray(blocs) && blocs.length > 0) return blocs;
  // Fallback : fiche mono pré-migration → reconstruit un bloc unique
  if (f.config?.format || f.config?.nbPers) {
    return [{
      typeId: f.config.format,
      nbPers: f.config.nbPers,
      formuleId: f.config.formuleId
    }];
  }
  return [];
}

export async function openFicheModal(id) {
  let f;
  try {
    f = await getFiche(id);
  } catch (e) {
    if (e.status === 404) {
      showToast('Cette fiche a déjà été supprimée par un autre utilisateur.', 'error');
      state.fichesList = state.fichesList.filter(x => x.id !== id);
      return;
    }
    showToast(`Erreur de chargement : ${e.message}`, 'error');
    return;
  }
  const statutLabels = { brouillon: 'Brouillon', envoye: 'Devis envoyé', accepte: 'Accepté', refuse: 'Refusé' };
  const dateStr = f.dateEvent ? new Date(f.dateEvent).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const snap = f.resultsSnapshot;
  const escape = s => String(s || '').replace(/</g, '&lt;');

  // Multi-formules : lecture des blocs (avec fallback legacy mono)
  const blocs = getBlocs(f);
  const hasSpec = blocs.some(b => formatHasSpectacle(b.typeId));

  // Résolution du nom de chaque formule : la bibliothèque a peut-être été
  // renommée depuis le save — on prend le nom courant si dispo, sinon le
  // libellé du type, sinon "(formule supprimée)".
  const nomBloc = (bloc) => {
    if (bloc.formuleId) {
      const f0 = state.formulesPrestation.find(x => x.id === bloc.formuleId);
      if (f0?.nom) return f0.nom;
    }
    return formatLabel(bloc.typeId) || '(formule supprimée)';
  };

  // Cellule "Formule(s)" — mono = libellé simple ; multi = liste compacte
  const formulesCell = blocs.length <= 1
    ? `<div><strong>Formule</strong><br>${escape(nomBloc(blocs[0] || {}))}</div>`
    : `<div style="grid-column:1/-1"><strong>${blocs.length} formules</strong>
         <ul style="margin:4px 0 0 18px;padding:0;font-size:0.92em">
           ${blocs.map(b => `<li>${escape(nomBloc(b))} — <strong>${b.nbPers ?? '—'}</strong> p</li>`).join('')}
         </ul>
       </div>`;

  // Cellule "Nombre de personnes" — mono = nb pers du bloc unique ;
  // multi = total + détail entre parenthèses
  const totalPers = blocs.reduce((s, b) => s + (b.nbPers || 0), 0);
  const persCell = blocs.length <= 1
    ? `<div><strong>Nombre de personnes</strong><br>${blocs[0]?.nbPers ?? f.config?.nbPers ?? '—'}</div>`
    : `<div><strong>Total personnes</strong><br>${totalPers} <span style="color:#888;font-size:0.85em">(${blocs.map(b => b.nbPers || 0).join(' + ')})</span></div>`;

  $('ficheModalBody').innerHTML = `
    <h2 style="margin-top:0;margin-bottom:6px">${escape(f.nomFiche || '(sans nom)')}</h2>
    <p style="margin-bottom:14px"><span class="statutBadge ${f.statut || 'brouillon'}" style="margin-left:0">${escape(statutLabels[f.statut] || f.statut || 'brouillon')}</span>${f.updated_by ? `<span style="color:#888;font-size:0.8em;margin-left:10px">dernière modif : ${escape(f.updated_by)}</span>` : ''}</p>

    <div class="modalGrid">
      <div><strong>Client</strong><br>${escape(f.client || '—')}</div>
      <div><strong>Date</strong><br>${dateStr}</div>
      ${formulesCell}
      ${persCell}
      ${f.heureArrivee ? `<div><strong>Arrivée invités</strong><br>${escape(f.heureArrivee)}</div>` : ''}
      ${hasSpec && f.heureSpectacle ? `<div><strong>Heure spectacle</strong><br>${escape(f.heureSpectacle)}</div>` : ''}
      ${f.contactEmail ? `<div><strong>Email</strong><br>${escape(f.contactEmail)}</div>` : ''}
      ${f.contactTel ? `<div><strong>Téléphone</strong><br>${escape(f.contactTel)}</div>` : ''}
    </div>

    ${snap ? `
      <h3 style="margin-top:18px;font-size:0.95em">Chiffres (snapshot enregistré)</h3>
      <div class="modalGrid">
        <div><strong>Total HT</strong><br>${fmt(snap.totalHT)}</div>
        <div><strong>Total TTC</strong><br>${fmt(snap.totalTTC)}</div>
        <div><strong>Prix HT/pers</strong><br>${fmt(snap.prixPers)}</div>
        <div><strong>Marge brute</strong><br>${fmtPct(snap.tauxMarge)}</div>
      </div>
    ` : ''}

    ${f.notes ? `<h3 style="margin-top:18px;font-size:0.95em">Notes</h3><div class="modalNotes">${escape(f.notes)}</div>` : ''}

    <div class="modalActions">
      <button onclick="closeFicheModal()">Fermer</button>
      <button class="primary" onclick="loadFicheFromModal('${f.id}')" style="margin-top:0">Ouvrir dans le simulateur →</button>
    </div>
  `;
  $('ficheModal').classList.remove('hidden');
}

export async function openDayModal(dateStr) {
  // L'index contient déjà ce qu'il faut pour la liste du jour : pas de fetch
  // par fiche (on les chargera à la demande quand l'utilisateur clique "Voir").
  const fichesJour = state.fichesList.filter(f => f.dateEvent === dateStr);
  // Programmation : on charge le mois si pas en cache (await silencieux)
  const mois = dateStr.slice(0, 7);
  await ensureMonthLoaded(mois);
  const jour = getJour(dateStr);
  const hasProg = jour && (
    (Array.isArray(jour.artistes) && jour.artistes.length > 0) ||
    (Array.isArray(jour.creneaux) && jour.creneaux.length > 0) ||
    (jour.notes && jour.notes.trim())
  );

  // S'il n'y a NI fiche NI programmation, on n'ouvre pas la modal
  if (fichesJour.length === 0 && !hasProg) return;

  const dateLabel = new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const statutLabels = { brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé' };
  const escape = s => String(s || '').replace(/</g, '&lt;');

  let fichesHTML = '';
  if (fichesJour.length > 0) {
    let listHTML = '';
    fichesJour.forEach(f => {
      const totalLine = typeof f.totalHT === 'number' ? `${fmt(f.totalHT)} HT` : '';
      const updateLine = f.updated_by ? `modif. : ${escape(f.updated_by)}` : '';
      const sub = [totalLine, updateLine].filter(Boolean).join(' · ');
      listHTML += `
        <div style="padding:10px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div>
            <strong>${escape(f.client || f.nomFiche || '?')}</strong>
            <span class="statutBadge ${f.statut || 'brouillon'}" style="margin-left:0">${escape(statutLabels[f.statut] || f.statut)}</span>
            ${sub ? `<br><span style="font-size:0.85em;color:#666">${sub}</span>` : ''}
          </div>
          <button onclick="closeFicheModal();openFicheModal('${f.id}')">Voir</button>
        </div>
      `;
    });
    fichesHTML = `
      <h3 style="margin:18px 0 8px;font-size:0.95em">Fiches devis (${fichesJour.length})</h3>
      ${listHTML}
    `;
  }

  let progHTML = '';
  let progCountForHeader = 0;
  if (hasProg) {
    const artistes = Array.isArray(jour.artistes) ? jour.artistes : [];
    const creneaux = Array.isArray(jour.creneaux) ? jour.creneaux : [];
    const notes = jour.notes || '';
    progCountForHeader = creneaux.length;

    const artistesHTML = artistes.length > 0
      ? `<div style="padding:10px 12px;background:#fbf8fd;border:1px solid #ead8f3;border-radius:6px">
           <div style="font-size:0.78em;color:#6b4a8a;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Artistes</div>
           <div>${artistes.map(a => escape(a)).join(', ')}</div>
         </div>`
      : `<div style="padding:10px 12px;background:#fafafa;border:1px solid rgba(0,0,0,0.06);border-radius:6px;color:#888;font-style:italic">Aucun artiste renseigné</div>`;

    const creneauxHTML = creneaux.length > 0
      ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
           <span style="font-size:0.78em;color:#666;text-transform:uppercase;letter-spacing:0.04em">Créneaux :</span>
           ${creneaux.map(h => `<span style="display:inline-block;padding:2px 8px;background:#fff;border:1px solid #ead8f3;color:#6b4a8a;border-radius:12px;font-size:0.85em;font-weight:500">${escape(h)}</span>`).join('')}
         </div>`
      : '';

    const notesHTML = notes
      ? `<div style="margin-top:8px;padding:8px 12px;background:#fff8e7;border-left:3px solid #d4a843;border-radius:4px;font-style:italic;font-size:0.9em;color:#5a4a1a">${escape(notes)}</div>`
      : '';

    const manuelleBadge = jour.manuelle
      ? ` <span style="font-size:0.7em;color:#fff;background:#8a4ad6;padding:1px 6px;border-radius:3px;vertical-align:middle;font-weight:500">SAISIE MANUELLE</span>`
      : '';

    progHTML = `
      <h3 style="margin:18px 0 8px;font-size:0.95em">🎤 Programmation artistique${manuelleBadge}</h3>
      ${artistesHTML}
      ${creneauxHTML}
      ${notesHTML}
    `;
  }

  const subHeader = hasProg
    ? `${fichesJour.length} fiche${fichesJour.length>1?'s':''} · ${progCountForHeader} créneau${progCountForHeader > 1 ? 'x' : ''} de prog`
    : `${fichesJour.length} fiche${fichesJour.length>1?'s':''} ce jour`;

  $('ficheModalBody').innerHTML = `
    <h2 style="margin-top:0">${dateLabel}</h2>
    <p style="color:#666;margin-bottom:14px">${subHeader}</p>
    ${fichesHTML}
    ${progHTML}
    <div class="modalActions">
      <button onclick="closeFicheModal()">Fermer</button>
    </div>
  `;
  $('ficheModal').classList.remove('hidden');
}

export function closeFicheModal() {
  $('ficheModal').classList.add('hidden');
}

export function loadFicheFromModal(id) {
  closeFicheModal();
  switchTab('simulateur');
  loadFiche(id);
}

export function registerModalListeners() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('ficheModal').classList.contains('hidden')) closeFicheModal();
  });
}
