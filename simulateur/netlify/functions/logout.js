// POST /api/logout — efface le cookie de session.
//
// Réponse 200 toujours (idempotent), avec Set-Cookie Max-Age=0.

import { buildClearCookieHeader, isSecureRequest } from '../lib/session.js';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': buildClearCookieHeader({ secure: isSecureRequest(req) })
    }
  });
};
