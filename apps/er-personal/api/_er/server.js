// Personal Expense Radar API: one owner, end-to-end encrypted. The server only ever stores encrypted bytes.
// The phone derives a login key and a wrapping key from the passphrase (HKDF, two labels); only the login key
// is sent, and the server keeps a scrypt hash of it. Amounts, names and notes never reach this code readable.
// Reviewed design: /mnt/project-files/portfolio/products/expense-radar-personal/ (Daniel, Noah, Victoria).
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import postgres from 'postgres';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const COOKIE = 'er_session';
const SESSION_DAYS = 90;
const KEEP_LAST = 30;          // the last 30 saves
const KEEP_DAYS = 30;          // plus the last save of each of the last 30 days
const MAX_BLOB = 4_400_000;    // base64 characters (Vercel accepts request bodies up to 4.5 MB)
const IP_TRIES = 5; const ALL_TRIES = 30; const WINDOW_MIN = 15;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// ---------- settings: all required, all Production only ----------
const origin = () => String(process.env.ER_PUBLIC_ORIGIN || '').replace(/\/+$/, '');
const secret = () => process.env.ER_SESSION_SECRET || '';
const dbUrl = () => process.env.ER_DATABASE_URL || process.env.ER_DATABASE_DATABASE_URL || '';
export const ready = () => Boolean(dbUrl()) && secret().length >= 32 && /^https?:\/\/[^/]+$/.test(origin());

// ---------- database (its own store, never the preview test database) ----------
let pooled = null; let migrated = null;
async function db() {
  if (!pooled) pooled = postgres(dbUrl(), { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, ssl: process.env.ER_DATABASE_SSL === 'off' ? false : 'require', onnotice: () => {} });
  if (!migrated) migrated = pooled.begin(async tx => {
    await tx`select pg_advisory_xact_lock(91527)`;
    await tx.unsafe(`
      create table if not exists er_owner (id int primary key default 1 check (id = 1), salt text not null, iter int not null,
        verifier text not null, rverifier text not null, wrapped text not null, rwrapped text not null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      create table if not exists er_session (token_hash text primary key, expires_at timestamptz not null);
      create table if not exists er_blob (version int primary key, blob text not null, created_at timestamptz not null default now());
      create table if not exists er_attempt (bucket text not null, at timestamptz not null default now());
      create index if not exists er_attempt_idx on er_attempt (bucket, at);`);
  }).catch(e => { migrated = null; throw e; });
  await migrated;
  return pooled;
}
export async function closeDb() { if (pooled) { await pooled.end({ timeout: 2 }); pooled = null; migrated = null; } }

