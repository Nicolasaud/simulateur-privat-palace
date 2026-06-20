// GET /api/me — vérifie la session courante.
//
// Réponse 200 : { nom } + Set-Cookie (renouvellement glissant)
// Réponse 401 : { error: 'unauthenticated' }

import {
  getSessionFromRequest, signSession, buildSetCookieHeader,
  isSecureRequest, DEFAULT_TTL_SECONDS
} from '../lib/session.js';

export default async (req) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401, headers: { 'content-type': 'application/json' }
    });
  }

  // Renouvellement glissant : on resigne avec une nouvelle expiration.
  const { token } = signSession({ nom: session.nom });
  const setCookie = buildSetCookieHeader(token, {
    maxAgeSeconds: DEFAULT_TTL_SECONDS,
    secure: isSecureRequest(req)
  });

  return new Response(JSON.stringify({ nom: session.nom }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': setCookie,
      'cache-control': 'no-store'
    }
  });
};
