// Module partagé : gestion du cookie de session HMAC SHA-256.
//
// Format du token : `<payloadB64>.<sigB64>`
//   payload = base64url(JSON.stringify({exp:<unixSeconds>, nom:<string>}))
//   sig     = base64url(HMAC-SHA256(payload, SESSION_SECRET))
//
// C'est l'équivalent compact d'un JWT HS256 sans le header (algo figé).
// Le secret SESSION_SECRET est lu depuis les variables d'environnement.

import crypto from 'node:crypto';

const COOKIE_NAME = 'palace_session';
const DEFAULT_TTL_SECONDS = 30 * 24 * 3600; // 30 jours, glissant (rafraîchi par /api/me)

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET manquant ou trop court (32 caractères min).');
  }
  return s;
}

export function signSession({ nom }, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64urlEncode(JSON.stringify({ exp, nom }));
  const sig = b64urlEncode(
    crypto.createHmac('sha256', getSecret()).update(payload).digest()
  );
  return { token: `${payload}.${sig}`, exp };
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const expectedSig = b64urlEncode(
    crypto.createHmac('sha256', getSecret()).update(payload).digest()
  );
  // Comparaison à temps constant
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(b64urlDecode(payload).toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof data.nom !== 'string' || !data.nom) return null;
    return { nom: data.nom, exp: data.exp };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.get('cookie'));
  return verifySession(cookies[COOKIE_NAME]);
}

// Construit la valeur d'un en-tête Set-Cookie.
// Le flag Secure n'est appliqué qu'en prod (Netlify dev = http localhost).
export function buildSetCookieHeader(token, { maxAgeSeconds = DEFAULT_TTL_SECONDS, secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookieHeader({ secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Détecte si la requête arrive en HTTPS (ou via Netlify avec X-Forwarded-Proto).
// En dev local (`netlify dev`), l'origin est http://localhost → Secure désactivé,
// sinon le navigateur refuse le cookie.
export function isSecureRequest(req) {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto === 'https';
  return new URL(req.url).protocol === 'https:';
}

export { COOKIE_NAME, DEFAULT_TTL_SECONDS };
