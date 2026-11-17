// Command Center database access. Fails closed: no CC_DATABASE_URL, no server features.
// Workspace data is always read and written as the restricted role cc_app inside a transaction
// that carries the signed-in user's id, so Postgres row-level security applies to every query.
import postgres from 'postgres';
import { MIGRATIONS } from './migrations.js';

let pooled = null; let migrated = null;
// Vercel's Neon connection adds its own prefix: CC_DATABASE_DATABASE_URL (pooled) and ..._UNPOOLED (migrations).
const dbUrl = () => process.env.CC_DATABASE_URL || process.env.CC_DATABASE_DATABASE_URL || '';
const directUrl = () => process.env.CC_DATABASE_URL_UNPOOLED || process.env.CC_DATABASE_DATABASE_URL_UNPOOLED || '';

function connect(url, max) {
  return postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 10, ssl: process.env.CC_DATABASE_SSL === 'off' ? false : 'require', onnotice: () => {} });
}

export function configured() { return Boolean(dbUrl()); }

// Key for the stored token hashes: CC_SESSION_SECRET, its own Sensitive variable (32+ characters).
// The server refuses to start accounts without it, so there is no fallback key.
export function hashKey() {
  const s = process.env.CC_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('CC_SESSION_SECRET is missing or too short');
  return s;
}

export async function db() {
  if (!configured()) return null;
  if (!pooled) pooled = connect(dbUrl(), 3);
  if (!migrated) migrated = migrate().catch(e => { migrated = null; throw e; });
  await migrated;
  return pooled;
}

// Numbered migrations, applied once, under a lock, on the direct (unpooled) connection when there is one.
async function migrate() {
  const direct = directUrl() ? connect(directUrl(), 1) : null;
  const sql = direct || pooled;
  try {
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(82731)`;
      await tx`create table if not exists cc_migration (id int primary key, applied_at timestamptz not null default now())`;
      const done = new Set((await tx`select id from cc_migration`).map(r => r.id));
      for (const m of MIGRATIONS) {
        if (done.has(m.id)) continue;
        await tx.unsafe(m.sql);
        await tx`insert into cc_migration (id) values (${m.id})`;
      }
    });
  } finally { if (direct) await direct.end({ timeout: 2 }); }
}

// Run fn(tx) as the signed-in user: row-level security limits every row to that user's workspaces.
export async function asUser(sql, userId, fn) {
  return sql.begin(async tx => {
    await tx`select set_config('cc.user_id', ${userId}, true)`;
    await tx.unsafe('set local role cc_app');
    return fn(tx);
  });
}

export async function closeForTests() { if (pooled) await pooled.end({ timeout: 2 }); pooled = null; migrated = null; }
