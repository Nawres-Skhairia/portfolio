// A small XML reader that builds a light element tree with the line, column and path of every element.
// It is only used AFTER libxml2 has confirmed the file is well-formed, and DOCTYPE/ENTITY are refused
// before that, so it never has to deal with DTDs or custom entities. Works in browsers and in Node.

const PREDEF = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] !== '#') return PREDEF[e];
    const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch (err) { return m; }
  });
}

class El {
  constructor(qname, line, col, parent) {
    const i = qname.indexOf(':');
    this.qname = qname;
    this.localName = i < 0 ? qname : qname.slice(i + 1);
    this.prefix = i < 0 ? '' : qname.slice(0, i);
    this.attrs = {};
    this.children = [];
    this.parts = []; // own text pieces
    this.line = line; this.col = col;
    this.parentNode = parent;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  get textContent() {
    if (!this.children.length) return this.parts.join('');
    return this.parts.join('') + this.children.map((c) => c.textContent).join('');
  }
  get path() {
    const segs = [];
    for (let e = this; e && e.parentNode; e = e.parentNode) {
      const sibs = e.parentNode.children.filter((c) => c.localName === e.localName);
      segs.unshift(sibs.length > 1 ? `${e.localName}[${sibs.indexOf(e) + 1}]` : e.localName);
    }
    return segs.join('/').replace(/^Document\/CstmrCdtTrfInitn\//, '');
  }
  namespace() {
    const key = this.prefix ? 'xmlns:' + this.prefix : 'xmlns';
    for (let e = this; e; e = e.parentNode) if (e.attrs[key] != null) return e.attrs[key];
    return null;
  }
}

export function parseTree(src) {
  const root = new El('#document', 0, 0, null);
  let cur = root, i = 0, line = 1, lineStart = 0, scanned = 0;
  const n = src.length;
  const byLine = new Map(); // line -> [elements starting on it]
  function advanceTo(pos) {
    for (let k = scanned; k < pos; k++) if (src.charCodeAt(k) === 10) { line++; lineStart = k + 1; }
    scanned = pos;
  }
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { if (cur !== root) cur.parts.push(decode(src.slice(i))); break; }
    if (lt > i && cur !== root) cur.parts.push(decode(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt + 4); i = i < 0 ? n : i + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9); cur.parts.push(src.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue;
    }
    if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt + 2); i = i < 0 ? n : i + 2; continue; }
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt); i = gt < 0 ? n : gt + 1;
      if (cur.parentNode) cur = cur.parentNode;
      continue;
    }
    // start tag: find its end, respecting quoted attribute values
    let j = lt + 1, q = null;
    for (; j < n; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const body = src.slice(lt + 1, j);
    const selfClose = body.endsWith('/');
    const inner = selfClose ? body.slice(0, -1) : body;
    const nm = inner.match(/^[^\s/>]+/);
    advanceTo(lt);
    const el = new El(nm ? nm[0] : '?', line, lt - lineStart + 1, cur);
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
    const rest = inner.slice(nm ? nm[0].length : 0);
    while ((a = re.exec(rest))) el.attrs[a[1]] = decode(a[3] != null ? a[3] : a[4]);
    cur.children.push(el);
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push(el);
    if (!selfClose) cur = el;
    i = j + 1;
  }
  return { root, documentElement: root.children[0] || null, byLine };
}

// --- helpers by local name ---
export const kids = (el, name) => (el ? el.children.filter((c) => c.localName === name) : []);
export const kid = (el, name) => (el ? el.children.find((c) => c.localName === name) || null : null);
export function path(el, ...names) { let c = el; for (const nm of names) { c = kid(c, nm); if (!c) return null; } return c; }
export const text = (el) => (el ? el.textContent.trim() : null);
export function all(el, name, out = []) {
  if (!el) return out;
  for (const c of el.children) { if (c.localName === name) out.push(c); all(c, name, out); }
  return out;
}
