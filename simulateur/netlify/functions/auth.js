// POST /api/auth — login
//
// Body JSON : { code: string, nom: string }
// Réponse 200 : { nom } + Set-Cookie palace_session
// Réponse 401 : { error: 'invalid_code' }
// Réponse 400 : { error: 'bad_request' } si champs manquants ou nom invalide

import { signSession, buildSetCookieHeader, isSecureRequest, DEFAULT_TTL_SECONDS } from '../lib/session.js';
import { verifyAccessCode } from '../lib/access-code.js';

const NOMS_AUTORISES = new Set(['Nicolas', 'Lucie', 'Benjamin', 'Autre']);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'content-type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const nom = typeof body.nom === 'string' ? body.nom.trim().slice(0, 40) : '';

  if (!code || !nom || !NOMS_AUTORISES.has(nom)) {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const hash = process.env.ACCESS_CODE_HASH;
  if (!hash) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }

  if (!verifyAccessCode(code, hash)) {
    // 401 sans détail pour ne pas révéler si c'est le code ou autre chose
    return new Response(JSON.stringify({ error: 'invalid_code' }), {
      status: 401, headers: { 'content-type': 'application/json' }
    });
  }

  const { token } = signSession({ nom });
  const setCookie = buildSetCookieHeader(token, {
    maxAgeSeconds: DEFAULT_TTL_SECONDS,
    secure: isSecureRequest(req)
  });

  return new Response(JSON.stringify({ nom }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': setCookie
    }
  });
};
