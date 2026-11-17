// Command Center server tests: sign-up and sign-in, attempt limits, saving, copying a local
// workspace, and cross-workspace isolation on every endpoint and table.
// Needs a throwaway Postgres: CC_DATABASE_URL=postgres://... CC_DATABASE_SSL=off node --test tests/cc-api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { seed } from '../projects/command-center/seed.js';

const URL_ = process.env.CC_DATABASE_URL;
const skip = !URL_ && 'set CC_DATABASE_URL to a throwaway database to run these tests';
process.env.CC_SESSION_SECRET ||= 'test-secret-'.padEnd(48, 'x');
process.env.CC_PREVIEW_MAILBOX = '1';
process.env.CC_ENV = 'preview';

const HOST = 'cc.test';
let handle, closeForTests, admin;
const ipOf = n => '10.0.0.' + n;

async function call(method, path, { body, cookie, ip = ipOf(1), origin = 'https://' + HOST, query } = {}) {
  const headers = { host: HOST };
  if (method === 'POST') { headers.origin = origin; headers['content-type'] = 'application/json'; }
  if (cookie) headers.cookie = cookie;
  const r = await handle({ method, path: path.split('/').filter(Boolean), headers, body: body ?? {}, ip, query, secure: true });
  const set = (r.cookies || []).find(c => c.startsWith('cc_session='));
  return { status: r.status, body: r.body, cookie: set ? set.split(';')[0] : undefined };
}

async function lastLink(email) {
  const r = await call('GET', '/dev/mailbox', { query: { email } });
  const m = r.body.mails[0];
  return m && /#\/verify\/([A-Za-z0-9_-]+)/.exec(m.body)?.[1];
}

let n = 0;
async function account(name = 'Alex Test') {
  const email = 'person' + (++n) + '@example.test';
  const s = await call('POST', '/auth/signup', { body: { email, password: 'correct horse 1', displayName: name, privacyAck: true }, ip: ipOf(100 + n) });
  assert.equal(s.status, 200);
  const v = await call('POST', '/auth/verify', { body: { token: await lastLink(email) } });
  assert.equal(v.status, 200);
  const me = await call('GET', '/me', { cookie: v.cookie });
  return { email, cookie: v.cookie, ws: me.body.workspaces[0].id };
}

const ops = data => ['project', 'milestone', 'task', 'risk'].flatMap(type => data[type + 's'].map(doc => ({ type, op: 'put', id: doc.id, doc })));

