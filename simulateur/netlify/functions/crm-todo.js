// CRUD notes & tâches manuelles de la semaine (CRM)
//   GET  /api/crm-todo  → renvoie le tableau [{ id, text, done }]
//   PUT  /api/crm-todo  → remplace le tableau (last-write-wins)
//
// Stockage : 1 blob unique sous la clé `crm/todo-manual`.

import {
  requireAuth, readJsonBody, jsonResponse, methodNotAllowed
} from '../lib/auth-guard.js';
import { readJson, writeJson } from '../lib/blobs.js';

const KEY = 'crm/todo-manual';

export default async (req) => {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;

  if (req.method === 'GET') {
    return jsonResponse(200, (await readJson(KEY, [])) || []);
  }

  if (req.method === 'PUT') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!Array.isArray(body)) return jsonResponse(400, { error: 'expected_array' });
    const sanitized = body
      .filter(it => it && typeof it === 'object' && typeof it.text === 'string')
      .map(it => ({
        id: typeof it.id === 'string' ? it.id : ('t_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        text: it.text,
        done: !!it.done
      }));
    await writeJson(KEY, sanitized);
    return jsonResponse(200, sanitized);
  }

  return methodNotAllowed(['GET', 'PUT']);
};