// ---------- helpers ----------
const json = (status, body, extra = {}) => ({ status, body, ...extra });
const fail = (status, error, extra = {}) => json(status, { error }, extra);
const mac = (kind, s) => createHmac('sha256', secret()).update(kind + ':' + String(s)).digest('hex');
const isB64 = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max && B64.test(s);
const loginKeyOk = k => isB64(k, 44, 44);           // 32 bytes from HKDF, base64
const saltOk = s => isB64(s, 24, 24);               // 16 bytes
const wrapOk = s => isB64(s, 80, 80);               // 12-byte IV + 32-byte key + 16-byte tag
const iterOk = n => Number.isInteger(n) && n >= 600000 && n <= 5000000;
async function hashKey(key, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : randomBytes(16);
  const out = await scrypt(String(key), salt, 32, SCRYPT);
  return salt.toString('base64') + '$' + out.toString('base64');
}
async function checkKey(key, stored) {
  const [salt, want] = String(stored).split('$');
  const a = Buffer.from((await hashKey(key, salt)).split('$')[1], 'base64'); const b = Buffer.from(want || '', 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}
const sameText = (a, b) => timingSafeEqual(Buffer.from(mac('code', a), 'hex'), Buffer.from(mac('code', b), 'hex'));
function readCookie(headers) {
  for (const part of String(headers.cookie || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === COOKIE) return v.join('='); }
  return '';
}
const cookie = (value, maxAge) => COOKIE + '=' + value + '; Path=/api/er; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge;

// Attempt limits: 5 per address and 30 for everyone per 15 minutes, so one stranger cannot lock the owner out
// for long, and many addresses together cannot guess fast. Signed-in phones keep syncing during a lockout.
async function limited(sql, ip) {
  const [{ mine, all }] = await sql`select count(*) filter (where bucket = ${'ip:' + mac('ip', ip)})::int as mine, count(*)::int as all
    from er_attempt where at > now() - make_interval(mins => ${WINDOW_MIN})`;
  return mine >= IP_TRIES || all >= ALL_TRIES;
}
const noteFail = (sql, ip) => sql`insert into er_attempt (bucket) values (${'ip:' + mac('ip', ip)})`;
async function newSession(sql) {
  const token = randomBytes(32).toString('base64url');
  await sql`delete from er_session where expires_at < now()`;
  await sql`insert into er_session (token_hash, expires_at) values (${mac('session', token)}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return cookie(token, SESSION_DAYS * 86400);
}
async function signedIn(sql, headers) {
  const t = readCookie(headers); if (!t || t.length > 100) return false;
  const [row] = await sql`select 1 from er_session where token_hash = ${mac('session', t)} and expires_at > now()`;
  return Boolean(row);
}
// Keep the last 30 saves, plus the last save of each day for 30 days.
const prune = tx => tx`delete from er_blob where version <= (select max(version) from er_blob) - ${KEEP_LAST}
  and version not in (select max(version) from er_blob where created_at > now() - make_interval(days => ${KEEP_DAYS}) group by (created_at at time zone 'UTC')::date)`;

// ---------- entry point ----------
export async function handle({ method, path, headers, body, ip }) {
  if (!ready()) return fail(503, 'This private tool is not set up on this copy of the site.');
  // Writes must come from the tool's own fixed address (plus the SameSite=Strict cookie).
  if (method !== 'GET') {
    if (String(headers.origin || '') !== origin()) return fail(403, 'Refused: this request did not come from the tool itself.');
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'The request could not be read.');
  }
  const sql = await db();
  const [owner] = await sql`select salt, iter, verifier, rverifier, wrapped, rwrapped from er_owner where id = 1`;
  const route = method + ' ' + path.join('/');

  if (route === 'GET state') return json(200, { owner: Boolean(owner), salt: owner ? owner.salt : null, iter: owner ? owner.iter : null, signedIn: owner ? await signedIn(sql, headers) : false });

  if (route === 'POST setup') {
    if (owner) return fail(404, 'Not found.');
    const code = process.env.ER_SETUP_CODE || '';
    if (code.length < 20) return fail(503, 'Setup is closed on this copy of the site.');
    if (await limited(sql, ip)) return fail(429, 'Too many tries. Wait 15 minutes.');
    if (typeof body.code !== 'string' || body.code.length > 500 || !sameText(body.code, code)) { await noteFail(sql, ip); return fail(403, 'The setup code is not right.'); }
    const { salt, iter, key, rkey, wrapped, rwrapped } = body;
    if (!saltOk(salt) || !iterOk(iter) || !loginKeyOk(key) || !loginKeyOk(rkey) || !wrapOk(wrapped) || !wrapOk(rwrapped)) return fail(400, 'The setup data is not complete.');
    try {
      await sql`insert into er_owner (id, salt, iter, verifier, rverifier, wrapped, rwrapped) values (1, ${salt}, ${iter}, ${await hashKey(key)}, ${await hashKey(rkey)}, ${wrapped}, ${rwrapped})`;
    } catch (e) { if (e && e.code === '23505') return fail(404, 'Not found.'); throw e; }
    return json(200, { ok: true }, { cookies: [await newSession(sql)] });
  }

  if (route === 'POST login') {
    if (!owner) return fail(404, 'This tool has no owner yet.');
    if (await limited(sql, ip)) return fail(429, 'Too many tries. Wait 15 minutes, then try again. This phone keeps working offline.');
    const viaRecovery = body.method === 'recovery';
    if (!loginKeyOk(body.key) || !(await checkKey(body.key, viaRecovery ? owner.rverifier : owner.verifier))) { await noteFail(sql, ip); return fail(403, viaRecovery ? 'This recovery code is not right.' : 'This passphrase is not right.'); }
    return json(200, { wrapped: viaRecovery ? owner.rwrapped : owner.wrapped }, { cookies: [await newSession(sql)] });
  }

  if (route === 'POST logout') {
    const t = readCookie(headers); if (t && t.length <= 100) await sql`delete from er_session where token_hash = ${mac('session', t)}`;
    return json(200, { ok: true }, { cookies: [cookie('', 0)] });
  }

  // Everything below needs the owner's session.
  if (!owner || !(await signedIn(sql, headers))) return fail(401, 'Sign in again to sync.');

  if (route === 'POST logout-all') { await sql`delete from er_session`; return json(200, { ok: true }, { cookies: [cookie('', 0)] }); }

  if (route === 'GET data') {
    const [row] = await sql`select version, blob, created_at from er_blob order by version desc limit 1`;
    return json(200, row ? { version: row.version, blob: row.blob, savedAt: row.created_at } : { version: 0, blob: null, savedAt: null });
  }

  // Compare-and-set: the phone says which version it built on; if another device saved since, 409 and merge.
  if (route === 'POST data') {
    const { base, blob } = body;
    if (!Number.isInteger(base) || base < 0 || base > 1e9 || !isB64(blob, 40, MAX_BLOB)) return fail(400, 'The data to save could not be read.');
    return sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(91528)`;
      const [cur] = await tx`select max(version) as v from er_blob`;
      const current = cur.v || 0;
      if (base !== current) return fail(409, 'Another device saved first.', { body: { error: 'Another device saved first.', version: current } });
      const [row] = await tx`insert into er_blob (version, blob) values (${current + 1}, ${blob}) returning version, created_at`;
      await prune(tx);
      return json(200, { version: row.version, savedAt: row.created_at });
    });
  }

  if (route === 'GET versions') {
    const rows = await sql`select version, created_at, length(blob) as size from er_blob order by version desc`;
    return json(200, { versions: rows.map(r => ({ version: r.version, savedAt: r.created_at, size: r.size })) });
  }

  if (method === 'GET' && path.length === 2 && path[0] === 'version' && /^\d{1,9}$/.test(path[1])) {
    const [row] = await sql`select version, blob, created_at from er_blob where version = ${Number(path[1])}`;
    return row ? json(200, { version: row.version, blob: row.blob, savedAt: row.created_at }) : fail(404, 'This version is no longer kept.');
  }

  // New passphrase, proven by the current passphrase key or by the recovery key. The data key stays the same.
  if (route === 'POST rekey') {
    if (await limited(sql, ip)) return fail(429, 'Too many tries. Wait 15 minutes, then try again.');
    const viaRecovery = body.method === 'recovery';
    if (!loginKeyOk(body.proof) || !(await checkKey(body.proof, viaRecovery ? owner.rverifier : owner.verifier))) { await noteFail(sql, ip); return fail(403, 'The check did not match. Nothing was changed.'); }
    const { salt, iter, key, wrapped } = body;
    if (!saltOk(salt) || !iterOk(iter) || !loginKeyOk(key) || !wrapOk(wrapped)) return fail(400, 'The new passphrase data is not complete.');
    await sql.begin(async tx => {
      await tx`update er_owner set salt = ${salt}, iter = ${iter}, verifier = ${await hashKey(key)}, wrapped = ${wrapped}, updated_at = now() where id = 1`;
      await tx`delete from er_session`;
    });
    return json(200, { ok: true }, { cookies: [await newSession(sql)] });
  }

  // Delete everything on the server: every version, sessions and the owner. The server checks the passphrase key.
  if (route === 'POST delete-all') {
    if (await limited(sql, ip)) return fail(429, 'Too many tries. Wait 15 minutes, then try again.');
    if (!loginKeyOk(body.key) || !(await checkKey(body.key, owner.verifier))) { await noteFail(sql, ip); return fail(403, 'This passphrase is not right. Nothing was deleted.'); }
    await sql.begin(async tx => { await tx`delete from er_blob`; await tx`delete from er_session`; await tx`delete from er_owner`; await tx`delete from er_attempt`; });
    return json(200, { ok: true }, { cookies: [cookie('', 0)] });
  }

  return fail(404, 'Not found.');
}
