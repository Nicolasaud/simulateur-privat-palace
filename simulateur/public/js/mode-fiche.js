// Nature de la réservation d'une fiche : privatisation, groupe ou journée.
//
// Seule la privatisation immobilise la salle sur une soirée : c'est donc le
// seul mode qui déclenche des frais de réservation quand le devis passe sous
// le seuil de couverture, et le seul qui affiche l'encart Couverture.
//
// Module minuscule et sans dépendance : il est lu aussi bien par fiches.js
// (sérialisation) que par calcul.js et calcul-libre-bridge.js, qui ne peuvent
// pas importer fiches.js sans créer un cycle.

export const MODES_FICHE = ['privatisation', 'groupe', 'journee'];

export function getModeFiche() {
  const el = document.querySelector('input[name="modeFiche"]:checked');
  return el && MODES_FICHE.includes(el.value) ? el.value : 'privatisation';
}

export function setModeFiche(mode) {
  const valeur = MODES_FICHE.includes(mode) ? mode : 'privatisation';
  const el = document.querySelector(`input[name="modeFiche"][value="${valeur}"]`);
  if (el) el.checked = true;
}

export function estPrivatisation() {
  return getModeFiche() === 'privatisation';
}
