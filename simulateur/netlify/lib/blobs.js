// Accès uniforme aux Netlify Blobs.
//
// Toutes les ressources de l'app vivent dans un seul "store" Blobs nommé "palace",
// avec des clés sémantiques :
//   bdd-items
//   formules
//   paliers
//   params
//   fiches/<id>
//   fiches/_index

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'palace';

function store() {
  return getStore(STORE_NAME);
}

export async function readJson(key, fallback = null) {
  const value = await store().get(key, { type: 'json' });
  return value ?? fallback;
}

export async function writeJson(key, value) {
  await store().setJSON(key, value);
}

export async function deleteKey(key) {
  await store().delete(key);
}

export async function listKeys(prefix) {
  const { blobs } = await store().list({ prefix });
  return blobs.map(b => b.key);
}
