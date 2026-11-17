// Our own pickers (pro-rework-spec §2): no native <select> or <input type=date> reaches the screen.
// Each one is swapped for a hidden input (same name, id and data attributes, so forms and handlers keep working)
// and a button that opens a menu or a month grid. A change fires a bubbling "change" on the hidden input.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
let TODAY = todayIso();
export function setToday(t) { TODAY = t; }
export const longDate = s => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1] + ' ' + y; };
const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let seq = 0;
const CHEV = '<svg class="ochev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>';
const CAL = '<svg class="ocal" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>';

// The words a screen reader says before the value: aria-label, a <label for>, or the label that wraps the control.
function labelText(el) {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
  if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent.trim(); }
  const wrap = el.closest('label');
  if (wrap) { const c = wrap.cloneNode(true); c.querySelectorAll('select,input').forEach(x => x.remove()); return c.textContent.trim(); }
  return '';
}
function swap(el, kind) {
  const hid = document.createElement('input'); hid.type = 'hidden';
  for (const a of el.attributes) if (a.name === 'id' || a.name === 'name' || a.name.startsWith('data-')) hid.setAttribute(a.name, a.value);
  hid.value = el.value;
  const btn = document.createElement('button'); btn.type = 'button';
  btn.className = (kind === 'date' ? 'odate' : 'osel') + (el.className ? ' ' + el.className : '');
  btn.id = 'o' + (++seq);
  btn.setAttribute('aria-haspopup', kind === 'date' ? 'dialog' : 'listbox'); btn.setAttribute('aria-expanded', 'false');
  if (el.disabled) btn.disabled = true;
  if (el.required) hid.dataset.required = '1';
  btn._label = labelText(el);
  if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) l.htmlFor = btn.id; }
  const w = document.createElement('span'); w.className = 'ow' + (kind === 'date' ? ' ow-date' : '');
  w.append(hid, btn);
  el.replaceWith(w);
  return { hid, btn };
}
function paintSel(hid, btn) {
  const o = btn._opts.find(x => x.v === hid.value) || btn._opts[0] || { t: '' };
  btn.innerHTML = '<span class="ot">' + escH(o.t) + '</span>' + CHEV;
  btn.classList.toggle('blank', !hid.value);
  btn.setAttribute('aria-label', (btn._label ? btn._label + ', ' : '') + o.t);
}
function paintDate(hid, btn) {
  btn.innerHTML = CAL + '<span class="ot">' + (hid.value ? escH(longDate(hid.value)) : 'No date') + '</span>';
  btn.classList.toggle('blank', !hid.value);
  btn.setAttribute('aria-label', (btn._label ? btn._label + ', ' : '') + (hid.value ? longDate(hid.value) : 'no date'));
}
export function enhance(root = document) {
  if (!root.querySelectorAll) return;
  root.querySelectorAll('select:not([multiple])').forEach(sel => {
    const opts = [...sel.options].map(o => ({ v: o.value, t: o.textContent }));
    const { hid, btn } = swap(sel, 'sel'); btn._opts = opts; paintSel(hid, btn);
  });
  root.querySelectorAll('input[type=date]').forEach(inp => {
    const { hid, btn } = swap(inp, 'date'); paintDate(hid, btn);
  });
}
// Set a value from code (tests, quick dates) and tell the page.
export function setValue(hid, v) {
  const btn = hid.nextElementSibling; hid.value = v;
  if (btn && btn._opts) paintSel(hid, btn); else if (btn) paintDate(hid, btn);
  hid.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------- the popover ----------
let open = null; // { pop, btn, hid }
// Older phones (before iOS 17) have no popover: the menu then floats above the page with a high layer instead.
const HAS_POP = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const show = pop => { if (HAS_POP) pop.showPopover(); else { pop.classList.add('nopop'); pop.style.zIndex = '1000'; } };
function close(back) {
  if (!open) return; const { pop, btn } = open; open = null;
  try { pop.hidePopover(); } catch (e) {} pop.remove();
  btn.setAttribute('aria-expanded', 'false'); if (back) btn.focus();
}
function place(pop, btn) {
  const b = btn.getBoundingClientRect(); const w = pop.offsetWidth, h = pop.offsetHeight;
  const below = b.bottom + 4 + h <= innerHeight - 8 || b.top - 4 - h < 8;
  pop.style.top = Math.max(8, below ? Math.min(innerHeight - h - 8, b.bottom + 4) : b.top - 4 - h) + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left)) + 'px';
}
function mkPop(btn, cls, role, label) {
  const pop = document.createElement('div'); pop.className = 'opop ' + cls; if (HAS_POP) pop.setAttribute('popover', 'manual');
  if (role) pop.setAttribute('role', role); if (label) pop.setAttribute('aria-label', label);
  btn.parentNode.append(pop); // inside the same dialog or panel, so a modal dialog keeps it usable
  return pop;
}
function keyOf(hid) { if (hid.id) return '#' + CSS.escape(hid.id); for (const a of hid.attributes) if (a.name.startsWith('data-')) return 'input[type=hidden][' + a.name + '="' + CSS.escape(a.value) + '"]'; return ''; }
function choose(hid, v) {
  const btn = hid.nextElementSibling; const k = keyOf(hid); close(true); if (hid.value === v) return;
  setValue(hid, v);
  const refocus = () => { if (btn.isConnected) { btn.focus(); return true; } const a = k && document.querySelector(k); if (a && a.nextElementSibling) { a.nextElementSibling.focus(); return true; } return false; };
  refocus();
  // some screens redraw after a short transition: find the control again once they have
  setTimeout(() => { const f = document.activeElement; if (!f || f === document.body || !f.isConnected) refocus(); }, 450);
}

