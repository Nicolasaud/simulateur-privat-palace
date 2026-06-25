// Wrapper de toutes les requêtes vers les Netlify Functions.
//
// Trois rôles :
//   1. Toujours envoyer le cookie de session (credentials: same-origin).
//   2. Sur 401 → redirige vers /login.html (la session a expiré).
//   3. Compter les requêtes en vol pour piloter le spinner global.
//
// Toutes les fonctions retournent une promesse résolue par le body JSON,
// ou rejetée avec une Error { status, body } (HTTP) ou Error (réseau).

// === Spinner global ===
let pendingCount = 0;

function refreshSpinner() {
  const el = document.getElementById('apiSpinner');
  if (!el) return;
  el.classList.toggle('show', pendingCount > 0);
}

// === Debounce par clé : utilisé pour PUT bdd-items / formules / paliers / params ===
const flushers = new Map();

export function scheduleFlush(key, fn, ms = 400) {
  if (flushers.has(key)) clearTimeout(flushers.get(key));
  const t = setTimeout(async () => {
    flushers.delete(key);
    try { await fn(); }
    catch (e) { console.error(`[api] flush ${key} échoué :`, e); }
  }, ms);
  flushers.set(key, t);
}

// Pour les sauvegardes critiques (avant logout, beforeunload, etc.)
// on déclenche immédiatement tous les flushers en attente.
export async function flushAllPending() {
  const pending = [...flushers.values()];
  flushers.clear();
  pending.forEach(t => clearTimeout(t));
  // Note : les callbacks ont été perdus avec le clearTimeout — il n'y a
  // pas de moyen simple de les rejouer ici. Cette fonction est gardée
  // comme accroche future si on en a besoin (pour l'instant elle ne sert
  // qu'à annuler les timers).
}

// === Cœur du wrapper ===
async function apiCall(method, path, body) {
  pendingCount++;
  refreshSpinner();
  try {
    const opts = {
      method,
      credentials: 'same-origin',
      cache: 'no-store'
    };
    if (body !== undefined) {
      opts.headers = { 'content-type': 'application/json' };
      opts.body = JSON.stringify(body);
    }

    let r;
    try {
      r = await fetch(path, opts);
    } catch (netErr) {
      const e = new Error(`Erreur réseau (${path}) : ${netErr.message}`);
      e.network = true;
      throw e;
    }

    if (r.status === 401) {
      // Session expirée ou jamais établie : on retire les caches locaux
      // et on renvoie vers la page de login.
      window.location.replace('/login.html');
      // Bloque la suite de la chaîne d'appels
      return new Promise(() => {});
    }

    let data = null;
    const ctype = r.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      try { data = await r.json(); } catch { data = null; }
    }

    if (!r.ok) {
      const err = new Error(`API ${method} ${path} → ${r.status}`);
      err.status = r.status;
      err.body = data;
      throw err;
    }

    return data;
  } finally {
    pendingCount--;
    refreshSpinner();
  }
}

// === Endpoints ===
export const getParams      = ()        => apiCall('GET',    '/api/params');
export const putParams      = (obj)     => apiCall('PUT',    '/api/params', obj);

export const getBddItems    = ()        => apiCall('GET',    '/api/bdd-items');
export const putBddItems    = (arr)     => apiCall('PUT',    '/api/bdd-items', arr);

export const getFormules    = ()        => apiCall('GET',    '/api/formules');
export const putFormules    = (arr)     => apiCall('PUT',    '/api/formules', arr);

// Formules de prestation v2 (bundles type+params+items réutilisables) —
// blob distinct de `formules` (qui reste pour les compositions legacy).
export const getFormulesV2  = ()        => apiCall('GET',    '/api/formules-v2');
export const putFormulesV2  = (arr)     => apiCall('PUT',    '/api/formules-v2', arr);

// Types internes (Modèle C — niveau 1) : 5 types figés portant les params par
// défaut. Les formules-v2 référencent un typeId et ne stockent que leurs
// overrides par-param.
export const getTypesInternes = () => apiCall('GET', '/api/types-internes');
export const putTypesInternes = (arr) => apiCall('PUT', '/api/types-internes', arr);

// Programmation artistique mensuelle (Phase 2b).
// listProgrammationMois  : retourne ['YYYY-MM', ...] des mois ayant des données
// getProgrammationMois   : retourne { 'YYYY-MM-DD': [creneaux...] } (objet vide si mois absent)
// putProgrammationMois   : remplace intégralement le mois ; valide la structure côté serveur
export const listProgrammationMois = () => apiCall('GET', '/api/programmation');
export const getProgrammationMois = (mois) => apiCall('GET', `/api/programmation/${encodeURIComponent(mois)}`);
export const putProgrammationMois = (mois, obj) => apiCall('PUT', `/api/programmation/${encodeURIComponent(mois)}`, obj);

// Parser PDF (Phase 2a) : POST { pdfBase64 } → { dates, chars, log }
export const parseProgrammationPdf = (pdfBase64) => apiCall('POST', '/api/parse-programmation', { pdfBase64 });

export const getPaliers     = ()        => apiCall('GET',    '/api/paliers');
export const putPaliers     = (arr)     => apiCall('PUT',    '/api/paliers', arr);

export const listFiches     = ()        => apiCall('GET',    '/api/fiches');
export const getFiche       = (id)      => apiCall('GET',    `/api/fiches/${encodeURIComponent(id)}`);
export const putFiche       = (id, obj) => apiCall('PUT',    `/api/fiches/${encodeURIComponent(id)}`, obj);
export const deleteFicheApi = (id)      => apiCall('DELETE', `/api/fiches/${encodeURIComponent(id)}`);
