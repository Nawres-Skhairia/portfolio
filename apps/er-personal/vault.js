// Personal Expense Radar: encryption, safe storage on this phone, and sync with the private server copy.
// Everything is encrypted here before it is stored or sent. The server never sees a readable figure.
//  - A random data key (AES-GCM 256) encrypts the data. It is wrapped by a key from the passphrase
//    (PBKDF2-SHA256, 600,000 rounds, then HKDF "wrap") and by the recovery code (HKDF "rwrap").
//  - The value sent to sign in comes from HKDF with another label ("login"), so it can never unwrap anything.
//  - On this phone the data key is kept as a non-extractable key in IndexedDB, with the encrypted working copy.
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder(); const td = new TextDecoder();
export const ITER = 600000;
export const MIN_PASS = 14;

// ---------- bytes ----------
export function b64(buf) { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); }
export function unb64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
const rand = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to copy by hand
export function newRecoveryCode() { const r = rand(28); return [...r].map(x => B32[x % 32]).join('').replace(/(.{4})(?=.)/g, '$1-'); } // 28 x 5 bits = 140 bits
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- keys ----------
async function hkdf(ikm, salt, info, asKey) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const p = { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) };
  return asKey ? subtle.deriveKey(p, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) : b64(await subtle.deriveBits(p, base, 256));
}
// From the passphrase: { login (base64, sent), wrap (key, never leaves) }.
export async function passKeys(pass, saltB64, iter = ITER) {
  const pw = await subtle.importKey('raw', te.encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const salt = unb64(saltB64);
  const master = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, pw, 256);
  return { login: await hkdf(master, salt, 'er-login-v1'), wrap: await hkdf(master, salt, 'er-wrap-v1', true) };
}
// From the recovery code (already 140 random bits: no slow step needed).
export async function recoveryKeys(code) {
  const ikm = te.encode(cleanCode(code)); const salt = te.encode('er-recovery-v1');
  return { login: await hkdf(ikm, salt, 'er-rlogin-v1'), wrap: await hkdf(ikm, salt, 'er-rwrap-v1', true) };
}
export async function wrapKey(rawDek, wrapKeyObj) { const iv = rand(12); const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('er-dek-v1') }, wrapKeyObj, rawDek); return b64(join(iv, new Uint8Array(ct))); }
export async function unwrapRaw(wrapped, wrapKeyObj) { const a = unb64(wrapped); return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: a.subarray(0, 12), additionalData: te.encode('er-dek-v1') }, wrapKeyObj, a.subarray(12))); }
export const importDek = raw => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
function join(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }

// ---------- sealed data: [flag byte][12-byte IV][ciphertext]; the version is bound in, so it cannot be relabelled ----------
const canZip = typeof CompressionStream === 'function';
async function pipe(bytes, Stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer()); }
export async function seal(obj, dek, label) {
  let bytes = te.encode(JSON.stringify(obj)); let flag = 0;
  if (canZip) { bytes = await pipe(bytes, CompressionStream); flag = 1; }
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(label) }, dek, bytes));
  return b64(join(join(new Uint8Array([flag]), iv), ct));
}
export async function open(sealed, dek, label) {
  const a = unb64(sealed);
  let bytes = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: a.subarray(1, 13), additionalData: te.encode(label) }, dek, a.subarray(13)));
  if (a[0] === 1) bytes = await pipe(bytes, DecompressionStream);
  return JSON.parse(td.decode(bytes));
}
export const dataLabel = v => 'er-data|owner1|v' + v;

