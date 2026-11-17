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
  await admin.unsafe(`drop table if exists cc_activity, cc_risk, cc_task_dep, cc_task, cc_milestone, cc_project, cc_membership, cc_workspace, cc_outbox, cc_attempt, cc_token, cc_session, cc_user, cc_migration cascade; drop function if exists cc_is_member(uuid);`);
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

  await t.test('the test mailbox is closed on the live site', async () => {
    process.env.VERCEL_ENV = 'production';
    assert.equal((await call('GET', '/dev/mailbox', { query: { email: 'a@b.cd' } })).status, 404);
    delete process.env.VERCEL_ENV;
  });
});
