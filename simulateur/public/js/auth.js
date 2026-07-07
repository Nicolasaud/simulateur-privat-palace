// Vérification de session côté client + helper logout.
//
// `requireAuth()` est appelé tout en haut de main.js : si la session est valide
// le nom est retourné, sinon on redirige vers /login.html et on hang la promise
// (pour empêcher l'init de la suite).
//
// `logout()` est exposé sur window pour le bouton "Déconnexion" inline.

export async function requireAuth() {
  try {
    const r = await fetch('/api/me', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (r.ok) {
      const data = await r.json();
      // On rafraîchit le prénom mémorisé (source de vérité côté serveur)
      try { localStorage.setItem('palace_nom', data.nom); } catch {}
      return data.nom;
    }
  } catch {
    // Erreur réseau → redirige aussi vers login
  }
  window.location.replace('/login.html');
  // Bloque toute la suite de main.js pendant la redirection
  return new Promise(() => {});
}

export async function logout() {
  if (!confirm('Se déconnecter ?')) return;
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // On redirige même si l'appel échoue (le cookie sera périmé côté serveur de toute façon)
  }
  window.location.replace('/login.html');
}