// ---------- merge: what this phone changed since the last sync, applied on top of the server copy ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isIdList = a => Array.isArray(a) && a.every(x => x && typeof x === 'object' && typeof x.id === 'string');
export function mergeData(base, local, remote) {
  if (!base) return local;
  const out = { ...remote };
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[k]; const l = local[k]; const r = remote[k];
    if (same(b, l)) continue;                       // not changed here: the server copy stays
    if (isIdList(l) && isIdList(b || []) && isIdList(r || [])) {
      const byId = new Map((r || []).map(x => [x.id, x])); const bMap = new Map((b || []).map(x => [x.id, x])); const lIds = new Set(l.map(x => x.id));
      for (const x of l) if (!bMap.has(x.id) || !same(bMap.get(x.id), x)) byId.set(x.id, x); // added or changed here
      for (const id of bMap.keys()) if (!lIds.has(id)) byId.delete(id);                         // deleted here
      out[k] = [...byId.values()];
    } else if (l && typeof l === 'object' && !Array.isArray(l) && (!r || (typeof r === 'object' && !Array.isArray(r)))) {
      const o = { ...(r || {}) }; const bo = b && typeof b === 'object' ? b : {};
      for (const kk of new Set([...Object.keys(bo), ...Object.keys(l)])) { if (!same(bo[kk], l[kk])) { if (kk in l) o[kk] = l[kk]; else delete o[kk]; } }
      out[k] = o;
    } else if (Array.isArray(l) && l.every(x => typeof x !== 'object') && Array.isArray(r)) {
      const gone = new Set((Array.isArray(b) ? b : []).filter(x => !l.includes(x)));
      out[k] = [...new Set([...r.filter(x => !gone.has(x)), ...l])];
    } else if (l === undefined) delete out[k];
    else out[k] = l;
  }
  return out;
}

// ---------- IndexedDB (this phone) ----------
let dbp = null;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('er-personal', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function kv(mode, fn) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const s = t.objectStore('kv'); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); }
const get = k => kv('readonly', s => s.get(k));
const put = (k, v) => kv('readwrite', s => s.put(v, k));
const wipeLocal = () => kv('readwrite', s => s.clear());

// ---------- server ----------
async function api(method, path, body) {
  try {
    const r = await fetch('/api/er/' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: { error: 'No connection.' } }; }
}

// ---------- state ----------
let dek = null; let meta = null; let host = null; let data = null;
const st = { phase: 'loading', sync: 'idle', note: '', lastSync: null };
export const MAX_BLOB = 4_400_000; // same cap as the server (Vercel accepts bodies up to 4.5 MB)
const EMPTY_META = { version: 0, highest: 0, dirty: false, lastSync: null };

// Start: returns the decrypted working copy, or null when this phone must sign in or set up first.
export async function boot(h) {
  host = h;
  try {
    dek = await get('dek'); meta = (await get('meta')) || null;
    if (dek && meta) {
      const w = await get('work'); data = w ? await open(w, dek, 'er-work') : null;
      if (data) { st.phase = 'ready'; st.lastSync = meta.lastSync; setTimeout(syncSoon, 50); return data; }
    }
  } catch (e) { st.note = 'The copy on this phone could not be opened. Sign in to get your data back from the safe copy.'; }
  dek = null; data = null;
  const s = await api('GET', 'state');
  st.phase = s.status === 200 ? (s.body.owner ? 'signin' : 'setup') : s.status === 0 ? 'offline' : 'closed';
  st.salt = s.body.salt; st.iter = s.body.iter;
  return null;
}
export const locked = () => st.phase !== 'ready';
export const status = () => ({ ...st, dirty: meta ? meta.dirty : false });

// Called by the app after every change: encrypt to this phone at once, then sync shortly after.
let storeChain = Promise.resolve();
export function store(next) {
  data = next; if (!dek) return;
  meta.dirty = true;
  storeChain = storeChain.then(async () => { await put('work', await seal(next, dek, 'er-work')); await put('meta', meta); }).catch(() => host.toast('This phone did not allow saving. Keep the app open until it syncs.'));
  syncSoon();
}
let timer = null;
function syncSoon() { clearTimeout(timer); timer = setTimeout(() => { sync().catch(() => {}); }, 1200); }
if (typeof window !== 'undefined') {
  window.addEventListener('online', syncSoon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSoon(); });
}

