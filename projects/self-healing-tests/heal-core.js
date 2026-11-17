// The healer's rules (plain code, no AI). When a test id is gone, it lists the elements a
// test could use and scores each against the recorded fingerprint of the lost element.
// It only proposes. Only a green rerun of the test accepts a repair (heal.js).
(function (root) {
  'use strict';
  const WEIGHTS = { words: 0.4, shape: 0.15, near: 0.15, ids: 0.15, place: 0.15 }; // sums to 1
  const OTHER_KIND = 0.3;   // an element of another kind keeps only 30% of its score
  const MIN_SCORE = 0.5;    // a match this good may be proposed...
  const LONE = { score: 0.35, margin: 0.25 }; // ...or a weaker one that nothing else comes close to
  // Below both: "could not heal, needs a person".
  const MARGIN = 0.2; // a repair at least this far ahead of the next best element is "clear"
  const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'your', 'to', 'and', 'for', 'g', 'btn']);

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function words(s) {
    return clean(s).toLowerCase().split(/[^a-z0-9%\-€.,]+/).map((w) => w.replace(/[.,]+$/, '')).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  }
  function overlap(a, b) {
    const A = new Set(words(a)), B = new Set(words(b));
    if (!A.size && !B.size) return 1;
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
    return n / (A.size + B.size - n);
  }

  function kind(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'input') return el.type === 'number' ? 'number box' : 'text box';
    if (t === 'select') return 'choice list';
    if (t === 'button') return 'button';
    return 'text output';
  }
  function labelOf(el, doc) {
    if (el.id) { const l = doc.querySelector('label[for="' + el.id + '"]'); if (l) return clean(l.textContent); }
    if (el.getAttribute('aria-labelledby')) { const l = doc.getElementById(el.getAttribute('aria-labelledby')); if (l) return clean(l.textContent); }
    return clean(el.getAttribute('aria-label'));
  }
  function nearOf(el) {
    const parts = [];
    const sec = el.closest('section'); if (sec) { const h = sec.querySelector('h2'); if (h) parts.push(h.textContent); }
    const w = el.closest('.wrapblock'); if (w) { const t = w.querySelector('.wraptitle'); if (t) parts.push(t.textContent); }
    if (!parts.length && el.closest('.actions')) parts.push('actions');
    return clean(parts.join(' '));
  }
  // What the element is made of, apart from its words: the options of a choice list,
  // or the input type and limits of a box. A redesign rarely changes these.
  function shapeOf(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'select') return clean(Array.from(el.options).map((o) => o.textContent).join(' '));
    if (t === 'input') return ['type-' + (el.getAttribute('type') || 'text'), el.min && 'min-' + el.min, el.max && 'max-' + el.max, el.inputMode && 'mode-' + el.inputMode, el.autocomplete && 'auto-' + el.autocomplete].filter(Boolean).join(' ');
    if (t === 'button') return 'type-' + (el.getAttribute('type') || 'submit');
    return clean([el.getAttribute('role') && 'role-' + el.getAttribute('role'), 'tag-' + t].filter(Boolean).join(' '));
  }
  function fingerprint(el, doc) {
    const r = el.getBoundingClientRect(), win = doc.defaultView || { scrollX: 0, scrollY: 0 };
    const W = doc.documentElement.scrollWidth || 1, H = doc.documentElement.scrollHeight || 1;
    return {
      id: el.id || '', test: el.getAttribute('data-test') || '', kind: kind(el),
      text: el.tagName === 'BUTTON' ? clean(el.textContent) : '', label: labelOf(el, doc), shape: shapeOf(el), near: nearOf(el),
      x: Math.round(((r.left + win.scrollX + r.width / 2) / W) * 100) / 100, y: Math.round(((r.top + win.scrollY + r.height / 2) / H) * 100) / 100
    };
  }
  function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function candidates(doc) {
    return Array.from(doc.querySelectorAll('input, select, button, output, [role=status]')).filter(visible).map((el) => ({ el, fp: fingerprint(el, doc) }));
  }
  function score(old, c) {
    const part = {
      words: overlap(old.text + ' ' + old.label, c.text + ' ' + c.label),
      shape: overlap(old.shape, c.shape),
      near: overlap(old.near, c.near),
      ids: overlap((old.test + ' ' + old.id).replace(/-/g, ' '), (c.test + ' ' + c.id).replace(/-/g, ' ')),
      place: Math.max(0, 1 - Math.hypot(old.x - c.x, old.y - c.y) / 0.5)
    };
    let s = 0; Object.keys(WEIGHTS).forEach((k) => { s += WEIGHTS[k] * part[k]; });
    if (old.kind !== c.kind) s *= OTHER_KIND;
    return { score: Math.round(s * 100) / 100, part };
  }
  // Top 5, best first. Ties go to the element higher on the page, so the order is fixed.
  function rank(old, doc, skip) {
    return candidates(doc).filter((c) => !(skip && skip.has(c.fp.id)))
      .map((c) => Object.assign({ id: c.fp.id, fp: c.fp }, score(old, c.fp)))
      .sort((a, b) => b.score - a.score || a.fp.y - b.fp.y || a.fp.x - b.fp.x).slice(0, 5);
  }
  function proposable(c, next) {
    if (!c) return false;
    return c.score >= MIN_SCORE || (c.score >= LONE.score && c.score - (next ? next.score : 0) >= LONE.margin - 1e-9);
  }
  function describe(fp) {
    const name = fp.text ? '"' + fp.text + '"' : fp.label ? 'labelled "' + fp.label + '"' : '';
    return [fp.kind, name, fp.near ? 'in ' + fp.near : ''].filter(Boolean).join(' ');
  }
  root.SH_HEAL = { WEIGHTS, OTHER_KIND, MIN_SCORE, LONE, proposable, MARGIN, words, overlap, fingerprint, candidates, score, rank, describe };
})(typeof window !== 'undefined' ? window : globalThis);
