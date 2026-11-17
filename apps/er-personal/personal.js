// Personal Expense Radar: the screens around the app (set up, sign in, recovery, sync status, safety and backups).
// The money screens are the normal Expense Radar; this file only adds what the private copy needs.
import * as V from './vault.js';

let H = null; let recoveryToShow = null; let showRecover = false; let gateError = '';
const PRIVATE_LINE = 'A private tool for the site owner. There is no sign-up, and nothing is collected from visitors.';
const PASS_HINT = 'At least ' + V.MIN_PASS + ' characters. Four random words work well, for example "lamp river seven orange".';
const $ = s => document.querySelector(s);
const dlg = () => document.getElementById('dlg');
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const time = iso => { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

export async function start(host) { H = host; return V.boot(host); }
export const locked = () => V.locked() || recoveryToShow !== null;
export function store(d) { V.store(d); }

// ---------- gate: everything before the money screens ----------
function field(id, label, input, hint) { return '<div class="fld"><label for="' + id + '">' + label + '</label>' + input + (hint ? '<small class="hint">' + hint + '</small>' : '') + '</div>'; }
const passInput = (id, name, auto) => '<input id="' + id + '" name="' + name + '" type="password" autocomplete="' + auto + '" minlength="' + V.MIN_PASS + '" maxlength="200" required>';
export function gate() {
  const s = V.status(); const E = H.E; const esc = H.esc;
  document.title = 'My Expense Radar'; document.body.classList.add('p-locked');
  $('#band').innerHTML = '<div class="band-in"><span>' + esc(PRIVATE_LINE) + '</span></div>';
  const err = gateError ? '<p class="p-err" role="alert">' + esc(gateError) + '</p>' : '';
  const note = s.note ? '<p class="p-note">' + esc(s.note) + '</p>' : '';
  const iosTip = isIos() && !installed() ? '<div class="p-tip"><b>First add it to your Home Screen.</b> On iPhone, the Home Screen app keeps its own storage. Tap the Share button, then <b>Add to Home Screen</b>, open it from there, and set up or sign in inside it.</div>' : '';
  let body;
  if (recoveryToShow) {
    body = '<h1>Save your recovery code</h1><p class="lede">If you ever forget your passphrase, this code is the only way back to your data. Nobody else can open it, not even the people who made this tool.</p>' +
      '<p class="p-code" aria-label="Recovery code">' + esc(recoveryToShow) + '</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="p-code-file">Download it as a text file</button></div>' +
      '<p class="small muted">Write it on paper or keep it in your password manager. Do not keep it only on this phone.</p>' +
      '<form data-form="p-code-done" class="p-form"><label class="check"><input type="checkbox" name="saved" required> I have saved the recovery code somewhere safe.</label><button type="submit" class="btn">Open my Expense Radar</button></form>';
  } else if (s.phase === 'setup') {
    body = '<h1>Set up your private Expense Radar</h1><p class="lede">Your figures are encrypted on this phone before they are saved. A safe copy is kept online, so a lost phone does not lose your data.</p>' + iosTip +
      '<form data-form="p-setup" class="p-form" novalidate>' + err +
      field('p-code', 'Setup code', '<input id="p-code" name="code" type="password" autocomplete="off" maxlength="500" required>', 'The code you saved in the site settings.') +
      field('p-pass', 'Choose a passphrase', passInput('p-pass', 'pass', 'new-password'), esc(PASS_HINT)) +
      field('p-pass2', 'Type it again', passInput('p-pass2', 'pass2', 'new-password')) +
      field('p-cur', 'Currency', '<select id="p-cur" name="currency">' + Object.keys(E.CURRENCIES).map(c => '<option' + (c === 'EUR' ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>') +
      '<button type="submit" class="btn">Set up</button></form>';
  } else if (s.phase === 'signin' && showRecover) {
    body = '<h1>Use your recovery code</h1><p class="lede">Type the recovery code you saved at setup, then choose a new passphrase.</p>' +
      '<form data-form="p-recover" class="p-form" novalidate>' + err +
      field('p-rcode', 'Recovery code', '<input id="p-rcode" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" required>') +
      field('p-npass', 'New passphrase', passInput('p-npass', 'pass', 'new-password'), esc(PASS_HINT)) +
      field('p-npass2', 'Type it again', passInput('p-npass2', 'pass2', 'new-password')) +
      '<button type="submit" class="btn">Open my data</button> <button type="button" class="lnk" data-act="p-hide-recover">Back to sign in</button></form>';
  } else if (s.phase === 'signin') {
    body = '<h1>My Expense Radar</h1><p class="lede">Sign in once on this phone. After that it opens straight away, also without a connection.</p>' + iosTip + note +
      '<form data-form="p-signin" class="p-form" novalidate>' + err +
      field('p-spass', 'Passphrase', passInput('p-spass', 'pass', 'current-password')) +
      '<button type="submit" class="btn">Sign in</button> <button type="button" class="lnk" data-act="p-show-recover">I forgot my passphrase</button></form>';
  } else if (s.phase === 'offline') {
    body = '<h1>My Expense Radar</h1><p class="lede">No connection. Connect once to sign in on this phone; after that it works offline too.</p><button type="button" class="btn" data-act="p-retry">Try again</button>';
  } else if (s.phase === 'closed') {
    body = '<h1>My Expense Radar</h1><p class="lede">This private tool is not set up on this copy of the site.</p>';
  } else body = '<p class="lede">Opening…</p>';
  $('#main').innerHTML = '<section class="welcome p-gate">' + body + '</section>';
  const first = $('#main input:not([type=checkbox])'); if (first) first.focus();
}

// ---------- band: sync status and the one way into safety and backups ----------
export function band() {
  document.body.classList.remove('p-locked');
  const s = V.status(); const d = H.get(); const esc = H.esc;
  const text = s.sync === 'busy' ? 'Saving to your safe copy…'
    : s.sync === 'offline' ? 'Offline. Saved on this phone; it will sync when you are back online.'
    : s.sync === 'signin' ? 'Saved on this phone. Sign in again to sync.'
    : s.sync === 'error' ? 'Not synced. ' + (s.note || 'Try again in a moment.')
    : s.dirty ? 'Saved on this phone. Syncing soon.'
    : s.lastSync ? 'Private. Synced ' + time(s.lastSync) + '.' : 'Private.';
  const due = !d.backupAt || (Date.now() - Date.parse(d.backupAt)) > 30 * 86400000;
  $('#band').innerHTML = '<div class="band-in own"><span><b>' + esc(text) + '</b>' + (due ? ' <button type="button" class="lnk" data-act="backup">Monthly backup due: download it</button>' : '') + '</span><span class="grow"></span>' +
    (s.sync === 'signin' ? '<button type="button" class="btn sm" data-act="p-reconnect">Sign in</button>' : '<button type="button" class="lnk" data-act="p-sync">Sync now</button>') +
    '<button type="button" class="lnk" data-act="p-safety">Safety and backups</button><input type="file" id="restoreFile" accept="application/json,.json" hidden></div>';
}

// ---------- dialogs ----------
function dialog(title, inner, form, submit, danger) {
  const d = dlg();
  d.innerHTML = '<form class="form" data-form="' + form + '" novalidate><header><h2 id="dlgTitle">' + H.esc(title) + '</h2></header><div class="body">' + inner + '<p class="p-err" id="p-derr" role="alert" hidden></p></div><footer><span class="grow"></span><button type="button" class="btn ghost" data-close>' + (submit ? 'Cancel' : 'Close') + '</button>' + (submit ? '<button type="submit" class="btn' + (danger ? ' danger' : '') + '">' + H.esc(submit) + '</button>' : '') + '</footer></form>';
  d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  if (!d.open) d.showModal();
  const f = d.querySelector('input'); if (f) f.focus();
}
function safety() {
  const s = V.status();
  dialog('Safety and backups',
    '<p>Your data is encrypted on this phone and kept in a private safe copy online, with earlier versions. ' + (s.lastSync ? 'Last synced ' + time(s.lastSync) + '.' : '') + '</p>' +
    '<h3>Backups</h3><div class="p-list"><button type="button" class="lnk" data-act="backup">Download a backup you can read (once a month)</button><button type="button" class="lnk" data-act="p-backup-enc">Download an encrypted backup</button><button type="button" class="lnk" data-act="restore">Restore from a backup file</button></div>' +
    '<h3>Earlier versions</h3><div class="p-list"><button type="button" class="lnk" data-act="p-versions">See earlier versions</button></div>' +
    '<h3>Access</h3><div class="p-list"><button type="button" class="lnk" data-act="p-pass">Change the passphrase</button><button type="button" class="lnk" data-act="p-signout">Sign out of this phone</button><button type="button" class="lnk" data-act="p-signout-all">Sign out everywhere</button></div>' +
    '<h3>Delete</h3><div class="p-list"><button type="button" class="lnk danger" data-act="p-delete">Delete everything</button></div>', 'p-none');
}
async function versionsDialog() {
  const list = await V.versions();
  if (!list) { H.toast('Earlier versions need a connection and a signed-in phone.'); return; }
  dialog('Earlier versions', list.length ? '<p class="small muted">The last 30 saves, plus one for each of the last 30 days. Restoring one keeps the others.</p><ul class="p-vers">' + list.map(v => '<li><span>' + H.esc(time(v.savedAt)) + '</span><button type="button" class="lnk" data-act="p-ver-restore" data-v="' + v.version + '">Restore</button></li>').join('') + '</ul>' : '<p>No saved versions yet.</p>', 'p-none');
}
function busy(form, on) { const b = form.querySelector('[type=submit]'); if (b) { b.disabled = on; if (on) { b.dataset.label = b.textContent; b.textContent = 'Working…'; } else if (b.dataset.label) b.textContent = b.dataset.label; } }
function showErr(form, msg) {
  const el = form.querySelector('#p-derr');
  if (el) { el.textContent = msg; el.hidden = false; return; }
  gateError = msg; gate();
}
const passProblem = (a, b) => a.length < V.MIN_PASS ? 'Use at least ' + V.MIN_PASS + ' characters.' : a !== b ? 'The two passphrases are not the same.' : '';

export async function act(name, el) {
  switch (name) {
    case 'p-sync': V.sync(); break;
    case 'p-safety': safety(); break;
    case 'p-retry': await V.boot(H); gateError = ''; H.render(); break;
    case 'p-show-recover': showRecover = true; gateError = ''; gate(); break;
    case 'p-hide-recover': showRecover = false; gateError = ''; gate(); break;
    case 'p-code-file': H.download('my-expense-radar-recovery-code.txt', 'My Expense Radar recovery code\n\n' + recoveryToShow + '\n\nKeep this somewhere safe and away from this phone.\n', 'text/plain'); break;
    case 'p-reconnect': dialog('Sign in again', '<p>Your data is safe on this phone. Sign in to sync it again.</p>' + field('p-rpass', 'Passphrase', passInput('p-rpass', 'pass', 'current-password')), 'p-reconnect', 'Sign in'); break;
    case 'p-backup-enc': { const text = await V.encryptedBackup(H.get()); H.download('my-expense-radar-encrypted-' + H.today + '.json', text, 'application/json'); H.toast('Encrypted backup downloaded. Only a signed-in phone can open it.'); break; }
    case 'p-versions': await versionsDialog(); break;
    case 'p-ver-restore': { const v = Number(el.dataset.v); const d = await V.openVersion(v).catch(() => null); if (!d) { H.toast('This version could not be opened.'); break; } dlg().close(); H.commit({ ...d, own: true }, 'The version from earlier is back. The newer one stays in the list.'); break; }
    case 'p-pass': dialog('Change the passphrase', field('p-opass', 'Current passphrase', passInput('p-opass', 'old', 'current-password')) + field('p-cpass', 'New passphrase', passInput('p-cpass', 'pass', 'new-password'), H.esc(PASS_HINT)) + field('p-cpass2', 'Type it again', passInput('p-cpass2', 'pass2', 'new-password')), 'p-changepass', 'Change'); break;
    case 'p-signout': dialog('Sign out of this phone?', '<p>' + (V.status().dirty ? '<b>Some changes are not synced yet.</b> Sync first, or they are lost. ' : '') + 'Your data stays in the safe copy. This phone forgets it until you sign in again.</p>', 'p-signout', 'Sign out'); break;
    case 'p-signout-all': dialog('Sign out everywhere?', '<p>Every phone and browser that is signed in must sign in again to sync. Data already on them stays there.</p>', 'p-signout-all', 'Sign out everywhere'); break;
    case 'p-delete': dialog('Delete everything?', '<p>This removes your data, every earlier version and the safe copy online, and then this phone. Backup files you downloaded are not touched. <b>This cannot be undone.</b></p>' + field('p-dpass', 'Passphrase', passInput('p-dpass', 'pass', 'current-password')), 'p-delete', 'Delete everything', true); break;
  }
}

export async function submit(form) {
  const f = new FormData(form); const name = form.dataset.form;
  if (name === 'p-none') { dlg().close(); return; }
  if (name === 'p-code-done') { if (!f.get('saved')) return; recoveryToShow = null; H.replace(H.get()); H.render(); H.toast('Ready. Your data is encrypted and syncs on its own.'); return; }
  busy(form, true);
  try {
    if (name === 'p-setup') {
      const pass = String(f.get('pass') || ''); const p = passProblem(pass, String(f.get('pass2') || ''));
      if (p) return showErr(form, p);
      const r = await V.setup({ code: String(f.get('code') || ''), pass, currency: String(f.get('currency') || 'EUR'), emptyData: H.E.emptyData });
      if (r.error) return showErr(form, r.error);
      gateError = ''; recoveryToShow = r.recovery; H.replace(r.data); gate();
    } else if (name === 'p-signin') {
      const r = await V.signIn(String(f.get('pass') || ''));
      if (r.error) return showErr(form, r.error);
      gateError = ''; H.replace(r.data || { ...H.E.emptyData(), own: true });
    } else if (name === 'p-recover') {
      const pass = String(f.get('pass') || ''); const p = passProblem(pass, String(f.get('pass2') || ''));
      if (p) return showErr(form, p);
      const r = await V.recover(String(f.get('code') || ''), pass);
      if (r.error) return showErr(form, r.error);
      gateError = ''; showRecover = false; H.replace(r.data || { ...H.E.emptyData(), own: true }); H.toast('Your new passphrase is set.');
    } else if (name === 'p-reconnect') {
      const r = await V.reconnect(String(f.get('pass') || ''));
      if (r.error) return showErr(form, r.error);
      dlg().close(); H.band(); H.toast('Signed in. Syncing.');
    } else if (name === 'p-changepass') {
      const pass = String(f.get('pass') || ''); const p = passProblem(pass, String(f.get('pass2') || ''));
      if (p) return showErr(form, p);
      const r = await V.changePass(String(f.get('old') || ''), pass);
      if (r.error) return showErr(form, r.error);
      dlg().close(); H.toast('The passphrase is changed. Other phones must sign in again.');
    } else if (name === 'p-signout' || name === 'p-signout-all') {
      const r = await V.signOut(name === 'p-signout-all');
      if (r.error) return showErr(form, r.error);
      dlg().close(); H.render(); H.toast('Signed out.');
    } else if (name === 'p-delete') {
      const r = await V.deleteEverything(String(f.get('pass') || ''));
      if (r.error) return showErr(form, r.error);
      dlg().close(); H.render(); H.toast('Everything was deleted.');
    }
  } catch (e) { showErr(form, 'Something went wrong. Nothing was changed.'); } finally { busy(form, false); }
}

export async function restoreEncrypted(text) {
  let d; try { d = await V.openBackup(JSON.parse(text)); } catch (e) { H.toast('This encrypted backup cannot be opened on this phone.'); return; }
  if (!H.E.isValidData(d)) { H.toast('This backup could not be read. Nothing was changed.'); return; }
  H.confirmBox('Restore this backup?', 'It has ' + d.transactions.length + ' transactions. What is here now is replaced, and kept in the earlier versions.', 'Restore', () => H.commit({ ...d, own: true }, 'Backup restored.'));
}