let running = false; let again = false;
export async function sync() {
  if (!dek || !meta) return;
  if (running) { again = true; return; }
  running = true; st.sync = 'busy'; st.note = ''; host.band();
  try {
    for (let round = 0; round < 4; round++) {
      await storeChain;
      const r = await api('GET', 'data');
      if (r.status === 401) { st.sync = 'signin'; return; }
      if (r.status !== 200) { st.sync = r.status === 0 ? 'offline' : 'error'; return; }
      // Rollback guard: the server must never answer with a version older than one this phone has already seen.
      if (r.body.version < meta.highest) { st.sync = 'error'; st.note = 'The safe copy is older than this phone. Nothing was changed. Download a backup from Safety and backups.'; return; }
      if (r.body.version > meta.version) {
        const remote = await open(r.body.blob, dek, dataLabel(r.body.version));
        const base = meta.version ? await open(await get('base'), dek, 'er-base') : null;
        const merged = meta.dirty ? mergeData(base, data, remote) : remote;
        meta.version = r.body.version; meta.highest = Math.max(meta.highest, meta.version);
        meta.dirty = !same(merged, remote);
        await put('base', await seal(remote, dek, 'er-base'));
        if (!same(merged, data)) { data = merged; await put('work', await seal(data, dek, 'er-work')); host.replace(data); }
        await put('meta', meta);
      }
      if (!meta.dirty) { meta.lastSync = new Date().toISOString(); st.lastSync = meta.lastSync; await put('meta', meta); st.sync = 'idle'; return; }
      // Never upload what cannot be read back.
      const snapshot = data; const v = meta.version + 1;
      const blob = await seal(snapshot, dek, dataLabel(v));
      if (!same(await open(blob, dek, dataLabel(v)), snapshot)) { st.sync = 'error'; st.note = 'A check before saving failed. Nothing was sent.'; return; }
      if (blob.length > MAX_BLOB) { st.sync = 'error'; st.note = 'Your data is now too large for the safe copy, so it was not sent. It is still on this phone. Download a backup from Safety and backups.'; return; }
      const w = await api('POST', 'data', { base: meta.version, blob });
      if (w.status === 409) continue;                 // another device saved first: fetch, merge, try again
      if (w.status === 401) { st.sync = 'signin'; return; }
      if (w.status !== 200) { st.sync = w.status === 0 ? 'offline' : 'error'; return; }
      meta.version = w.body.version; meta.highest = Math.max(meta.highest, meta.version);
      meta.dirty = !same(snapshot, data);
      await put('base', await seal(snapshot, dek, 'er-base'));
      if (!meta.dirty) { meta.lastSync = new Date().toISOString(); st.lastSync = meta.lastSync; }
      await put('meta', meta);
      if (!meta.dirty) { st.sync = 'idle'; return; }
    }
    st.sync = 'error';
  } catch (e) { st.sync = 'error'; } finally { running = false; host.band(); if (again) { again = false; syncSoon(); } }
}

