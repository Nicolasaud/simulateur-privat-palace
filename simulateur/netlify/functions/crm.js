// CRUD prospects CRM :
//   GET    /api/crm           → renvoie l'index des prospects
//   GET    /api/crm/:id       → renvoie le prospect complet
//   PUT    /api/crm/:id       → crée ou remplace (last-write-wins)
//   DELETE /api/crm/:id       → supprime + retire de l'index
//
// Stockage :
//   - 1 blob par prospect : clé `crm/<id>`
//   - 1 blob d'index      : clé `crm/_index`
//
// Traçabilité identique aux fiches devis : created_at/by, updated_at/by
// sont gérés côté serveur depuis le cookie de session.

import {
  requireAuth, readJsonBody, jsonResponse, methodNotAllowed
} from '../lib/auth-guard.js';
import { readJson, writeJson, deleteKey } from '../lib/blobs.js';

const INDEX_KEY = 'crm/_index';
const prospectKey = id => `crm/${id}`;

// L'index reste léger : pour la liste / kanban on n'a pas besoin des notes ni
// de la liste complète de fiches devis associées (juste leur compte).
function buildIndexEntry(p) {
  return {
    id: p.id,
    societe: p.societe || '',
    contactNom: p.contactNom || '',
    contactEmail: p.contactEmail || '',
    contactTel: p.contactTel || '',
    source: p.source || '',
    typeEvenement: p.typeEvenement || '',
    nbPersonnes: p.nbPersonnes ?? null,
    dateEnvisagee: p.dateEnvisagee || '',
    budgetAnnonce: p.budgetAnnonce ?? null,
    statut: p.statut || 'a_contacter',
    dateProchainContact: p.dateProchainContact || '',
    nbFichesLiees: Array.isArray(p.fichesIds) ? p.fichesIds.length : 0,
    created_at: p.created_at,
    created_by: p.created_by,
    updated_at: p.updated_at,
    updated_by: p.updated_by
  };
}

async function getIndex() {
  return (await readJson(INDEX_KEY, [])) || [];
}

async function upsertIndex(entry) {
  const index = await getIndex();
  const i = index.findIndex(e => e.id === entry.id);
  if (i >= 0) index[i] = entry; else index.push(entry);
  await writeJson(INDEX_KEY, index);
}

async function removeFromIndex(id) {
  const index = await getIndex();
  await writeJson(INDEX_KEY, index.filter(e => e.id !== id));
}

function extractId(req) {
  const path = new URL(req.url).pathname;
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf('crm');
  if (idx < 0 || idx === parts.length - 1) return null;
  return decodeURIComponent(parts[idx + 1]);
}

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  const id = extractId(req);
  const method = req.method;

  // === LIST ===
  if (method === 'GET' && !id) {
    const index = await getIndex();
    return jsonResponse(200, index);
  }

  // === GET ONE ===
  if (method === 'GET' && id) {
    const p = await readJson(prospectKey(id), null);
    if (!p) return jsonResponse(404, { error: 'not_found' });
    return jsonResponse(200, p);
  }

  // === PUT (create or replace) ===
  if (method === 'PUT' && id) {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) {
      return jsonResponse(400, { error: 'expected_object' });
    }

    const now = new Date().toISOString();
    const existing = await readJson(prospectKey(id), null);

    const prospect = { ...parsed.body, id };

    // Sanitize fichesIds (toujours un tableau de strings)
    if (!Array.isArray(prospect.fichesIds)) prospect.fichesIds = [];
    prospect.fichesIds = prospect.fichesIds.filter(x => typeof x === 'string');

    prospect.updated_at = now;
    prospect.updated_by = auth.nom;
    if (existing) {
      prospect.created_at = existing.created_at || now;
      prospect.created_by = existing.created_by || auth.nom;
    } else {
      prospect.created_at = now;
      prospect.created_by = auth.nom;
    }

    await writeJson(prospectKey(id), prospect);
    await upsertIndex(buildIndexEntry(prospect));

    return jsonResponse(existing ? 200 : 201, prospect);
  }

  // === DELETE ===
  if (method === 'DELETE' && id) {
    const existing = await readJson(prospectKey(id), null);
    if (!existing) return jsonResponse(404, { error: 'not_found' });
    await deleteKey(prospectKey(id));
    await removeFromIndex(id);
    return jsonResponse(200, { ok: true });
  }

  return methodNotAllowed(['GET', 'PUT', 'DELETE']);
};
