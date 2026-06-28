// Export "fiche équipe" : génère un document HTML imprimable (sans prix)
// ouvert dans une fenêtre pop-up pour impression / PDF.

import { readCurrentForm, formatHasSpectacle } from './fiches.js';
import { state } from './state.js';

export function exportFicheEquipe() {
  const data = readCurrentForm();
  const formatLabels = {
    'privat-full': 'Privatisation show + repas',
    'privat-salle': 'Privatisation sans show',
    'atelier-cocktail': 'Atelier cocktail',
    'formation-impro': 'Formation impro / team building',
    'groupe-classique': 'Groupe sur soirée Palace classique'
  };
  const statutLabels = {
    'brouillon': 'Brouillon', 'envoye': 'Devis envoyé',
    'accepte': 'Accepté ✓', 'refuse': 'Refusé'
  };
  const dateEvent = data.dateEvent ? new Date(data.dateEvent).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '— non renseignée —';

  // Multi-formules : récupère les blocs depuis data.config.formules (avec
  // fallback legacy si jamais le format est très ancien).
  const blocs = Array.isArray(data.config.formules) && data.config.formules.length > 0
    ? data.config.formules
    : [{
        formuleId: data.config.formuleId,
        typeId: data.config.format,
        nbPers: data.config.nbPers,
        items: data.config.items || [],
        formuleType: data.config.formuleType || 'custom'
      }];

  const totalPers = blocs.reduce((s, b) => s + (b.nbPers || 0), 0);
  // Heure du spectacle : visible si au moins un bloc a un type avec spectacle
  const formatHasSpec = blocs.some(b => formatHasSpectacle(b.typeId));

  // Bandeau "N formules" si plusieurs
  const headerBlocs = blocs.length > 1
    ? `<div class="badge" style="background:#1a1a1a;color:#fff">${blocs.length} formules</div>`
    : '';

  // Pour chaque bloc : section avec nom de formule, nb pers, items resto
  const blocsHTML = blocs.map((bloc, idx) => {
    const formuleNom = bloc.formuleId
      ? (state.formulesPrestation.find(f => f.id === bloc.formuleId)?.nom || '(formule supprimée)')
      : formatLabels[bloc.typeId] || bloc.typeId;
    const typeLabel = formatLabels[bloc.typeId] || bloc.typeId;
    const compositionItems = (bloc.formuleType === 'custom' && Array.isArray(bloc.items) && bloc.items.length > 0)
      ? `<h4>Composition restauration</h4>
         <ul class="composition">
           ${bloc.items.map(item => `<li>${(item.libelle || '').replace(/</g, '&lt;')}</li>`).join('')}
         </ul>`
      : '<p style="color:#888;font-size:0.88em;margin-top:6px">Aucun item resto sur ce bloc.</p>';
    const titre = blocs.length > 1 ? `Formule ${idx + 1} — ${formuleNom}` : formuleNom;
    return `
      <section class="bloc-section">
        <h3>${titre.replace(/</g, '&lt;')}</h3>
        <div class="infoGrid">
          <div class="l">Type</div><div class="v">${typeLabel.replace(/</g, '&lt;')}</div>
          <div class="l">Nombre de personnes</div><div class="v">${bloc.nbPers}</div>
        </div>
        ${compositionItems}
      </section>
    `;
  }).join('');

  const escape = s => String(s || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  const now = new Date();
  const horodatage = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) + ' à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Fiche équipe — ${escape(data.client || 'Sans client')} — ${dateEvent}</title>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 32px 40px; color: #1a1a1a; line-height: 1.5; max-width: 800px; margin: 0 auto; }
  h1, h2, h3 { font-family: 'Lexend', sans-serif; font-weight: 600; }
  h1 { font-size: 1.6em; margin-bottom: 4px; }
  h2 { font-size: 1.05em; margin: 24px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 20px; }
  .meta { color: #666; font-size: 0.85em; margin-top: 6px; }
  .infoGrid { display: grid; grid-template-columns: 180px 1fr; gap: 6px 16px; margin-bottom: 8px; }
  .infoGrid .l { color: #666; font-size: 0.88em; }
  .infoGrid .v { font-weight: 500; }
  .composition { padding-left: 22px; }
  .composition li { margin: 4px 0; }
  .notes { background: #f8f8f8; border-left: 3px solid #888; padding: 10px 14px; border-radius: 4px; white-space: pre-wrap; font-size: 0.92em; }
  .bloc-section { margin-top: 18px; padding: 14px 16px; background: #fafafa; border: 1px solid #e0e0e0; border-radius: 6px; page-break-inside: avoid; }
  .bloc-section h3 { font-size: 1em; margin-bottom: 10px; color: #1a1a1a; }
  .bloc-section h4 { font-size: 0.92em; margin: 12px 0 6px; color: #444; }
  .bloc-section .infoGrid { margin-bottom: 4px; }
  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #ccc; font-size: 0.78em; color: #888; display: flex; justify-content: space-between; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 500; background: #f0f0f0; color: #555; }
  @media print {
    body { padding: 0; }
    button { display: none; }
  }
  .printBtn { position: fixed; top: 16px; right: 16px; padding: 8px 14px; background: #1a1a1a; color: white; border: none; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 0.88em; }
</style>
</head>
<body>
  <button class="printBtn" onclick="window.print()">Imprimer / PDF</button>

  <div class="header">
    <h1>Fiche opérationnelle — Palace Comedy</h1>
    <p class="meta">${escape(data.nomFiche || '(fiche sans nom)')} · <span class="badge">${escape(statutLabels[data.statut] || data.statut)}</span> ${headerBlocs}</p>
  </div>

  <h2>Client &amp; événement</h2>
  <div class="infoGrid">
    <div class="l">Client</div><div class="v">${escape(data.client || '—')}</div>
    <div class="l">Contact email</div><div class="v">${escape(data.contactEmail || '—')}</div>
    <div class="l">Contact téléphone</div><div class="v">${escape(data.contactTel || '—')}</div>
    <div class="l">Date</div><div class="v">${dateEvent}</div>
    <div class="l">Heure d'arrivée invités</div><div class="v">${escape(data.heureArrivee || '—')}</div>
    ${formatHasSpec ? `<div class="l">Heure du spectacle</div><div class="v">${escape(data.heureSpectacle || '—')}</div>` : ''}
    <div class="l">Total personnes</div><div class="v">${totalPers}${blocs.length > 1 ? ` (réparti sur ${blocs.length} formules)` : ''}</div>
  </div>

  <h2>Formule${blocs.length > 1 ? 's' : ''} de prestation</h2>
  ${blocsHTML}

  ${(Array.isArray(data.programmeSoiree) && data.programmeSoiree.length > 0) ? `
  <h2>Programme de la soirée</h2>
  <table style="width:100%;border-collapse:collapse;font-size:0.92em;margin-top:8px">
    <thead>
      <tr style="background:#1a1a1a;color:white">
        <th style="text-align:left;padding:8px 10px;width:120px">Heure</th>
        <th style="text-align:left;padding:8px 10px">Déroulé</th>
      </tr>
    </thead>
    <tbody>
      ${data.programmeSoiree.map(p => `<tr style="border-bottom:1px solid #e0e0e0">
        <td style="padding:8px 10px;font-weight:600">${escape(p.heure)}</td>
        <td style="padding:8px 10px;white-space:pre-wrap">${escape(p.deroule)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}

  ${data.notes ? `<h2>Notes</h2><div class="notes">${escape(data.notes)}</div>` : ''}

  <div class="footer">
    <span>Document interne — sans informations tarifaires</span>
    <span>Édité le ${horodatage}</span>
  </div>

  <script>
    setTimeout(() => window.print(), 600);
  </script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=850,height=1100');
  if (!w) {
    alert('Le navigateur a bloqué la fenêtre pop-up. Autorise-la pour cette page et réessaie.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
