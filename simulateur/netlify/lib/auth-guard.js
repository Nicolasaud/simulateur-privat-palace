// Wrapper d'authentification réutilisé par tous les endpoints CRUD.
// Lit le cookie de session, retourne le prénom ou une 401.

import { getSessionFromRequest } from './session.js';

export function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

// Retourne { ok: true, nom } ou { ok: false, response }.
// L'appelant fait : if (!auth.ok) return auth.response;
export function requireAuth(req) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: jsonResponse(401, { error: 'unauthenticated' }) };
  }
  return { ok: true, nom: session.nom };
}

// Parse body JSON ou retourne { ok: false, response: 400 }.
export async function readJsonBody(req) {
  try {
    const body = await req.json();
    return { ok: true, body };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: 'bad_json' }) };
  }
}

// Réponse 405 standard avec en-tête Allow.
export function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'allow': allowed.join(', ')
    }
  });
}
