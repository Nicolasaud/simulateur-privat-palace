// Migration localStorage → cloud (étape 6).
//
// Au premier login après la bascule cloud, si l'utilisateur a encore des
// données en localStorage (clés legacy), on propose une popup d'import :
//   Oui          → upload tout vers /api, vide les clés localStorage
//   Plus tard    → ferme la popup, on reproposera au prochain chargement
//   Ne plus demander → flag local 'palace_migration_dismissed', plus de popup
//
// Le bouton "Plus tard" laisse les données legacy intactes en cas de doute.

import { putBddItems, putFormules, putPaliers, putFiche } from './api.js';
import { showToast } from './ui-feedback.js';

const LEGACY_KEYS = {
  FICHES: 'palace-fiches-v1',
  BDD: 'palace-items-bdd-v1',
  FORMULES: 'palace-formules-bdd-v1',
  PALIERS: 'palace-paliers-v1'
};

const DISMISSED_KEY = 'palace_migration_dismissed';

function readLegacy(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectLegacy() {
  if (localStorage.getItem(DISMISSED_KEY) === '1') return null;
  const fiches = readLegacy(LEGACY_KEYS.FICHES) || [];
  const bdd = readLegacy(LEGACY_KEYS.BDD) || [];
  const formules = readLegacy(LEGACY_KEYS.FORMULES) || [];
  const paliers = readLegacy(LEGACY_KEYS.PALIERS) || [];
  const nFiches = Array.isArray(fiches) ? fiches.length : 0;
  const nBdd = Array.isArray(bdd) ? bdd.length : 0;
  const nFormules = Array.isArray(formules) ? formules.length : 0;
  const nPaliers = Array.isArray(paliers) ? paliers.length : 0;
  if (nFiches + nBdd + nFormules + nPaliers === 0) return null;
  return { fiches, bdd, formules, paliers, nFiches, nBdd, nFormules, nPaliers };
}

function clearLegacy() {
  Object.values(LEGACY_KEYS).forEach(k => localStorage.removeItem(k));
}

async function uploadAll(legacy) {
  let okFiches = 0, koFiches = 0;
  for (const f of legacy.fiches) {
    if (!f.id) f.id = 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    try {
      await putFiche(f.id, f);
      okFiches++;
    } catch (e) {
      console.error('Upload fiche échoué', f.id, e);
      koFiches++;
    }
  }
  try {
    if (legacy.nBdd > 0) await putBddItems(legacy.bdd);
  } catch (e) { console.error('Upload bdd-items échoué', e); }
  try {
    if (legacy.nFormules > 0) await putFormules(legacy.formules);
  } catch (e) { console.error('Upload formules échoué', e); }
  try {
    if (legacy.nPaliers > 0) await putPaliers(legacy.paliers);
  } catch (e) { console.error('Upload paliers échoué', e); }
  return { okFiches, koFiches };
}

// Affiche la popup. Retourne une promesse qui se résout quand l'utilisateur
// a fait son choix. La promesse résout à true si l'import a eu lieu (l'appelant
// doit recharger les données depuis le cloud), false sinon.
export function maybeOfferMigration() {
  const legacy = detectLegacy();
  if (!legacy) return Promise.resolve(false);

  return new Promise(resolve => {
    const modal = document.getElementById('migrationModal');
    const body = document.getElementById('migrationModalBody');
    body.innerHTML = `
      <h2 style="margin-top:0">Données locales détectées</h2>
      <p style="margin:10px 0 14px">Tu as encore des données dans le stockage local de ce navigateur :</p>
      <ul style="margin:0 0 14px 20px;font-size:0.92em">
        ${legacy.nFiches    ? `<li><strong>${legacy.nFiches}</strong> fiche${legacy.nFiches > 1 ? 's' : ''} devis</li>` : ''}
        ${legacy.nBdd       ? `<li><strong>${legacy.nBdd}</strong> item${legacy.nBdd > 1 ? 's' : ''} dans la base</li>` : ''}
        ${legacy.nFormules  ? `<li><strong>${legacy.nFormules}</strong> formule${legacy.nFormules > 1 ? 's' : ''} enregistrée${legacy.nFormules > 1 ? 's' : ''}</li>` : ''}
        ${legacy.nPaliers   ? `<li><strong>${legacy.nPaliers}</strong> palier${legacy.nPaliers > 1 ? 's' : ''} de personnel</li>` : ''}
      </ul>
      <p style="margin:10px 0 18px;font-size:0.9em;color:#666">Les importer vers le cloud partagé avec Lucie et Benjamin ? Les données locales seront effacées après import réussi.</p>
      <div class="modalActions">
        <button id="migBtnLater">Plus tard</button>
        <button id="migBtnNever" class="delete">Ne plus demander</button>
        <button id="migBtnYes" class="primary" style="margin-top:0">Importer maintenant</button>
      </div>
    `;
    modal.classList.remove('hidden');

    const close = () => modal.classList.add('hidden');

    document.getElementById('migBtnLater').onclick = () => {
      close();
      resolve(false);
    };
    document.getElementById('migBtnNever').onclick = () => {
      if (confirm('Confirmer : ne plus jamais proposer cette migration sur ce navigateur ?')) {
        localStorage.setItem(DISMISSED_KEY, '1');
        close();
        resolve(false);
      }
    };
    document.getElementById('migBtnYes').onclick = async () => {
      const yesBtn = document.getElementById('migBtnYes');
      yesBtn.disabled = true;
      yesBtn.textContent = 'Import en cours…';
      try {
        const result = await uploadAll(legacy);
        if (result.koFiches > 0) {
          showToast(`Migration partielle : ${result.okFiches} fiche(s) importée(s), ${result.koFiches} en erreur. Données locales conservées.`, 'error');
          close();
          resolve(true); // recharge quand même, on a uploadé une partie
        } else {
          clearLegacy();
          showToast(`Migration réussie : ${legacy.nFiches} fiche(s), ${legacy.nBdd} item(s), ${legacy.nFormules} formule(s), ${legacy.nPaliers} palier(s) importé(s).`, 'success', 6000);
          close();
          resolve(true);
        }
      } catch (e) {
        showToast(`Erreur migration : ${e.message}`, 'error');
        yesBtn.disabled = false;
        yesBtn.textContent = 'Importer maintenant';
      }
    };
  });
}