function openSel(btn) {
  const hid = btn.previousElementSibling; const opts = btn._opts;
  const pop = mkPop(btn, 'osel-pop', 'dialog', btn._label || 'Choose');
  const search = opts.length > 8;
  const lid = 'ol' + (++seq);
  pop.innerHTML = (search ? '<input class="osearch" type="text" placeholder="Search" aria-label="Search ' + escH(btn._label || 'options') + '" aria-controls="' + lid + '" autocomplete="off">' : '') +
    '<div class="olist" role="listbox" id="' + lid + '" aria-label="' + escH(btn._label || 'Options') + '"></div>';
  const list = pop.querySelector('.olist');
  const draw = q => {
    const shown = opts.filter(o => !q || o.t.toLowerCase().includes(q.toLowerCase()));
    list.innerHTML = shown.map(o => '<button type="button" role="option" tabindex="-1" data-v="' + escH(o.v) + '" aria-selected="' + (o.v === hid.value) + '"><span>' + escH(o.t) + '</span>' + (o.v === hid.value ? '<svg class="otick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>' : '') + '</button>').join('') || '<p class="onone">No match</p>';
  };
  draw('');
  open = { pop, btn, hid }; btn.setAttribute('aria-expanded', 'true');
  show(pop); place(pop, btn);
  const items = () => [...list.querySelectorAll('[role=option]')];
  const s = pop.querySelector('.osearch');
  if (s) { s.focus(); s.addEventListener('input', () => draw(s.value)); }
  else (items().find(x => x.getAttribute('aria-selected') === 'true') || items()[0])?.focus();
  pop.addEventListener('click', e => { const o = e.target.closest('[role=option]'); if (o) choose(hid, o.dataset.v); });
  pop.addEventListener('keydown', e => {
    const it = items(); const i = it.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); it[(i + 1) % it.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0 && s) s.focus(); else it[(i - 1 + it.length) % it.length]?.focus(); }
    else if (e.key === 'Home' && i >= 0) { e.preventDefault(); it[0]?.focus(); }
    else if (e.key === 'End' && i >= 0) { e.preventDefault(); it[it.length - 1]?.focus(); }
    else if (e.key === 'Enter' && document.activeElement === s && it.length) { e.preventDefault(); choose(hid, it[0].dataset.v); }
    else if (!s && e.key.length === 1 && /\S/.test(e.key)) { const n = it.find((x, k) => k > i && x.textContent.toLowerCase().startsWith(e.key.toLowerCase())) || it.find(x => x.textContent.toLowerCase().startsWith(e.key.toLowerCase())); if (n) n.focus(); }
  });
}

