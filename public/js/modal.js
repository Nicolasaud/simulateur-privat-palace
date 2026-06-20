// Modal aperçu d'une fiche (depuis le calendrier).
// openFicheModal / openDayModal sont async : on récupère la fiche complète
// via /api/fiches/:id avant d'afficher.

import { $, fmt, fmtPct } from './helpers.js';
import { state } from './state.js';
import { formatHasSpectacle, loadFiche } from './fiches.js';
import { switchTab } from './onglets.js';
import { getFiche } from './api.js';
import { showToast } from './ui-feedback.js';

export function formatLabel(format) {
  const labels = {
    'privat-full': 'Privatisation full + spectacle + repas',
    'privat-salle': 'Privatisation salle seule',
    'atelier-cocktail': 'Atelier cocktail',
    'formation-impro': 'Formation impro / team building',
    'groupe-classique': 'Groupe sur Palace classique'
  };
  return labels[format] || format;
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
  const hasSpec = formatHasSpectacle(f.config?.format);

  $('ficheModalBody').innerHTML = `
    <h2 style="margin-top:0;margin-bottom:6px">${escape(f.nomFiche || '(sans nom)')}</h2>
    <p style="margin-bottom:14px"><span class="statutBadge ${f.statut || 'brouillon'}" style="margin-left:0">${escape(statutLabels[f.statut] || f.statut || 'brouillon')}</span>${f.updated_by ? `<span style="color:#888;font-size:0.8em;margin-left:10px">dernière modif : ${escape(f.updated_by)}</span>` : ''}</p>

    <div class="modalGrid">
      <div><strong>Client</strong><br>${escape(f.client || '—')}</div>
      <div><strong>Date</strong><br>${dateStr}</div>
      <div><strong>Formule</strong><br>${escape(formatLabel(f.config?.format))}</div>
      <div><strong>Nombre de personnes</strong><br>${f.config?.nbPers ?? '—'}</div>
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
  if (fichesJour.length === 0) return;
  const dateLabel = new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const statutLabels = { brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé' };
  const escape = s => String(s || '').replace(/</g, '&lt;');

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

  $('ficheModalBody').innerHTML = `
    <h2 style="margin-top:0">${dateLabel}</h2>
    <p style="color:#666;margin-bottom:14px">${fichesJour.length} fiche${fichesJour.length>1?'s':''} ce jour</p>
    ${listHTML}
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