// ---------- first setup, sign in, recovery ----------
async function keep(rawDek) { dek = await importDek(rawDek); rawDek.fill(0); await put('dek', dek); }
export async function setup({ code, pass, currency, emptyData }) {
  const salt = b64(rand(16)); const recovery = newRecoveryCode();
  const pk = await passKeys(pass, salt); const rk = await recoveryKeys(recovery);
  const raw = rand(32);
  const body = { code, salt, iter: ITER, key: pk.login, rkey: rk.login, wrapped: await wrapKey(raw, pk.wrap), rwrapped: await wrapKey(raw, rk.wrap) };
  const r = await api('POST', 'setup', body);
  if (r.status !== 200) { raw.fill(0); return { error: r.body.error || 'Setup did not work. Nothing was saved.' }; }
  await keep(raw);
  meta = { ...EMPTY_META, dirty: true }; data = { ...emptyData(currency), own: true };
  await put('meta', meta); await put('work', await seal(data, dek, 'er-work'));
  st.phase = 'ready'; syncSoon();
  return { recovery, data };
}
async function pullAfterSignIn() {
  const r = await api('GET', 'data');
  if (r.status !== 200) return { error: r.body.error || 'Signed in, but the safe copy could not be read. Try again.' };
  meta = { ...EMPTY_META, version: r.body.version, highest: r.body.version };
  data = r.body.version ? await open(r.body.blob, dek, dataLabel(r.body.version)) : null;
  if (data) await put('base', await seal(data, dek, 'er-base'));
  await put('meta', meta);
  return { data };
}
export async function signIn(pass) {
  const s = await api('GET', 'state'); if (s.status !== 200 || !s.body.owner) return { error: 'The safe copy cannot be reached. Check the connection.' };
  const pk = await passKeys(pass, s.body.salt, s.body.iter);
  const r = await api('POST', 'login', { method: 'pass', key: pk.login });
  if (r.status !== 200) return { error: r.body.error || 'Sign-in did not work.' };
  await keep(await unwrapRaw(r.body.wrapped, pk.wrap));
  const out = await pullAfterSignIn(); if (out.error) return out;
  st.phase = 'ready'; st.sync = 'idle'; return out;
}
// Session ended but this phone still has its key: sign in again only to sync.
export async function reconnect(pass) {
  const s = await api('GET', 'state'); if (s.status !== 200) return { error: 'The safe copy cannot be reached. Check the connection.' };
  const pk = await passKeys(pass, s.body.salt, s.body.iter);
  const r = await api('POST', 'login', { method: 'pass', key: pk.login });
  if (r.status !== 200) return { error: r.body.error || 'Sign-in did not work.' };
  st.sync = 'idle'; syncSoon(); return {};
}
// Forgot the passphrase: the recovery code opens the data key, then a new passphrase is set.
export async function recover(code, newPass) {
  const rk = await recoveryKeys(code);
  const r = await api('POST', 'login', { method: 'recovery', key: rk.login });
  if (r.status !== 200) return { error: r.body.error || 'The recovery code did not work.' };
  const raw = await unwrapRaw(r.body.wrapped, rk.wrap);
  const salt = b64(rand(16)); const pk = await passKeys(newPass, salt);
  const k = await api('POST', 'rekey', { method: 'recovery', proof: rk.login, salt, iter: ITER, key: pk.login, wrapped: await wrapKey(raw, pk.wrap) });
  if (k.status !== 200) { raw.fill(0); return { error: k.body.error || 'The new passphrase could not be saved.' }; }
  await keep(raw);
  const out = await pullAfterSignIn(); if (out.error) return out;
  st.phase = 'ready'; st.sync = 'idle'; return out;
}
export async function changePass(oldPass, newPass) {
  const s = await api('GET', 'state'); if (s.status !== 200) return { error: 'The safe copy cannot be reached. Check the connection.' };
  const old = await passKeys(oldPass, s.body.salt, s.body.iter);
  const r = await api('POST', 'login', { method: 'pass', key: old.login });
  if (r.status !== 200) return { error: r.body.error || 'The current passphrase is not right.' };
  const raw = await unwrapRaw(r.body.wrapped, old.wrap);
  const salt = b64(rand(16)); const pk = await passKeys(newPass, salt);
  const k = await api('POST', 'rekey', { method: 'pass', proof: old.login, salt, iter: ITER, key: pk.login, wrapped: await wrapKey(raw, pk.wrap) });
  raw.fill(0);
  return k.status === 200 ? {} : { error: k.body.error || 'The new passphrase could not be saved.' };
}
export async function signOut(everywhere) {
  const r = await api('POST', everywhere ? 'logout-all' : 'logout', {});
  if (everywhere && r.status !== 200) return { error: r.body.error || 'Could not reach the safe copy. Nothing was changed.' };
  await wipeLocal(); dek = null; meta = null; data = null; st.phase = 'signin'; return {};
}
export async function deleteEverything(pass) {
  const s = await api('GET', 'state'); if (s.status !== 200 || !s.body.owner) return { error: 'The safe copy cannot be reached. Nothing was deleted.' };
  const pk = await passKeys(pass, s.body.salt, s.body.iter);
  const r = await api('POST', 'delete-all', { key: pk.login });
  if (r.status !== 200) return { error: r.body.error || 'Nothing was deleted.' };
  await wipeLocal(); dek = null; meta = null; data = null; st.phase = 'setup'; return {};
}

// ---------- versions and encrypted backup ----------
export async function versions() { const r = await api('GET', 'versions'); return r.status === 200 ? r.body.versions : null; }
export async function openVersion(v) { const r = await api('GET', 'version/' + v); return r.status === 200 ? open(r.body.blob, dek, dataLabel(r.body.version)) : null; }
export async function encryptedBackup(obj) { return JSON.stringify({ app: 'expense-radar-personal', format: 1, exportedAt: new Date().toISOString(), blob: await seal(obj, dek, 'er-backup') }); }
export async function openBackup(j) { return open(j.blob, dek, 'er-backup'); }