// Typing "29 nov", "29.11", "29/11/2026" or "2026-11-29" gives a date; the year is the next one that makes sense.
export function parseTyped(s, today = TODAY) {
  s = String(s || '').trim().toLowerCase(); if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[.\/\s-](\d{1,2})(?:[.\/\s-](\d{2,4}))?$/.exec(s))) { d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : 0; }
  else if ((m = /^(\d{1,2})\s*([a-zéû]{3,})\.?(?:\s+(\d{4}))?$/.exec(s))) { d = +m[1]; const k = m[2].slice(0, 3); const fr = { jan: 1, fév: 2, fev: 2, mar: 3, avr: 4, mai: 5, jui: 6, aoû: 8, aou: 8, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12 }; mo = MON.findIndex(x => x.toLowerCase() === k) + 1 || fr[k] || 0; if (m[2].startsWith('juil')) mo = 7; y = m[3] ? +m[3] : 0; }
  else return '';
  if (y && y < 100) y += 2000;
  const ty = +today.slice(0, 4);
  if (!y) { y = ty; if (iso(new Date(Date.UTC(y, mo - 1, d))) < addDays(today, -60)) y += 1; }
  const out = new Date(Date.UTC(y, mo - 1, d));
  if (!mo || mo > 12 || !d || out.getUTCMonth() !== mo - 1) return '';
  return iso(out);
}
function openDate(btn) {
  const hid = btn.previousElementSibling; const req = !!hid.dataset.required;
  const pop = mkPop(btn, 'odate-pop', 'dialog', 'Choose a date' + (btn._label ? ' for ' + btn._label.toLowerCase() : ''));
  let view = (hid.value || TODAY).slice(0, 7);
  let focusDay = hid.value || TODAY;
  const dow = s => (parse(s).getUTCDay() + 6) % 7; // Monday = 0
  const nextMon = addDays(TODAY, (7 - dow(TODAY)) || 7);
  const shortcuts = [['Today', TODAY], ['Tomorrow', addDays(TODAY, 1)], ['Next Monday', nextMon]].concat(req ? [] : [['No date', '']]);
  const draw = () => {
    const [y, m] = view.split('-').map(Number);
    const first = view + '-01'; const start = addDays(first, -dow(first));
    let cells = ''; for (let i = 0; i < 42; i++) { const d = addDays(start, i); const inM = d.slice(0, 7) === view; cells += (i % 7 === 0 ? '<tr>' : '') + '<td><button type="button" tabindex="' + (d === focusDay ? 0 : -1) + '" data-d="' + d + '" class="' + (inM ? '' : 'out') + (d === TODAY ? ' today' : '') + '" aria-pressed="' + (d === hid.value) + '" aria-label="' + longDate(d) + (d === TODAY ? ', today' : '') + '">' + Number(d.slice(8)) + '</button></td>' + (i % 7 === 6 ? '</tr>' : ''); }
    pop.innerHTML = '<div class="od-short">' + shortcuts.map(([l, d]) => '<button type="button" class="od-s" data-d="' + d + '">' + l + (d ? '<small>' + longDate(d).replace(/ \d{4}$/, '') + '</small>' : '') + '</button>').join('') + '</div>' +
      '<div class="od-main"><label class="od-type"><span class="sr">Type a date</span><input type="text" placeholder="Type a date, like 29 nov" autocomplete="off"></label>' +
      '<div class="od-head"><button type="button" class="od-nav" data-m="-1" aria-label="Previous month"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg></button><b aria-live="polite">' + MONTH[m - 1] + ' ' + y + '</b><button type="button" class="od-nav" data-m="1" aria-label="Next month"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg></button></div>' +
      '<table class="od-grid" role="grid"><thead><tr>' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x, i) => '<th scope="col" abbr="' + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i] + '">' + x + '</th>').join('') + '</tr></thead><tbody>' + cells + '</tbody></table><small class="od-err" hidden>That is not a date we can read.</small></div>';
  };
  draw();
  open = { pop, btn, hid }; btn.setAttribute('aria-expanded', 'true');
  show(pop); place(pop, btn);
  const focusGrid = () => pop.querySelector('.od-grid [tabindex="0"]')?.focus();
  focusGrid();
  pop.addEventListener('click', e => {
    const n = e.target.closest('.od-nav'); if (n) { const [y, m] = view.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(n.dataset.m), 1)); view = iso(d).slice(0, 7); focusDay = view + '-01'; draw(); pop.querySelector('[data-m="' + n.dataset.m + '"]').focus(); return; }
    const b = e.target.closest('[data-d]'); if (b) choose(hid, b.dataset.d);
  });
  pop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.target.matches('.od-type input')) {
      if (e.key === 'Enter') { e.preventDefault(); const v = parseTyped(e.target.value); if (v) choose(hid, v); else pop.querySelector('.od-err').hidden = false; }
      return;
    }
    const day = e.target.closest('.od-grid [data-d]'); if (!day) { if (e.key === 'Tab' && !e.shiftKey && e.target === pop.querySelector('.od-grid [tabindex="0"]')) close(); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const d = day.dataset.d; let n = d;
      if (step) n = addDays(d, step);
      else if (e.key === 'Home') n = addDays(d, -dow(d)); else if (e.key === 'End') n = addDays(d, 6 - dow(d));
      else { const x = parse(d); x.setUTCMonth(x.getUTCMonth() + (e.key === 'PageUp' ? -1 : 1)); n = iso(x); }
      focusDay = n; if (n.slice(0, 7) !== view) { view = n.slice(0, 7); }
      draw(); focusGrid();
    } else if (e.key === 'Tab' && !e.shiftKey) close();
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.osel, .odate');
  if (b) { e.preventDefault(); const was = open && open.btn === b; close(); if (!was) (b.classList.contains('odate') ? openDate : openSel)(b); return; }
  if (open && !e.target.closest('.opop')) close();
}, true);
document.addEventListener('keydown', e => {
  const b = e.target.closest && e.target.closest('.osel, .odate');
  if (b && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); (b.classList.contains('odate') ? openDate : openSel)(b); }
}, true);
addEventListener('resize', () => close());
document.addEventListener('scroll', e => { if (open && !(e.target.closest && e.target.closest('.opop'))) { if (open.btn.isConnected) place(open.pop, open.btn); else close(); } }, true);
// Everything the app draws later is swapped too.
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('select:not([multiple]), input[type=date]')) enhance(n.parentNode); else if (n.querySelector('select, input[type=date]')) enhance(n); } }).observe(document.documentElement, { childList: true, subtree: true });