test('Command Center server', { skip }, async t => {
  admin = postgres(URL_, { onnotice: () => {} });
  await admin.unsafe(`drop table if exists cc_event, cc_setting, cc_invite, cc_activity, cc_risk, cc_task_dep, cc_task, cc_milestone, cc_project, cc_membership, cc_workspace, cc_outbox, cc_attempt, cc_token, cc_session, cc_user, cc_migration cascade; drop function if exists cc_is_member(uuid);`);
  ({ handle } = await import('../api/_cc/server.js'));
  ({ closeForTests } = await import('../api/_cc/db.js'));
  t.after(async () => { await closeForTests(); await admin.end(); });

  await t.test('fails closed without a database address', async () => {
    const saved = process.env.CC_DATABASE_URL; delete process.env.CC_DATABASE_URL;
    const r = await call('GET', '/me'); assert.equal(r.status, 503);
    process.env.CC_DATABASE_URL = saved;
  });

  await t.test('sign-up needs the privacy box, a valid email and a 10-character password', async () => {
    const r = await call('POST', '/auth/signup', { body: { email: 'bad', password: 'short', displayName: '', privacyAck: false } });
    assert.equal(r.status, 422);
    assert.deepEqual(Object.keys(r.body.errors).sort(), ['displayName', 'email', 'password', 'privacyAck']);
    const [{ c }] = await admin`select count(*)::int as c from cc_user`; assert.equal(c, 0);
  });

  await t.test('sign up, confirm by link, private workspace created, password stored hashed', async () => {
    const a = await account('Lina Test');
    const me = await call('GET', '/me', { cookie: a.cookie });
    assert.equal(me.body.user.displayName, 'Lina Test');
    assert.equal(me.body.workspaces.length, 1);
    assert.equal(me.body.workspaces[0].role, 'owner');
    const [u] = await admin`select password_hash from cc_user where email = ${a.email}`;
    assert.match(u.password_hash, /^scrypt\$/); assert.ok(!u.password_hash.includes('correct horse'));
    const [s] = await admin`select id from cc_session limit 1`; assert.equal(s.id.length, 64); // only a keyed hash is stored
  });

  await t.test('a confirmation link works once', async () => {
    const email = 'once@example.test';
    await call('POST', '/auth/signup', { body: { email, password: 'correct horse 1', displayName: 'Once', privacyAck: true }, ip: ipOf(7) });
    const token = await lastLink(email);
    assert.equal((await call('POST', '/auth/verify', { body: { token } })).status, 200);
    assert.equal((await call('POST', '/auth/verify', { body: { token } })).status, 400);
  });

  await t.test('sign-in before confirming is refused; sign-up does not reveal known addresses', async () => {
    const email = 'later@example.test';
    await call('POST', '/auth/signup', { body: { email, password: 'correct horse 1', displayName: 'Later', privacyAck: true }, ip: ipOf(8) });
    const r = await call('POST', '/auth/signin', { body: { email, password: 'correct horse 1' } });
    assert.equal(r.status, 403); assert.equal(r.body.unverified, true);
    const again = await call('POST', '/auth/signup', { body: { email, password: 'other password 2', displayName: 'X', privacyAck: true }, ip: ipOf(8) });
    assert.equal(again.status, 200); assert.deepEqual(again.body, { ok: true });
  });

  await t.test('five wrong passwords trigger the limit, even with the right one after', async () => {
    const a = await account();
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/signin', { body: { email: a.email, password: 'wrong password!' } })).status, 401);
    assert.equal((await call('POST', '/auth/signin', { body: { email: a.email, password: 'correct horse 1' } })).status, 429);
  });

  await t.test('sign in and out; the old cookie stops working', async () => {
    const a = await account();
    const s = await call('POST', '/auth/signin', { body: { email: a.email, password: 'correct horse 1' } });
    assert.equal(s.status, 200); assert.ok(s.cookie);
    assert.equal((await call('GET', '/me', { cookie: s.cookie })).body.user.email, a.email);
    await call('POST', '/auth/signout', { cookie: s.cookie });
    assert.equal((await call('GET', '/me', { cookie: s.cookie })).body.user, null);
    assert.equal((await call('GET', '/workspaces/' + a.ws, { cookie: s.cookie })).status, 401);
  });

  await t.test('changes from another site or without JSON are refused', async () => {
    const a = await account();
    assert.equal((await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, origin: 'https://evil.test', body: { version: 0, ops: [] } })).status, 403);
    const r = await handle({ method: 'POST', path: ['auth', 'signin'], headers: { host: HOST, origin: 'https://' + HOST, 'content-type': 'text/plain' }, body: {}, ip: '1' });
    assert.equal(r.status, 415);
  });

  await t.test('saved on the server: survives a new session, history written by the server', async () => {
    const a = await account('Sam Saver');
    const d = seed('2026-11-17');
    const r = await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, body: { version: 0, ops: ops(d) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.tasks.length, d.tasks.length);
    const t1 = r.body.data.tasks.find(x => x.id === 't-a4');
    const moved = await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, body: { version: r.body.version, ops: [{ type: 'task', op: 'put', id: t1.id, doc: { ...t1, status: 'In progress', history: [{ field: 'forged' }] } }] } });
    assert.equal(moved.status, 200);
    const s = await call('POST', '/auth/signin', { body: { email: a.email, password: 'correct horse 1' }, ip: ipOf(55) });
    const again = await call('GET', '/workspaces/' + a.ws, { cookie: s.cookie });
    const t2 = again.body.data.tasks.find(x => x.id === 't-a4');
    assert.equal(t2.status, 'In progress');
    assert.deepEqual(t2.history.map(h => [h.field, h.from, h.to, h.by]), [['Created', '', 'ATL-4', 'Sam Saver'], ['Status', 'To do', 'In progress', 'Sam Saver']]);
  });

  await t.test('the server applies the same rules as the browser', async () => {
    const a = await account();
    const d = seed('2026-11-17');
    let r = await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, body: { version: 0, ops: ops(d) } });
    let v = r.body.version;
    const bad = async (doc, why) => { const x = await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, body: { version: v, ops: [{ type: 'task', op: 'put', id: doc.id, doc }] } }); assert.equal(x.status, 422, why); };
    const t4 = r.body.data.tasks.find(x => x.id === 't-a4');
    await bad({ ...t4, status: 'On hold', holdReason: '' }, 'on hold needs a reason');
    await bad({ ...t4, title: 'x'.repeat(101) }, 'title too long');
    await bad({ ...t4, deps: [t4.id] }, 'depends on itself');
    const t5 = r.body.data.tasks.find(x => x.deps.includes('t-a4'));
    await bad({ ...t4, deps: [t5.id] }, 'loop');
    await bad({ ...t4, comments: [{ id: 'c-x', text: '' }] }, 'empty comment');
    const withC = { ...t4, comments: [{ id: 'c-1', text: 'Hello', by: 'Somebody Else', at: '1999-01-01T00:00' }] };
    r = await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, body: { version: v, ops: [{ type: 'task', op: 'put', id: t4.id, doc: withC }] } });
    assert.equal(r.status, 200); v = r.body.version;
    const c = r.body.data.tasks.find(x => x.id === 't-a4').comments[0];
    assert.notEqual(c.by, 'Somebody Else'); assert.notEqual(c.at, '1999-01-01T00:00');
    await bad({ ...r.body.data.tasks.find(x => x.id === 't-a4'), comments: [] }, 'comments cannot be removed');
    const stale = await call('POST', '/workspaces/' + a.ws + '/sync', { cookie: a.cookie, body: { version: v - 1, ops: [] } });
    assert.equal(stale.status, 409); assert.ok(stale.body.workspace);
  });

  await t.test('copy a local workspace into the account: complete, history kept; broken ones refused', async () => {
    const a = await account();
    const d = seed('2026-11-17');
    const r = await call('POST', '/workspaces/import', { cookie: a.cookie, body: { name: 'From this browser', data: d, isSample: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const w = await call('GET', '/workspaces/' + r.body.id, { cookie: a.cookie });
    for (const k of ['projects', 'milestones', 'tasks', 'risks']) assert.equal(w.body.data[k].length, d[k].length, k);
    const src = d.tasks.find(x => x.deps.length);
    assert.deepEqual(w.body.data.tasks.find(x => x.id === src.id).deps.sort(), [...src.deps].sort());
    assert.equal(w.body.data.tasks.find(x => x.id === 't-c2').history.length, d.tasks.find(x => x.id === 't-c2').history.length);
    assert.equal(w.body.data.filters.length, d.filters.length);
    const before = (await admin`select count(*)::int as c from cc_workspace`)[0].c;
    const broken = structuredClone(d); broken.tasks[0].deps = [broken.tasks[1].id]; broken.tasks[1].deps = [broken.tasks[0].id];
    const x = await call('POST', '/workspaces/import', { cookie: a.cookie, body: { data: broken } });
    assert.equal(x.status, 422);
    const y = await call('POST', '/workspaces/import', { cookie: a.cookie, body: { data: { projects: 'no' } } });
    assert.equal(y.status, 422);
    assert.equal((await admin`select count(*)::int as c from cc_workspace`)[0].c, before);
  });

  await t.test('isolation: person B can never read, change or list person A\'s workspace', async () => {
    const A = await account('Owner A'); const B = await account('Other B');
    const d = seed('2026-11-17');
    const r = await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: A.cookie, body: { version: 0, ops: ops(d) } });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/workspaces/' + A.ws, { cookie: B.cookie })).status, 404);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: B.cookie, body: { version: r.body.version, ops: [{ type: 'project', op: 'del', id: 'p-atlas' }] } })).status, 404);
    const meB = await call('GET', '/me', { cookie: B.cookie });
    assert.ok(!meB.body.workspaces.some(w => w.id === A.ws));
    // B writes a task into B's own workspace that points at A's project id: the composite key keeps it in B.
    const t = d.tasks.find(x => x.projectId === 'p-atlas');
    const y = await call('POST', '/workspaces/' + B.ws + '/sync', { cookie: B.cookie, body: { version: 0, ops: [{ type: 'task', op: 'put', id: t.id, doc: t }] } });
    assert.equal(y.status, 422);
    const [{ c }] = await admin`select count(*)::int as c from cc_project where workspace_id = ${A.ws}`; assert.equal(c, d.projects.length);
  });

  await t.test('isolation in the database itself: row-level security on every table', async () => {
    const A = await account(); const B = await account();
    await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: A.cookie, body: { version: 0, ops: ops(seed('2026-11-17')) } });
    const [bId] = await admin`select id from cc_user where email = ${B.email}`;
    const asB = (q) => admin.begin(async tx => { await tx`select set_config('cc.user_id', ${bId.id}, true)`; await tx.unsafe('set local role cc_app'); return tx.unsafe(q, [A.ws]); });
    for (const table of ['cc_workspace', 'cc_membership', 'cc_project', 'cc_milestone', 'cc_task', 'cc_task_dep', 'cc_risk', 'cc_activity']) {
      const col = table === 'cc_workspace' ? 'id' : 'workspace_id';
      assert.equal((await asB(`select * from ${table} where ${col} = $1`)).length, 0, table + ' readable');
      if (table !== 'cc_membership' && table !== 'cc_activity') assert.equal((await asB(`update ${table} set ${table === 'cc_workspace' ? 'name = name' : table === 'cc_task_dep' ? 'task_id = task_id' : 'doc = doc'} where ${col} = $1 returning 1`)).length, 0, table + ' changeable');
    }
    await assert.rejects(asB(`insert into cc_project (workspace_id, id, doc) values ($1, 'p-evil', '{}')`), /row-level security/);
    await assert.rejects(asB(`insert into cc_membership (workspace_id, user_id, role) select $1, '${bId.id}', 'owner'`), /permission denied/);
    await assert.rejects(asB(`select * from cc_user where $1::uuid is not null`), /permission denied/);
    await assert.rejects(asB(`select * from cc_session where $1::uuid is not null`), /permission denied/);
    await assert.rejects(asB(`update cc_workspace set created_by = null where id = $1`), /permission denied/);
  });

  await t.test('the activity log cannot be changed or deleted by the application', async () => {
    const A = await account();
    await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: A.cookie, body: { version: 0, ops: ops(seed('2026-11-17')) } });
    const [aId] = await admin`select id from cc_user where email = ${A.email}`;
    const asA = q => admin.begin(async tx => { await tx`select set_config('cc.user_id', ${aId.id}, true)`; await tx.unsafe('set local role cc_app'); return tx.unsafe(q, [A.ws]); });
    assert.ok((await asA('select * from cc_activity where workspace_id = $1')).length > 0);
    await assert.rejects(asA(`update cc_activity set field = 'x' where workspace_id = $1`), /permission denied/);
    await assert.rejects(asA(`delete from cc_activity where workspace_id = $1`), /permission denied/);
  });

  const inviteLink = async email => { const r = await call('GET', '/dev/mailbox', { query: { email } }); const m = r.body.mails.find(x => /#\/join\//.test(x.body)); return m && /#\/join\/([A-Za-z0-9_-]+)/.exec(m.body)[1]; };

  await t.test('sharing: invite by email, join with that address only, then both see and change the same work', async () => {
    const A = await account('Owner Ana'); const B = await account('Member Ben'); const C = await account('Stranger Cleo');
    const d = seed('2026-11-17');
    const s0 = await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: A.cookie, body: { version: 0, ops: ops(d) } });
    // A member cannot invite before joining; a non-member does not even see the workspace.
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: B.cookie, body: { email: C.email } })).status, 404);
    const inv = await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: A.cookie, body: { email: B.email, role: 'member' } });
    assert.equal(inv.status, 200);
    const token = await inviteLink(B.email); assert.ok(token);
    assert.equal((await admin`select count(*)::int as c from cc_invite where id = ${token}`)[0].c, 0, 'only a hash of the token is stored');
    const peek = await call('GET', '/invites/' + token);
    assert.equal(peek.body.workspace, "Owner's workspace"); assert.equal(peek.body.invitedBy, 'Owner Ana');
    // The link is bound to B's address: C cannot use it.
    const wrong = await call('POST', '/invites/accept', { cookie: C.cookie, body: { token } });
    assert.equal(wrong.status, 422); assert.ok(wrong.body.wrongEmail);
    const ok = await call('POST', '/invites/accept', { cookie: B.cookie, body: { token } });
    assert.equal(ok.status, 200); assert.equal(ok.body.id, A.ws);
    assert.equal((await call('POST', '/invites/accept', { cookie: B.cookie, body: { token } })).status, 422, 'a link works once');
    // B now reads and changes the same workspace; A sees the change and who made it.
    const wsB = await call('GET', '/workspaces/' + A.ws, { cookie: B.cookie }); assert.equal(wsB.status, 200);
    const t1 = { ...wsB.body.data.tasks.find(x => x.id === 't-a4') }; delete t1.history; t1.status = 'In progress';
    const ch = await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: B.cookie, body: { version: wsB.body.version, ops: [{ type: 'task', op: 'put', id: t1.id, doc: t1 }] } });
    assert.equal(ch.status, 200);
    const wsA = await call('GET', '/workspaces/' + A.ws, { cookie: A.cookie });
    const h = wsA.body.data.tasks.find(x => x.id === 't-a4').history.at(-1);
    assert.equal(h.by, 'Member Ben'); assert.equal(h.to, 'In progress');
    // A stale version from A is refused with the latest copy, never silently overwritten.
    const stale = await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: A.cookie, body: { version: s0.body.version, ops: [{ type: 'task', op: 'del', id: 't-a4' }] } });
    assert.equal(stale.status, 409); assert.ok(stale.body.workspace);
    // Members see names and roles, not email addresses; the owner sees addresses.
    const mB = await call('GET', '/workspaces/' + A.ws + '/members', { cookie: B.cookie });
    assert.equal(mB.body.members.length, 2); assert.ok(mB.body.members.every(x => !('email' in x))); assert.equal(mB.body.invites.length, 0);
    const mA = await call('GET', '/workspaces/' + A.ws + '/members', { cookie: A.cookie });
    assert.ok(mA.body.members.every(x => x.email));
    // C still cannot see it.
    assert.equal((await call('GET', '/workspaces/' + A.ws, { cookie: C.cookie })).status, 404);
  });

  await t.test('sharing: roles decide who can invite, rename, remove and delete; anyone but the owner can leave', async () => {
    const A = await account('Owner'); const B = await account('Admin'); const M = await account('Member'); const X = await account('Extra');
    const join = async (P, role) => { await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: A.cookie, body: { email: P.email, role } }); return call('POST', '/invites/accept', { cookie: P.cookie, body: { token: await inviteLink(P.email) } }); };
    assert.equal((await join(B, 'admin')).status, 200);
    assert.equal((await join(M, 'member')).status, 200);
    const ids = Object.fromEntries((await call('GET', '/workspaces/' + A.ws + '/members', { cookie: A.cookie })).body.members.map(x => [x.name, x.id]));
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: M.cookie, body: { email: X.email } })).status, 403, 'a member cannot invite');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: B.cookie, body: { email: X.email, role: 'admin' } })).status, 422, 'an admin cannot invite an admin');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: B.cookie, body: { email: X.email, role: 'member' } })).status, 200);
    const pending = (await call('GET', '/workspaces/' + A.ws + '/members', { cookie: B.cookie })).body.invites;
    assert.equal(pending.length, 1);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/invites/' + pending[0].id + '/cancel', { cookie: B.cookie })).status, 200);
    assert.equal((await call('POST', '/invites/accept', { cookie: X.cookie, body: { token: await inviteLink(X.email) } })).status, 422, 'a cancelled invitation does not work');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/rename', { cookie: M.cookie, body: { name: 'Mine now' } })).status, 403);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/rename', { cookie: B.cookie, body: { name: 'Team space' } })).status, 200);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/members/' + ids.Owner + '/remove', { cookie: B.cookie })).status, 403, 'nobody removes the owner');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/members/' + ids.Member + '/role', { cookie: B.cookie, body: { role: 'admin' } })).status, 403, 'only the owner changes roles');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/delete', { cookie: B.cookie, body: { confirm: 'Team space' } })).status, 403);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/leave', { cookie: A.cookie })).status, 422, 'the owner cannot leave');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/members/' + ids.Member + '/remove', { cookie: B.cookie })).status, 200);
    assert.equal((await call('GET', '/workspaces/' + A.ws, { cookie: M.cookie })).status, 404, 'removed means no access');
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/leave', { cookie: B.cookie })).status, 200);
    assert.equal((await call('GET', '/workspaces/' + A.ws, { cookie: B.cookie })).status, 404);
    const extra = await call('POST', '/workspaces', { cookie: A.cookie, body: { name: 'Second' } }); assert.equal(extra.status, 200);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/delete', { cookie: A.cookie, body: { confirm: 'wrong' } })).status, 422);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/delete', { cookie: A.cookie, body: { confirm: 'Team space' } })).status, 200);
    assert.equal((await admin`select count(*)::int as c from cc_workspace where id = ${A.ws}`)[0].c, 0);
  });

  await t.test('your data: download everything, delete the account with the password', async () => {
    const A = await account('Leaving Lou'); const B = await account('Staying Sam');
    await call('POST', '/workspaces/' + A.ws + '/sync', { cookie: A.cookie, body: { version: 0, ops: ops(seed('2026-11-17')) } });
    const shared = (await call('POST', '/workspaces', { cookie: A.cookie, body: { name: 'Shared one' } })).body.id;
    await call('POST', '/workspaces/' + shared + '/invites', { cookie: A.cookie, body: { email: B.email } });
    await call('POST', '/invites/accept', { cookie: B.cookie, body: { token: await inviteLink(B.email) } });
    const ex = await call('GET', '/account/export', { cookie: A.cookie });
    assert.equal(ex.status, 200); assert.equal(ex.body.account.email, A.email); assert.equal(ex.body.workspaces.length, 2);
    assert.ok(!JSON.stringify(ex.body).includes('scrypt'), 'no password hash in the download');
    assert.equal((await call('POST', '/account/delete', { cookie: A.cookie, body: { password: 'wrong one here' } })).status, 422);
    const del = await call('POST', '/account/delete', { cookie: A.cookie, body: { password: 'correct horse 1' } });
    assert.equal(del.status, 200);
    assert.equal((await admin`select count(*)::int as c from cc_user where email = ${A.email}`)[0].c, 0);
    assert.equal((await admin`select count(*)::int as c from cc_workspace where id = ${A.ws}`)[0].c, 0, 'the private workspace is gone');
    const meB = await call('GET', '/me', { cookie: B.cookie });
    assert.equal(meB.body.workspaces.find(w => w.id === shared).role, 'owner', 'the shared one goes on with the other person as owner');
    assert.equal((await call('GET', '/me', { cookie: A.cookie })).body.user, null, 'signed out everywhere');
  });

  const linkOf = async (email, kind) => { const r = await call('GET', '/dev/mailbox', { query: { email } }); for (const m of r.body.mails) { const x = new RegExp('#/' + kind + '/([A-Za-z0-9_-]+)').exec(m.body); if (x) return x[1]; } return null; };

  await t.test('forgot password: a one-hour link, one use, every device signed out, same answer for unknown addresses', async () => {
    const A = await account('Forgetful Fay');
    const other = await call('POST', '/auth/signin', { body: { email: A.email, password: 'correct horse 1' }, ip: ipOf(60) });
    assert.equal((await call('POST', '/auth/forgot', { body: { email: 'nobody@example.test' } })).status, 200);
    assert.equal((await call('POST', '/auth/forgot', { body: { email: A.email } })).status, 200);
    const token = await linkOf(A.email, 'reset'); assert.ok(token);
    assert.equal((await call('POST', '/auth/reset', { body: { token, password: 'short' } })).status, 422);
    const r = await call('POST', '/auth/reset', { body: { token, password: 'a brand new one 2' } });
    assert.equal(r.status, 200); assert.ok(r.cookie);
    assert.equal((await call('POST', '/auth/reset', { body: { token, password: 'a brand new one 3' } })).status, 400, 'a link works once');
    assert.equal((await call('GET', '/me', { cookie: A.cookie })).body.user, null, 'old sessions are gone');
    assert.equal((await call('GET', '/me', { cookie: other.cookie })).body.user, null);
    assert.equal((await call('POST', '/auth/signin', { body: { email: A.email, password: 'a brand new one 2' }, ip: ipOf(61) })).status, 200);
    for (let i = 0; i < 3; i++) await call('POST', '/auth/forgot', { body: { email: A.email } });
    assert.equal((await call('POST', '/auth/forgot', { body: { email: A.email } })).status, 429);
  });

  await t.test('your account: change name, password and email; sign out everywhere', async () => {
    const A = await account('Changing Cleo');
    const second = await call('POST', '/auth/signin', { body: { email: A.email, password: 'correct horse 1' }, ip: ipOf(62) });
    assert.equal((await call('GET', '/me', { cookie: A.cookie })).body.user.devices, 2);
    assert.equal((await call('POST', '/account/name', { cookie: A.cookie, body: { displayName: 'Cleo C.' } })).status, 200);
    assert.equal((await call('POST', '/account/password', { cookie: A.cookie, body: { password: 'wrong wrong 1', next: 'another good one' } })).status, 422);
    assert.equal((await call('POST', '/account/password', { cookie: A.cookie, body: { password: 'correct horse 1', next: 'another good one' } })).status, 200);
    assert.ok((await call('GET', '/me', { cookie: A.cookie })).body.user, 'this device stays signed in');
    assert.equal((await call('GET', '/me', { cookie: second.cookie })).body.user, null, 'the other device is signed out');
    const B = await account('Taken Tom');
    assert.equal((await call('POST', '/account/email', { cookie: A.cookie, body: { password: 'another good one', email: B.email } })).status, 200, 'same answer for a taken address');
    assert.equal(await linkOf(B.email, 'email'), null, 'no change link to a taken address');
    const fresh = 'moved' + Date.now() + '@example.test';
    assert.equal((await call('POST', '/account/email', { cookie: A.cookie, body: { password: 'another good one', email: fresh } })).status, 200);
    const tok = await linkOf(fresh, 'email'); assert.ok(tok);
    assert.equal((await call('POST', '/auth/confirm-email', { body: { token: tok } })).status, 200);
    const me = await call('GET', '/me', { cookie: A.cookie });
    assert.equal(me.body.user.email, fresh); assert.equal(me.body.user.displayName, 'Cleo C.');
    assert.equal((await call('POST', '/account/signout-all', { cookie: A.cookie })).status, 200);
    assert.equal((await call('GET', '/me', { cookie: A.cookie })).body.user, null);
  });

  await t.test('handing a workspace over needs the password; the old owner stays as admin', async () => {
    const A = await account('Owner Olga'); const B = await account('Next Nils');
    await call('POST', '/workspaces/' + A.ws + '/invites', { cookie: A.cookie, body: { email: B.email } });
    await call('POST', '/invites/accept', { cookie: B.cookie, body: { token: await inviteLink(B.email) } });
    const bId = (await admin`select id from cc_user where email = ${B.email}`)[0].id;
    const aId = (await admin`select id from cc_user where email = ${A.email}`)[0].id;
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/members/' + aId + '/owner', { cookie: B.cookie, body: { password: 'correct horse 1' } })).status, 403);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/members/' + bId + '/owner', { cookie: A.cookie, body: { password: 'nope nope nope' } })).status, 422);
    assert.equal((await call('POST', '/workspaces/' + A.ws + '/members/' + bId + '/owner', { cookie: A.cookie, body: { password: 'correct horse 1' } })).status, 200);
    const roles = await admin`select u.email, m.role from cc_membership m join cc_user u on u.id = m.user_id where m.workspace_id = ${A.ws}`;
    assert.equal(roles.find(r => r.email === B.email).role, 'owner'); assert.equal(roles.find(r => r.email === A.email).role, 'admin');
  });

  await t.test('admin area: only the admin, facts not content, pause, sign-up modes, limits, delete, log', async () => {
    const Ad = await account('Admin Ada'); const U = await account('User Uma');
    process.env.CC_ADMIN_EMAILS = Ad.email;
    assert.equal((await call('GET', '/admin/overview', { cookie: U.cookie })).status, 404, 'hidden from everyone else');
    assert.equal((await call('GET', '/me', { cookie: Ad.cookie })).body.user.admin, true);
    await call('POST', '/workspaces/' + U.ws + '/sync', { cookie: U.cookie, body: { version: 0, ops: ops(seed('2026-11-17')) } });
    const o = await call('GET', '/admin/overview', { cookie: Ad.cookie });
    assert.equal(o.status, 200); assert.ok(o.body.counts.accounts >= 2);
    const row = o.body.workspaces.find(w => w.id === U.ws); assert.ok(row.tasks > 0);
    assert.ok(!JSON.stringify(o.body).includes('Connect finance feed'), 'no task content in the admin area');
    assert.ok(!JSON.stringify(o.body).includes('scrypt'));
    const uId = o.body.users.find(x => x.email === U.email).id;
    assert.equal((await call('POST', '/admin/users/' + o.body.you + '/pause', { cookie: Ad.cookie })).status, 422, 'not on yourself');
    assert.equal((await call('POST', '/admin/users/' + uId + '/pause', { cookie: Ad.cookie })).status, 200);
    assert.equal((await call('GET', '/me', { cookie: U.cookie })).body.user, null, 'a paused account is signed out');
    assert.equal((await call('POST', '/auth/signin', { body: { email: U.email, password: 'correct horse 1' }, ip: ipOf(63) })).status, 403);
    assert.equal((await call('POST', '/admin/users/' + uId + '/resume', { cookie: Ad.cookie })).status, 200);
    const back = await call('POST', '/auth/signin', { body: { email: U.email, password: 'correct horse 1' }, ip: ipOf(64) });
    assert.equal(back.status, 200);
    assert.equal((await call('POST', '/admin/users/' + uId + '/reset', { cookie: Ad.cookie })).status, 200);
    assert.ok(await linkOf(U.email, 'reset'));
    // sign-up modes
    assert.equal((await call('POST', '/admin/settings', { cookie: Ad.cookie, body: { signup: 'closed' } })).status, 200);
    assert.equal((await call('GET', '/me')).body.signup, 'closed');
    const s1 = await call('POST', '/auth/signup', { body: { email: 'late1@example.test', password: 'correct horse 1', displayName: 'Late', privacyAck: true }, ip: ipOf(65) });
    assert.equal(s1.status, 403);
    await call('POST', '/admin/settings', { cookie: Ad.cookie, body: { signup: 'invite' } });
    assert.equal((await call('POST', '/auth/signup', { body: { email: 'late2@example.test', password: 'correct horse 1', displayName: 'Late', privacyAck: true }, ip: ipOf(66) })).status, 403);
    await call('POST', '/workspaces/' + Ad.ws + '/invites', { cookie: Ad.cookie, body: { email: 'late3@example.test' } });
    assert.equal((await call('POST', '/auth/signup', { body: { email: 'late3@example.test', password: 'correct horse 1', displayName: 'Late', privacyAck: true }, ip: ipOf(67) })).status, 200, 'an invited address can sign up');
    // limits
    assert.equal((await call('POST', '/admin/settings', { cookie: Ad.cookie, body: { maxOwned: 0 } })).status, 422);
    await call('POST', '/admin/settings', { cookie: Ad.cookie, body: { signup: 'open', maxOwned: 1 } });
    assert.equal((await call('POST', '/workspaces', { cookie: back.cookie, body: { name: 'Second' } })).status, 422);
    await call('POST', '/admin/settings', { cookie: Ad.cookie, body: { maxOwned: 20 } });
    // delete
    assert.equal((await call('POST', '/admin/users/' + uId + '/delete', { cookie: Ad.cookie, body: { confirm: 'wrong' } })).status, 422);
    assert.equal((await call('POST', '/admin/users/' + uId + '/delete', { cookie: Ad.cookie, body: { confirm: U.email } })).status, 200);
    assert.equal((await admin`select count(*)::int as c from cc_user where email = ${U.email}`)[0].c, 0);
    const log = await call('GET', '/admin/log', { cookie: Ad.cookie });
    assert.ok(log.body.events.some(e => e.kind === 'Account deleted' && e.byAdmin));
    assert.ok(!log.body.events.some(e => e.email === U.email), 'a deleted person leaves no email in the log');
    delete process.env.CC_ADMIN_EMAILS;
    assert.equal((await call('GET', '/admin/overview', { cookie: Ad.cookie })).status, 404, 'without the list, only the first recorded person');
    process.env.VERCEL_ENV = 'production';
    const first = (await admin`select value from cc_setting where key = 'admin'`)[0];
    assert.ok(first, 'on a preview the first person is recorded');
    delete process.env.VERCEL_ENV;
  });

  await t.test('the test mailbox is closed on the live site', async () => {
    process.env.VERCEL_ENV = 'production'; process.env.CC_PUBLIC_ORIGIN = 'https://' + HOST;
    assert.equal((await call('GET', '/dev/mailbox', { query: { email: 'a@b.cd' } })).status, 404);
    delete process.env.VERCEL_ENV; delete process.env.CC_PUBLIC_ORIGIN;
  });

  await t.test('another host: production unless marked; fails closed without its public address or a long secret', async () => {
    const savedEnv = process.env.CC_ENV; delete process.env.CC_ENV;
    assert.equal((await call('GET', '/me')).status, 503, 'no CC_ENV and no public address: closed');
    process.env.CC_PUBLIC_ORIGIN = 'https://' + HOST;
    assert.equal((await call('GET', '/dev/mailbox', { query: { email: 'x@example.test' } })).status, 404, 'no mailbox when not marked as a preview');
    const saved = process.env.CC_SESSION_SECRET; delete process.env.CC_SESSION_SECRET;
    assert.equal((await call('GET', '/me')).status, 503, 'no secret: closed');
    process.env.CC_SESSION_SECRET = 'short';
    assert.equal((await call('GET', '/me')).status, 503, 'a short secret is refused');
    process.env.CC_SESSION_SECRET = saved;
    const before = (await admin`select count(*)::int as c from cc_setting where key = 'admin'`)[0].c;
    await account('Prod Person').catch(() => null);
    assert.equal((await admin`select count(*)::int as c from cc_setting where key = 'admin'`)[0].c, before, 'nobody becomes admin by signing in first');
    process.env.CC_ENV = savedEnv; delete process.env.CC_PUBLIC_ORIGIN;
  });

  await t.test('with a public address set, only that exact origin may change things, and no email goes out for a forged one', async () => {
    const A = await account('Origin Test');
    process.env.CC_PUBLIC_ORIGIN = 'https://tools.example';
    const mails = async () => (await admin`select count(*)::int as c from cc_outbox where to_email = ${A.email}`)[0].c;
    const n0 = await mails();
    assert.equal((await call('POST', '/auth/forgot', { body: { email: A.email } })).status, 403, 'the request host is not trusted');
    assert.equal((await call('POST', '/auth/forgot', { body: { email: A.email }, origin: 'https://evil.test' })).status, 403);
    assert.equal(await mails(), n0, 'no email for a refused request');
    assert.equal((await call('POST', '/auth/forgot', { body: { email: A.email }, origin: 'https://tools.example' })).status, 200);
    const last = (await admin`select body from cc_outbox where to_email = ${A.email} order by id desc limit 1`)[0].body;
    assert.ok(last.includes('https://tools.example/'), 'email links use the public address');
    delete process.env.CC_PUBLIC_ORIGIN;
  });

  await t.test('off a Vercel preview, the mailbox only shows reserved test addresses', async () => {
    process.env.CC_ENV = 'preview';
    await admin`insert into cc_outbox (to_email, subject, body) values ('real@gmail.com', 'S', 'B')`;
    assert.deepEqual((await call('GET', '/dev/mailbox', { query: { email: 'real@gmail.com' } })).body.mails, []);
    process.env.VERCEL_ENV = 'preview'; delete process.env.CC_ENV; process.env.CC_PUBLIC_ORIGIN = 'https://' + HOST;
    assert.equal((await call('GET', '/dev/mailbox', { query: { email: 'x@example.test' } })).status, 404, 'Vercel preview alone does not open it: CC_ENV=preview is needed');
    process.env.CC_ENV = 'preview'; delete process.env.VERCEL_ENV; delete process.env.CC_PUBLIC_ORIGIN;
  });
});
