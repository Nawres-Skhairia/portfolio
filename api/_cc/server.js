// Command Center API. One entry point (api/cc/[...path].js) calls handle() with a plain request
// object, so the same code runs on Vercel and in the tests.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, asUser, configured, hashKey } from './db.js';
import { applyOps, checkImport, emptyData } from './model.js';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const COOKIE = 'cc_session';
const SESSION_DAYS = 30;
const VERIFY_HOURS = 24;
const json = (status, body, extra = {}) => ({ status, body, ...extra });
const fail = (status, error, extra = {}) => json(status, { error }, extra);

// ---------- passwords (pattern of FORGE's password.ts) ----------
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT);
  return 'scrypt$' + SCRYPT.N + '$' + SCRYPT.r + '$' + SCRYPT.p + '$' + salt.toString('base64') + '$' + key.toString('base64');
}
async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

// Tokens are random; only a keyed hash is stored, so a copy of the database holds no usable token.
const tokenHash = t => createHmac('sha256', hashKey()).update(String(t)).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const ipBucket = ip => 'ip:' + createHmac('sha256', hashKey()).update(String(ip || '')).digest('hex').slice(0, 24);

function cookieHeader(value, maxAge, secure) {
  return COOKIE + '=' + value + '; Path=/api/cc; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}
function readCookie(headers) {
  const raw = headers.cookie || '';
  for (const part of raw.split(';')) { const [k, ...v] = part.trim().split('='); if (k === COOKIE) return v.join('='); }
  return '';
}

// ---------- attempt limits, kept in the database (no paid service) ----------
async function tooMany(sql, bucket, max, minutes) {
  const [{ n }] = await sql`select count(*)::int as n from cc_attempt where bucket = ${bucket} and at > now() - make_interval(mins => ${minutes})`;
  return n >= max;
}
const note = (sql, bucket) => sql`insert into cc_attempt (bucket) values (${bucket})`;

// ---------- validation of sign-up fields ----------
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;
function signupErrors(b) {
  const e = {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) e.email = 'Enter a valid email address.';
  const pw = String(b.password || '');
  if (pw.length < 10) e.password = 'Use at least 10 characters.';
  else if (pw.length > 200) e.password = 'Use 200 characters or fewer.';
  const name = String(b.displayName || '').trim();
  if (!name) e.displayName = 'Enter the name others will see.';
  else if (name.length > 40) e.displayName = 'Use 40 characters or fewer.';
  if (b.privacyAck !== true) e.privacyAck = 'Tick the box to confirm you have read how your data is used.';
  return { e, email, pw, name };
}

async function sendMail(sql, to, subject, body) {
  // Preview: emails are written to a test mailbox instead of being sent (accounts plan, section 1.4).
  await sql`insert into cc_outbox (to_email, subject, body) values (${to}, ${subject}, ${body})`;
}

async function currentUser(sql, headers) {
  const token = readCookie(headers);
  if (!token || token.length > 100) return null;
  const [u] = await sql`select u.id, u.email, u.display_name from cc_session s join cc_user u on u.id = s.user_id where s.id = ${tokenHash(token)} and s.expires_at > now() and u.email_verified_at is not null`;
  return u || null;
}

async function startSession(sql, userId, secure) {
  const token = newToken();
  await sql`insert into cc_session (id, user_id, expires_at) values (${tokenHash(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return cookieHeader(token, SESSION_DAYS * 86400, secure);
}

// ---------- workspace read and write (always as the user, under row-level security) ----------
async function loadWorkspace(tx, wsId) {
  const [ws] = await tx`select id, name, version, settings, is_sample from cc_workspace where id = ${wsId}`;
  if (!ws) return null;
  const projects = await tx`select doc from cc_project where workspace_id = ${wsId} order by id`;
  const milestones = await tx`select doc from cc_milestone where workspace_id = ${wsId} order by id`;
  const tasks = await tx`select doc from cc_task where workspace_id = ${wsId} order by id`;
  const deps = await tx`select task_id, depends_on_id from cc_task_dep where workspace_id = ${wsId}`;
  const risks = await tx`select doc from cc_risk where workspace_id = ${wsId} order by id`;
  const acts = await tx`select entity_id, actor_name, field, old_value, new_value, at_text from cc_activity where workspace_id = ${wsId} and entity = 'task' order by id`;
  const hist = new Map();
  for (const a of acts) { if (!hist.has(a.entity_id)) hist.set(a.entity_id, []); hist.get(a.entity_id).push({ at: a.at_text, by: a.actor_name, field: a.field, from: a.old_value, to: a.new_value }); }
  const depMap = new Map();
  for (const d of deps) { if (!depMap.has(d.task_id)) depMap.set(d.task_id, []); depMap.get(d.task_id).push(d.depends_on_id); }
  return {
    id: ws.id, name: ws.name, version: ws.version, isSample: ws.is_sample,
    data: {
      projects: projects.map(r => r.doc), milestones: milestones.map(r => r.doc), risks: risks.map(r => r.doc),
      tasks: tasks.map(r => ({ ...r.doc, deps: (r.doc.deps || []).filter(d => (depMap.get(r.doc.id) || []).includes(d)), history: hist.get(r.doc.id) || [] })),
      filters: (ws.settings && ws.settings.filters) || [],
    },
  };
}

const stripTask = t => { const { history, ...rest } = t; return rest; };

async function writeEntities(tx, wsId, data, touched) {
  const find = (type, id) => data[type + 's'].find(x => x.id === id);
  const order = { project: 0, milestone: 1, task: 2, risk: 3 };
  const dels = touched.filter(t => t.op === 'del').sort((a, b) => order[b.type] - order[a.type]);
  const puts = touched.filter(t => t.op === 'put').sort((a, b) => order[a.type] - order[b.type]);
  for (const d of dels) await tx.unsafe('delete from cc_' + d.type + ' where workspace_id = $1 and id = $2', [wsId, d.id]);
  const taskPuts = [];
  for (const p of puts) {
    const doc = find(p.type, p.id); if (!doc) continue;
    if (p.type === 'project') await tx`insert into cc_project (workspace_id, id, doc) values (${wsId}, ${doc.id}, ${tx.json(doc)}) on conflict (workspace_id, id) do update set doc = excluded.doc`;
    else if (p.type === 'task') { const clean = stripTask(doc); await tx`insert into cc_task (workspace_id, id, project_id, doc) values (${wsId}, ${doc.id}, ${doc.projectId}, ${tx.json(clean)}) on conflict (workspace_id, id) do update set doc = excluded.doc, project_id = excluded.project_id`; taskPuts.push(doc); }
    else await tx.unsafe('insert into cc_' + p.type + ' (workspace_id, id, project_id, doc) values ($1, $2, $3, $4) on conflict (workspace_id, id) do update set doc = excluded.doc, project_id = excluded.project_id', [wsId, doc.id, doc.projectId, doc]);
  }
  for (const t of taskPuts) {
    await tx`delete from cc_task_dep where workspace_id = ${wsId} and task_id = ${t.id}`;
    for (const d of t.deps || []) await tx`insert into cc_task_dep (workspace_id, task_id, depends_on_id) values (${wsId}, ${t.id}, ${d})`;
  }
}

async function logEvents(tx, wsId, user, events, at, copied = false) {
  for (const ev of events) {
    await tx`insert into cc_activity (workspace_id, actor_user_id, actor_name, entity, entity_id, field, old_value, new_value, at_text, copied)
      values (${wsId}, ${copied ? null : user.id}, ${ev.by || user.display_name}, ${ev.entity}, ${ev.entityId}, ${ev.field}, ${String(ev.from ?? '')}, ${String(ev.to ?? '')}, ${ev.at || at}, ${copied})`;
  }
}

const stamp = () => new Date().toISOString().slice(0, 16);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function createWorkspace(sql, user, name, isSample) {
  return sql.begin(async tx => {
    const [ws] = await tx`insert into cc_workspace (name, created_by, is_sample) values (${name}, ${user.id}, ${isSample}) returning id`;
    await tx`insert into cc_membership (workspace_id, user_id, role) values (${ws.id}, ${user.id}, 'owner')`;
    return ws.id;
  });
}

// ---------- the router ----------
// req: { method, path: ['auth','signin'], headers: {lowercase}, body, ip, secure }
export async function handle(req) {
  const { method, path, headers = {}, body = {}, ip = '' } = req;
  const route = method + ' /' + path.join('/');
  if (!configured()) return fail(503, 'Accounts are not available here yet.');
  if (method === 'POST') {
    // Changes are accepted only from this site's own pages (no cross-site requests).
    const origin = headers.origin || '';
    const host = headers['x-forwarded-host'] || headers.host || '';
    if (!origin || origin.replace(/^https?:\/\//, '') !== host) return fail(403, 'This request did not come from Command Center.');
    if (!String(headers['content-type'] || '').startsWith('application/json')) return fail(415, 'Send JSON.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'The request is not valid.');
  }
  let sql;
  try { sql = await db(); } catch (e) { return fail(503, 'The database is not reachable. Try again in a minute.'); }
  const secure = req.secure !== false;
  const origin = headers.origin || ((secure ? 'https://' : 'http://') + (headers['x-forwarded-host'] || headers.host || ''));

  if (route === 'GET /me') {
    const u = await currentUser(sql, headers);
    if (!u) return json(200, { user: null });
    const ws = await asUser(sql, u.id, tx => tx`select w.id, w.name, w.is_sample, m.role from cc_workspace w join cc_membership m on m.workspace_id = w.id and m.user_id = ${u.id} order by w.created_at`);
    return json(200, { user: { email: u.email, displayName: u.display_name }, workspaces: ws.map(w => ({ id: w.id, name: w.name, isSample: w.is_sample, role: w.role })) });
  }

  if (route === 'POST /auth/signup') {
    const ipb = ipBucket(ip);
    if (await tooMany(sql, ipb + ':signup', 10, 60)) return fail(429, 'Too many sign-ups from here. Try again in an hour.');
    await note(sql, ipb + ':signup');
    const { e, email, pw, name } = signupErrors(body);
    if (Object.keys(e).length) return json(422, { errors: e });
    // Housekeeping promised on the sign-up screen: unconfirmed sign-ups go after 7 days, old sessions and links after they expire.
    await sql`delete from cc_user where email_verified_at is null and created_at < now() - interval '7 days'`;
    await sql`delete from cc_session where expires_at < now()`;
    await sql`delete from cc_token where expires_at < now() - interval '1 day'`;
    const hash = await hashPassword(pw);
    const [existing] = await sql`select id, email_verified_at from cc_user where email = ${email}`;
    if (existing) {
      // Same answer whether or not the address is known, so sign-up does not reveal who has an account.
      if (existing.email_verified_at) await sendMail(sql, email, 'Someone tried to create a Command Center account with your address', 'You already have an account. If this was you, sign in instead. If not, you can ignore this email.');
      else await issueVerify(sql, existing.id, email, origin);
      return json(200, { ok: true });
    }
    const [u] = await sql`insert into cc_user (email, password_hash, display_name, privacy_ack_at) values (${email}, ${hash}, ${name}, now()) returning id`;
    await issueVerify(sql, u.id, email, origin);
    return json(200, { ok: true });
  }

  if (route === 'POST /auth/verify') {
    const token = String(body.token || '');
    if (!token || token.length > 100) return fail(400, 'This link is not valid.');
    const res = await sql.begin(async tx => {
      const [t] = await tx`update cc_token set used_at = now() where id = ${tokenHash(token)} and purpose = 'verify' and used_at is null and expires_at > now() returning user_id`;
      if (!t) return null;
      const [u] = await tx`update cc_user set email_verified_at = coalesce(email_verified_at, now()) where id = ${t.user_id} returning id, display_name`;
      const [{ n }] = await tx`select count(*)::int as n from cc_membership where user_id = ${u.id}`;
      return { user: { id: u.id, display_name: u.display_name }, first: n === 0 };
    });
    if (!res) return fail(400, 'This link has expired or was already used. Sign in, or ask for a new link.');
    if (res.first) await createWorkspace(sql, res.user, 'My workspace', false);
    return json(200, { ok: true }, { cookies: [await startSession(sql, res.user.id, secure)] });
  }

  if (route === 'POST /auth/resend') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return json(422, { errors: { email: 'Enter a valid email address.' } });
    if (await tooMany(sql, 'resend:' + email, 3, 60)) return fail(429, 'Too many links asked for. Try again in an hour.');
    await note(sql, 'resend:' + email);
    const [u] = await sql`select id, email_verified_at from cc_user where email = ${email}`;
    if (u && !u.email_verified_at) await issueVerify(sql, u.id, email, origin);
    return json(200, { ok: true });
  }

  if (route === 'POST /auth/signin') {
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const pw = String(body.password || '').slice(0, 200);
    const ipb = ipBucket(ip);
    if (await tooMany(sql, 'signin:' + email, 5, 15) || await tooMany(sql, ipb + ':signin', 30, 15)) return fail(429, 'Too many wrong attempts. Wait 15 minutes and try again.');
    const [u] = await sql`select id, password_hash, email_verified_at from cc_user where email = ${email}`;
    const ok = await verifyPassword(pw, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) {
      await note(sql, 'signin:' + email); await note(sql, ipb + ':signin');
      await sql`delete from cc_attempt where at < now() - interval '1 day'`;
      return fail(401, 'The email or the password is not right.');
    }
    if (!u.email_verified_at) return fail(403, 'Confirm your email first. We can send the link again.', { body: { error: 'Confirm your email first. We can send the link again.', unverified: true } });
    return json(200, { ok: true }, { cookies: [await startSession(sql, u.id, secure)] });
  }

  if (route === 'POST /auth/signout') {
    const token = readCookie(headers);
    if (token) await sql`delete from cc_session where id = ${tokenHash(token)}`;
    return json(200, { ok: true }, { cookies: [cookieHeader('', 0, secure)] });
  }

  // Preview-only test mailbox: never on the live site.
  if (route === 'GET /dev/mailbox') {
    if (process.env.VERCEL_ENV === 'production' || process.env.CC_PREVIEW_MAILBOX !== '1') return fail(404, 'Not found.');
    const email = String(req.query?.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return json(200, { mails: [] });
    const mails = await sql`select subject, body, created_at from cc_outbox where to_email = ${email} order by id desc limit 10`;
    return json(200, { mails });
  }

  // Everything below needs a signed-in person.
  const user = await currentUser(sql, headers);
  if (!user) return fail(401, 'Sign in first.');

  if (route === 'POST /workspaces/import') {
    const name = String(body.name || '').trim().slice(0, 60) || 'Copied workspace';
    if (JSON.stringify(body.data || null).length > 3_000_000) return fail(413, 'This workspace is too large to copy.');
    const chk = checkImport(body.data);
    if (chk.error) return fail(422, chk.error);
    const wsId = await createWorkspace(sql, user, name, body.isSample === true);
    await asUser(sql, user.id, async tx => {
      const touched = ['project', 'milestone', 'task', 'risk'].flatMap(type => chk.data[type + 's'].map(x => ({ type, id: x.id, op: 'put' })));
      await writeEntities(tx, wsId, chk.data, touched);
      await tx`update cc_workspace set settings = ${tx.json({ filters: chk.data.filters })} where id = ${wsId}`;
      await logEvents(tx, wsId, user, chk.history, stamp(), true);
    });
    return json(200, { id: wsId });
  }

  const m = /^(GET|POST) \/workspaces\/([^/]+)(\/sync)?$/.exec(route);
  if (m) {
    const wsId = m[2];
    if (!UUID.test(wsId)) return fail(404, 'This workspace does not exist or is not yours.');
    if (m[1] === 'GET' && !m[3]) {
      const ws = await asUser(sql, user.id, tx => loadWorkspace(tx, wsId));
      return ws ? json(200, ws) : fail(404, 'This workspace does not exist or is not yours.');
    }
    if (m[1] === 'POST' && m[3]) {
      const base = Number(body.version);
      return asUser(sql, user.id, async tx => {
        const [lock] = await tx`select version from cc_workspace where id = ${wsId} for update`;
        if (!lock) return fail(404, 'This workspace does not exist or is not yours.');
        if (lock.version !== base) return json(409, { error: 'This workspace changed somewhere else. The latest version is shown.', workspace: await loadWorkspace(tx, wsId) });
        const current = (await loadWorkspace(tx, wsId)).data;
        const at = stamp();
        const r = applyOps(current, body.ops, user.display_name, at);
        if (r.error) return fail(422, r.error);
        await writeEntities(tx, wsId, r.data, r.touched);
        if (r.touched.some(t => t.type === 'filters')) await tx`update cc_workspace set settings = ${tx.json({ filters: r.data.filters })} where id = ${wsId}`;
        await logEvents(tx, wsId, user, r.events, at);
        await tx`update cc_workspace set version = version + 1 where id = ${wsId}`;
        return json(200, await loadWorkspace(tx, wsId));
      });
    }
  }
  return fail(404, 'Not found.');
}

async function issueVerify(sql, userId, email, origin) {
  const token = newToken();
  await sql`insert into cc_token (id, user_id, purpose, expires_at) values (${tokenHash(token)}, ${userId}, 'verify', now() + make_interval(hours => ${VERIFY_HOURS}))`;
  const link = origin + '/projects/command-center/#/verify/' + token;
  await sendMail(sql, email, 'Confirm your Command Center account', 'Open this link to confirm your email address and sign in. It works once, for 24 hours.\n\n' + link + '\n\nIf you did not ask for an account, ignore this email.');
}

export { emptyData };
