// Toast minimaliste (haut-droite, auto-dismiss 4 s).
// Utilisé pour signaler les conflits multi-utilisateurs et erreurs ponctuelles.

let dismissTimer = null;

export function showToast(message, type = 'info', durationMs = 4000) {
  const el = document.getElementById('toast');
  if (!el) {
    console.warn('[toast]', type, message);
    return;
  }
  el.textContent = message;
  el.className = 'toast show ' + type;
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    el.classList.remove('show');
  }, durationMs);
}
