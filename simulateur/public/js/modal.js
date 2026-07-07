// Modal aperçu d'une fiche (depuis le calendrier).
// openFicheModal / openDayModal sont async : on récupère la fiche complète
// via /api/fiches/:id avant d'afficher.

import { $, fmt, fmtPct } from './helpers.js';
import { state } from './state.js';
import { formatHasSpectacle, loadFiche } from './fiches.js';
import { switchTab } from './onglets.js';
import { getFiche, putProgrammationMois } from './api.js';
import { showToast } from './ui-feedback.js';
import { ensureMonthLoaded, getJour } from './programmation.js';

// État local du modal jour pour le mode édition de la programmation.
// null = lecture seule ; { dateStr, draft, isNew } = en cours d'édition.
//   draft = { artistes: string[], creneaux: string[], notes: string }
//   isNew = true si on ajoute une programmation sur un jour vide
let _editProg = null;

// Date couramment ouverte dans la modal (pour re-render après save/cancel).
let _currentDateStr = null;

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
  const statutLabels = { brouillon: 'Brouillon', envoye: 'Devis envoyé', accepte: 'Accepté', acompte_facture: 'Acompte facturé', facture_solde: 'Facture du solde', refuse: 'Refusé' };
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
  _currentDateStr = dateStr;
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
  // Édition en cours pour ce jour ?
  const editing = _editProg && _editProg.dateStr === dateStr ? _editProg : null;

  // Phase 2b4 : on ouvre TOUJOURS la modal — même sur un jour totalement vide
  // (ni fiche, ni prog, ni édition en cours). Le user verra le bouton
  // "Ajouter une programmation" pour démarrer une saisie.

  const dateLabel = new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const statutLabels = { brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', acompte_facture: 'Acompte', facture_solde: 'Facturé', refuse: 'Refusé' };
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

  if (editing) {
    // === MODE ÉDITION ===
    const d = editing.draft;
    const artistesValue = (d.artistes || []).join(', ');
    const creneauxChips = (d.creneaux || []).map((h, i) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;background:#fff;border:1px solid #ead8f3;color:#6b4a8a;border-radius:12px;font-size:0.85em;font-weight:500">
         ${escape(h)}
         <button onclick="removeEditCreneau(${i})" title="Retirer ce créneau" style="background:transparent;border:none;color:#6b4a8a;cursor:pointer;padding:0 4px;font-size:1.1em;line-height:1">×</button>
       </span>`
    ).join('');
    progHTML = `
      <h3 style="margin:18px 0 8px;font-size:0.95em">🎤 Édition de la programmation</h3>
      <div style="padding:12px;background:#fbf8fd;border:1px solid #ead8f3;border-radius:6px">
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:0.78em;color:#6b4a8a;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Artistes (séparés par des virgules)</label>
          <textarea id="editProgArtistes" rows="2" style="width:100%;padding:6px 8px;font-family:inherit;border:1px solid #ead8f3;border-radius:4px;resize:vertical">${escape(artistesValue)}</textarea>
        </div>
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:0.78em;color:#6b4a8a;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Créneaux horaires</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;min-height:28px">
            ${creneauxChips || '<span style="font-size:0.85em;color:#888;font-style:italic">Aucun créneau</span>'}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" id="editProgNewCreneau" placeholder="Ex : 19h ou 21h30" style="flex:1;padding:6px 8px;font-family:inherit;border:1px solid #ead8f3;border-radius:4px">
            <button onclick="addEditCreneau()" style="padding:6px 12px">+ Ajouter</button>
          </div>
        </div>
        <div>
          <label style="display:block;font-size:0.78em;color:#6b4a8a;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Notes</label>
          <textarea id="editProgNotes" rows="2" style="width:100%;padding:6px 8px;font-family:inherit;border:1px solid #ead8f3;border-radius:4px;resize:vertical">${escape(d.notes || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button onclick="cancelEditProgrammation()">Annuler</button>
        <button onclick="saveEditProgrammation()" class="primary" style="margin-top:0">💾 Enregistrer</button>
      </div>
    `;
  } else if (hasProg) {
    // === MODE LECTURE — programmation existe ===
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px">
        <h3 style="margin:0;font-size:0.95em">🎤 Programmation artistique${manuelleBadge}</h3>
        <div style="display:flex;gap:6px">
          <button onclick="startEditProgrammation('${dateStr}')" style="padding:3px 10px;font-size:0.85em">✏️ Modifier</button>
          <button onclick="deleteProgrammation('${dateStr}')" class="delete" style="padding:3px 10px;font-size:0.85em">🗑️ Supprimer</button>
        </div>
      </div>
      ${artistesHTML}
      ${creneauxHTML}
      ${notesHTML}
    `;
  } else {
    // === MODE JOUR VIDE — bouton "Ajouter une programmation" ===
    progHTML = `
      <div style="margin:18px 0 8px;padding:14px;border:1px dashed #ead8f3;border-radius:6px;text-align:center;background:#fbf8fd">
        <p style="margin:0 0 8px;font-size:0.9em;color:#6b4a8a">Aucune programmation artistique pour ce jour</p>
        <button onclick="startEditProgrammation('${dateStr}')" class="primary" style="margin-top:0">➕ Ajouter une programmation</button>
      </div>
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
      <button onclick="closeFicheModal()" ${editing ? 'disabled title="Termine l\'édition d\'abord (Annuler ou Enregistrer)"' : ''}>Fermer</button>
    </div>
  `;
  $('ficheModal').classList.remove('hidden');
}

export function closeFicheModal() {
  if (_editProg) {
    if (!confirm('Édition de la programmation en cours. Fermer sans enregistrer ?')) return;
    _editProg = null;
  }
  _currentDateStr = null;
  $('ficheModal').classList.add('hidden');
}

// =====================================================================
// Édition manuelle de la programmation (Phase 2b4)
// =====================================================================

// Capture les valeurs courantes des inputs édition dans _editProg.draft.
// Appelée systématiquement avant un re-render pour ne pas perdre la saisie.
function syncDraftFromInputs() {
  if (!_editProg) return;
  const aEl = document.getElementById('editProgArtistes');
  const nEl = document.getElementById('editProgNotes');
  if (aEl) _editProg.draft.notes = _editProg.draft.notes; // no-op (notes lus juste après)
  if (aEl) {
    _editProg.draft.artistes = aEl.value.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (nEl) _editProg.draft.notes = nEl.value;
}

export function startEditProgrammation(dateStr) {
  const existing = getJour(dateStr);
  _editProg = {
    dateStr,
    isNew: !existing,
    draft: {
      artistes: existing && Array.isArray(existing.artistes) ? [...existing.artistes] : [],
      creneaux: existing && Array.isArray(existing.creneaux) ? [...existing.creneaux] : [],
      notes: existing ? (existing.notes || '') : ''
    }
  };
  openDayModal(dateStr); // re-render avec mode édition
}

export function cancelEditProgrammation() {
  _editProg = null;
  if (_currentDateStr) openDayModal(_currentDateStr);
}

export function addEditCreneau() {
  if (!_editProg) return;
  syncDraftFromInputs();
  const input = document.getElementById('editProgNewCreneau');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  // Validation basique : doit ressembler à un horaire (Xh ou XhYY)
  if (!/^\d{1,2}h\d{0,2}$/.test(raw)) {
    showToast(`Format horaire invalide : "${raw}" (attendu : 19h, 21h30…)`, 'error');
    return;
  }
  if (_editProg.draft.creneaux.includes(raw)) {
    showToast(`Créneau "${raw}" déjà présent`, 'warn');
    return;
  }
  _editProg.draft.creneaux.push(raw);
  // Tri chronologique simple : on convertit en minutes
  _editProg.draft.creneaux.sort((a, b) => {
    const toMin = h => {
      const m = h.match(/^(\d{1,2})h(\d{0,2})$/);
      return m ? parseInt(m[1]) * 60 + (parseInt(m[2]) || 0) : 0;
    };
    return toMin(a) - toMin(b);
  });
  input.value = '';
  openDayModal(_editProg.dateStr);
}

export function removeEditCreneau(idx) {
  if (!_editProg) return;
  syncDraftFromInputs();
  _editProg.draft.creneaux.splice(idx, 1);
  openDayModal(_editProg.dateStr);
}

export async function saveEditProgrammation() {
  if (!_editProg) return;
  syncDraftFromInputs();
  const dateStr = _editProg.dateStr;
  const mois = dateStr.slice(0, 7);
  const draft = _editProg.draft;

  // Cohérence : si tout est vide → équivalent à une suppression. On demande
  // confirmation pour éviter qu'un user supprime par accident en effaçant tout.
  const isEmpty = draft.artistes.length === 0 && draft.creneaux.length === 0 && !draft.notes.trim();
  if (isEmpty) {
    if (!confirm('Tous les champs sont vides. Cela revient à supprimer la programmation du jour. Continuer ?')) return;
  }

  const newJour = {
    artistes: [...draft.artistes],
    creneaux: [...draft.creneaux],
    notes: draft.notes,
    manuelle: true
  };

  // On part de l'état mois en cache, on remplace (ou supprime si vide) la date
  await ensureMonthLoaded(mois);
  const monthData = { ...(state.programmationMonths[mois] || {}) };
  if (isEmpty) {
    delete monthData[dateStr];
  } else {
    monthData[dateStr] = newJour;
  }

  try {
    await putProgrammationMois(mois, monthData);
    // Update cache RAM (référence remplacée volontairement)
    state.programmationMonths[mois] = monthData;
    _editProg = null;
    showToast(isEmpty ? '🗑️ Programmation supprimée' : '✓ Programmation enregistrée', 'success');
    // Re-render modal + calendrier
    openDayModal(dateStr);
    if (typeof window.renderCalendrier === 'function') window.renderCalendrier();
  } catch (e) {
    console.error('[programmation] save échoué', e);
    showToast(`Erreur sauvegarde : ${e.message || e}`, 'error');
  }
}

export async function deleteProgrammation(dateStr) {
  const jour = getJour(dateStr);
  if (!jour) return;
  const label = jour.artistes?.length ? `${jour.artistes.length} artiste(s)` : 'cette programmation';
  if (!confirm(`Supprimer ${label} du ${dateStr} ?\nL'opération est irréversible.`)) return;
  const mois = dateStr.slice(0, 7);
  await ensureMonthLoaded(mois);
  const monthData = { ...(state.programmationMonths[mois] || {}) };
  delete monthData[dateStr];
  try {
    await putProgrammationMois(mois, monthData);
    state.programmationMonths[mois] = monthData;
    showToast('🗑️ Programmation supprimée', 'success');
    openDayModal(dateStr);
    if (typeof window.renderCalendrier === 'function') window.renderCalendrier();
  } catch (e) {
    console.error('[programmation] delete échoué', e);
    showToast(`Erreur suppression : ${e.message || e}`, 'error');
  }
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
