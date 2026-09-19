// Hachage et vérification du code d'accès partagé via scrypt (natif Node).
//
// Format stocké dans ACCESS_CODE_HASH :
//   scrypt$N=<N>,r=<r>,p=<p>$<saltBase64>$<keyBase64>
// où N, r, p sont les paramètres scrypt et keyLen est fixée à 32 octets.

import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 };

export function hashAccessCode(code) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(code, salt, PARAMS.keyLen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p
  });
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyAccessCode(code, hash) {
  if (!hash || typeof hash !== 'string') return false;
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const paramsMap = Object.fromEntries(
    parts[1].split(',').map(p => {
      const [k, v] = p.split('=');
      return [k, parseInt(v, 10)];
    })
  );
  if (!paramsMap.N || !paramsMap.r || !paramsMap.p) return false;

  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');

  let derived;
  try {
    derived = crypto.scryptSync(code, salt, expected.length, {
      N: paramsMap.N, r: paramsMap.r, p: paramsMap.p
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}
