// Private Expense Radar: key derivation (known answers checked against Python's hashlib), wrapping, sealing,
// merge, and the server rules. Server tests need a throwaway Postgres: ER_TEST_DATABASE_URL=postgres://... (skipped without).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../apps/er-personal/vault.js';

test('passphrase keys: known answer (PBKDF2-SHA256 600k, then HKDF "er-login-v1")', async () => {
  const k = await V.passKeys('correct horse battery staple', 'AAAAAAAAAAAAAAAAAAAAAA==', 600000);
  assert.equal(k.login, 'Chl9tHC+aM/Ms7ezTFQWSk23gzukiv9LnbeOuf76G8g=');
});
test('recovery keys: known answer, and spacing or case does not matter', async () => {
  const a = await V.recoveryKeys('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345');
  const b = await V.recoveryKeys('abcd efgh jklm npqr stuv wxyz 2345');
  assert.equal(a.login, 'US6/X7ffVQiRS9L7N/rjDY3BxgGMQH0OOl4xNNlC/ts=');
  assert.equal(b.login, a.login);
});
test('recovery code: 28 characters from a 32-letter alphabet (140 bits), grouped by 4', () => {
  const c = V.newRecoveryCode();
  assert.match(c, /^([A-HJ-NP-Z2-9]{4}-){6}[A-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(V.newRecoveryCode(), c);
});
test('the login key cannot unwrap: wrap and login keys are different', async () => {
  const k = await V.passKeys('lamp river seven orange', V.b64(new Uint8Array(16).fill(7)));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const w = await V.wrapKey(raw, k.wrap);
  assert.equal(w.length, 80);
  assert.deepEqual(await V.unwrapRaw(w, k.wrap), raw);
  const other = await V.passKeys('lamp river seven oranges', V.b64(new Uint8Array(16).fill(7)));
  await assert.rejects(V.unwrapRaw(w, other.wrap));
  assert.notEqual(k.login, other.login);
});
test('sealed data is bound to its version: relabelled or changed bytes are refused', async () => {
  const dek = await V.importDek(crypto.getRandomValues(new Uint8Array(32)));
  const data = { version: 1, currency: 'EUR', transactions: [{ id: 't1', date: '2026-11-17', payee: 'Café', amount: -350, category: 'Eating out', note: 'é ü 😀' }], budgets: {}, subscriptions: [] };
  const s = await V.seal(data, dek, V.dataLabel(5));
  assert.deepEqual(await V.open(s, dek, V.dataLabel(5)), data);
  await assert.rejects(V.open(s, dek, V.dataLabel(6)));
  const bytes = V.unb64(s); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(V.open(V.b64(bytes), dek, V.dataLabel(5)));
  const big = { ...data, transactions: Array.from({ length: 20000 }, (_, i) => ({ id: 't' + i, date: '2026-01-01', payee: 'Shop ' + (i % 50), amount: -i, category: 'Groceries', note: '' })) };
  assert.ok((await V.seal(big, dek, 'x')).length < 1_000_000, 'compressed before encryption');
});

const T = (id, amount) => ({ id, date: '2026-11-01', payee: id, amount, category: 'Groceries', note: '' });
test('merge: changes made here go on top of the server copy; nothing from either side disappears', () => {
  const base = { currency: 'EUR', transactions: [T('a', -1), T('b', -2), T('c', -3)], budgets: { Groceries: 100 }, subscriptions: [], dismissed: ['x'] };
  const local = { currency: 'EUR', transactions: [T('a', -10), T('c', -3), T('d', -4)], budgets: { Groceries: 100, Shopping: 50 }, subscriptions: [], dismissed: ['x', 'y'] };
  const remote = { currency: 'EUR', transactions: [T('a', -1), T('b', -2), T('c', -30), T('e', -5)], budgets: { Groceries: 120 }, subscriptions: [], dismissed: ['x', 'z'] };
  const m = V.mergeData(base, local, remote);
  const byId = Object.fromEntries(m.transactions.map(t => [t.id, t.amount]));
  assert.deepEqual(byId, { a: -10, c: -30, d: -4, e: -5 }); // a changed here, b deleted here, c changed there, d added here, e added there
  assert.deepEqual(m.budgets, { Groceries: 120, Shopping: 50 });
  assert.deepEqual(m.dismissed.sort(), ['x', 'y', 'z']);
  assert.deepEqual(V.mergeData(null, local, remote), local);
  assert.deepEqual(V.mergeData(base, base, remote), remote);
});

// ---------- server ----------
const DB = process.env.ER_TEST_DATABASE_URL;
test('server rules (single owner, limits, compare-and-set, delete everything)', { skip: !DB && 'set ER_TEST_DATABASE_URL to run' }, async () => {
  const ORIGIN = 'https://er.example.test';
  Object.assign(process.env, { ER_DATABASE_URL: DB, ER_DATABASE_SSL: 'off', ER_SESSION_SECRET: 'test-only-secret-'.padEnd(48, 'x'), ER_PUBLIC_ORIGIN: ORIGIN, ER_SETUP_CODE: 'a long setup sentence for tests' });
  const S = await import('../apps/er-personal/api/_er/server.js');
  const pg = (await import('postgres')).default(DB, { onnotice: () => {} });
  await pg.unsafe('drop table if exists er_owner, er_session, er_blob, er_attempt');
  let jar = '';
  const call = async (method, path, body, ip = '1.1.1.1', extra = {}) => {
    const r = await S.handle({ method, path: path.split('/').filter(Boolean), headers: { origin: ORIGIN, cookie: jar, ...extra }, body: body ?? {}, ip });
    if (r.cookies) jar = r.cookies[0].split(';')[0];
    return r;
  };
  const salt = V.b64(crypto.getRandomValues(new Uint8Array(16)));
  const pk = await V.passKeys('lamp river seven orange', salt); const rk = await V.recoveryKeys('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const setup = { salt, iter: V.ITER, key: pk.login, rkey: rk.login, wrapped: await V.wrapKey(raw, pk.wrap), rwrapped: await V.wrapKey(raw, rk.wrap) };

  assert.equal((await call('GET', 'state')).body.owner, false);
  assert.equal((await call('POST', 'setup', { ...setup, code: 'wrong' })).status, 403);
  assert.equal((await call('POST', 'setup', { ...setup, code: process.env.ER_SETUP_CODE }, '1.1.1.1', { origin: 'https://evil.example' })).status, 403, 'other origin refused');
  assert.equal((await call('POST', 'setup', { ...setup, iter: 1000, code: process.env.ER_SETUP_CODE })).status, 400, 'weak iteration count refused');
  assert.equal((await call('POST', 'setup', { ...setup, code: process.env.ER_SETUP_CODE })).status, 200);
  assert.match(jar, /^er_session=/);
  assert.equal((await call('POST', 'setup', { ...setup, code: process.env.ER_SETUP_CODE })).status, 404, 'setup closed once the owner exists');

  // compare-and-set
  const dek = await V.importDek(raw);
  const v1 = await V.seal({ n: 1 }, dek, V.dataLabel(1));
  assert.equal((await call('POST', 'data', { base: 0, blob: v1 })).body.version, 1);
  const stale = await call('POST', 'data', { base: 0, blob: v1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.version, 1);
  for (let i = 2; i <= 40; i++) assert.equal((await call('POST', 'data', { base: i - 1, blob: await V.seal({ n: i }, dek, V.dataLabel(i)) })).status, 200);
  const vers = (await call('GET', 'versions')).body.versions;
  assert.equal(vers.length, 30, 'last 30 kept (all saves are from today, so the daily copy is the newest)');
  const latest = await call('GET', 'data');
  assert.deepEqual(await V.open(latest.body.blob, dek, V.dataLabel(latest.body.version)), { n: 40 });

  // limits: 5 wrong tries lock that address only; the owner's session keeps working
  const savedJar = jar; jar = '';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', 'login', { method: 'pass', key: rk.login }, '6.6.6.6')).status, 403);
  assert.equal((await call('POST', 'login', { method: 'pass', key: pk.login }, '6.6.6.6')).status, 429);
  const ok = await call('POST', 'login', { method: 'pass', key: pk.login }, '2.2.2.2');
  assert.equal(ok.status, 200); assert.equal(ok.body.wrapped, setup.wrapped);
  assert.deepEqual(await V.unwrapRaw(ok.body.wrapped, pk.wrap), raw);
  jar = savedJar; assert.equal((await call('GET', 'data')).status, 200, 'older session still valid');

  // recovery login returns the recovery-wrapped key; sign out everywhere ends every session
  jar = ''; const rec = await call('POST', 'login', { method: 'recovery', key: rk.login }, '3.3.3.3');
  assert.equal(rec.body.wrapped, setup.rwrapped);
  assert.equal((await call('POST', 'logout-all', {})).status, 200);
  jar = savedJar; assert.equal((await call('GET', 'data')).status, 401);

  // new passphrase via the recovery proof
  jar = ''; await call('POST', 'login', { method: 'pass', key: pk.login }, '4.4.4.4');
  const salt2 = V.b64(crypto.getRandomValues(new Uint8Array(16))); const pk2 = await V.passKeys('a whole new passphrase here', salt2);
  assert.equal((await call('POST', 'rekey', { method: 'recovery', proof: rk.login, salt: salt2, iter: V.ITER, key: pk2.login, wrapped: await V.wrapKey(raw, pk2.wrap) }, '4.4.4.4')).status, 200);
  assert.equal((await call('POST', 'login', { method: 'pass', key: pk.login }, '5.5.5.5')).status, 403, 'old passphrase no longer works');

  // delete everything needs the passphrase key, checked by the server
  assert.equal((await call('POST', 'delete-all', { key: pk.login }, '7.7.7.7')).status, 403);
  assert.equal((await call('POST', 'delete-all', { key: pk2.login }, '7.7.7.8')).status, 200);
  const [{ n }] = await pg`select (select count(*) from er_blob) + (select count(*) from er_owner) + (select count(*) from er_session) as n`;
  assert.equal(Number(n), 0);
  assert.equal((await call('GET', 'state')).body.owner, false);
  await pg.end(); await S.closeDb();
});
