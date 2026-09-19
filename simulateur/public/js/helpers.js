// Helpers DOM + formatage + lectures de champs config.

export const $ = id => document.getElementById(id);
export const val = id => parseFloat($(id).value) || 0;
export const fmt = n => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
export const fmtPct = n => (Math.round(n * 10) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

export function getTva(cat) {
  const map = { spectacle: 'tvaSpectacle', restauration: 'tvaResto', bar: 'tvaBar', prestation: 'tvaPresta' };
  return val(map[cat] || 'tvaPresta');
}

export function getCaJour(jour, periode) {
  const map = {
    lundi: 'caLun', mardi: 'caMar', mercredi: 'caMer', jeudi: 'caJeu',
    vendredi: 'caVen', samedi: 'caSam', dimanche: 'caDim'
  };
  const id = map[jour] + (periode === 'P1' ? 'P1' : 'P2');
  return val(id);
}

export function detectPeriode(dateEvent) {
  if (!dateEvent) return 'P2'; // fallback prudent
  const m = parseInt(dateEvent.substring(5, 7), 10);
  return (m >= 5 && m <= 9) ? 'P1' : 'P2';
}

export function getPeriodeEffective() {
  const override = $('periodeOverride').value;
  if (override === 'P1' || override === 'P2') return override;
  const dateEvent = $('ficheDateEvent') ? $('ficheDateEvent').value : '';
  return detectPeriode(dateEvent);
}

export function jourEstFerme(jour) {
  return jour === 'lundi' || jour === 'mardi';
}

export function getPlafond(jour) {
  if (['lundi','mardi'].includes(jour)) return val('plafondLunMar');
  if (['vendredi','samedi'].includes(jour)) return val('plafondVenSam');
  return val('plafondMid');
}

export function getPersonnel(nbPers) {
  const rows = document.querySelectorAll('#paliersTable tbody tr');
  let nbStaff = 0;
  let trouve = false;
  rows.forEach(r => {
    if (trouve) return;
    const inputs = r.querySelectorAll('input');
    const seuil = parseFloat(inputs[0].value) || 0;
    const staff = parseFloat(inputs[1].value) || 0;
    if (nbPers <= seuil) { nbStaff = staff; trouve = true; }
    else nbStaff = staff;
  });
  return {
    nbStaff,
    duree: val('paramDuree'),
    cout: nbStaff * val('paramDuree') * val('paramCoutHoraire')
  };
}
