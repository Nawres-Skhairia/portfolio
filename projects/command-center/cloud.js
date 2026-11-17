// Command Center accounts: calls to the site's own /api/cc (same address, so no outside request)
// and the list of changes between two versions of a workspace.
const TYPES = [['project', 'projects'], ['milestone', 'milestones'], ['task', 'tasks'], ['risk', 'risks']];

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api/cc/' + path, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { return { status: 0, body: { error: 'No connection. Check your internet and try again.' } }; }
  let out = {};
  try { out = await res.json(); } catch (e) { out = { error: 'The server answered in an unexpected way.' }; }
  return { status: res.status, body: out };
}

// Changes from `before` to `after`, as the server expects them. History is written by the server.
const clean = (type, x) => { if (type !== 'task') return x; const { history, ...rest } = x; return rest; };
export function diff(before, after) {
  const ops = [];
  for (const [type, key] of TYPES) {
    const old = new Map((before[key] || []).map(x => [x.id, x]));
    const now = new Map((after[key] || []).map(x => [x.id, x]));
    for (const [id, x] of now) { const o = old.get(id); if (!o || JSON.stringify(clean(type, o)) !== JSON.stringify(clean(type, x))) ops.push({ type, op: 'put', id, doc: clean(type, x) }); }
    for (const id of old.keys()) if (!now.has(id)) ops.push({ type, op: 'del', id });
  }
  if (JSON.stringify(before.filters || []) !== JSON.stringify(after.filters || [])) ops.push({ type: 'filters', filters: after.filters || [] });
  return ops;
}
