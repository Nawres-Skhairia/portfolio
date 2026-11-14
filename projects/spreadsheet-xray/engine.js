/* Spreadsheet X-ray engine: pure functions, no DOM.
   Workbook model: { name, sheets: [{ name, hidden, cells: Map(addr -> cell), maxR, maxC }] }
   cell: { sheet, addr, r, c, v (value or cached result), f (formula without "=" or null), err } */
(function (global) {
  'use strict';

  /* ---------- addresses ---------- */
  function colToNum(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  const addrOf = (r, c) => numToCol(c) + r;

  /* ---------- formula tokenising ---------- */
  const REF_RE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;
  const COLRANGE_RE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3}):\$?([A-Z]{1,3})(?![A-Za-z0-9_(])/g;

  function stripStrings(f) { return f.replace(/"(?:[^"]|"")*"/g, (m) => ' '.repeat(m.length)); }

  /* Returns refs with positions, on a formula with strings blanked out. */
  function findRefs(formula, ownSheet) {
    const f = stripStrings(formula);
    const refs = [];
    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(f))) {
      const prev = m.index > 0 ? f[m.index - 1] : '';
      if (/[A-Za-z0-9_.\]]/.test(prev)) continue; // part of a name / external
      const sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] || ownSheet);
      const r1 = +m[6], c1 = colToNum(m[4]);
      const ref = { start: m.index, end: m.index + m[0].length, text: m[0], sheet, r1, c1, absR1: !!m[5], absC1: !!m[3], r2: r1, c2: c1, absR2: !!m[5], absC2: !!m[3], range: false, explicitSheet: !!(m[1] || m[2]) };
      if (m[8]) { ref.range = true; ref.c2 = colToNum(m[8]); ref.r2 = +m[10]; ref.absC2 = !!m[7]; ref.absR2 = !!m[9]; }
      refs.push(ref);
    }
    COLRANGE_RE.lastIndex = 0;
    while ((m = COLRANGE_RE.exec(f))) {
      const prev = m.index > 0 ? f[m.index - 1] : '';
      if (/[A-Za-z0-9_.\]$]/.test(prev)) continue;
      if (refs.some((x) => m.index >= x.start && m.index < x.end)) continue;
      const sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] || ownSheet);
      refs.push({ start: m.index, end: m.index + m[0].length, text: m[0], sheet, r1: 1, c1: colToNum(m[3]), r2: 1048576, c2: colToNum(m[4]), range: true, wholeCol: true, absR1: true, absR2: true, absC1: true, absC2: true, explicitSheet: !!(m[1] || m[2]) });
    }
    return refs.sort((a, b) => a.start - b.start);
  }

  /* R1C1-style pattern so copied formulas compare equal. */
  function patternOf(cell) {
    if (!cell.f) return null;
    const refs = findRefs(cell.f, cell.sheet);
    let out = '', pos = 0;
    const f = cell.f;
    for (const x of refs) {
      out += f.slice(pos, x.start);
      const one = (r, c, ar, ac) => (ar ? 'R' + r : 'R[' + (r - cell.r) + ']') + (ac ? 'C' + c : 'C[' + (c - cell.c) + ']');
      out += (x.explicitSheet ? x.sheet + '!' : '') + (x.wholeCol ? 'COL' + x.c1 + ':' + x.c2 : one(x.r1, x.c1, x.absR1, x.absC1) + (x.range ? ':' + one(x.r2, x.c2, x.absR2, x.absC2) : ''));
      pos = x.end;
    }
    return out + f.slice(pos);
  }

  /* ---------- workbook structure helpers ---------- */
  function sheetByName(wb, name) { const n = name.toLowerCase(); return wb.sheets.find((s) => s.name.toLowerCase() === n); }
  function cellAt(sheet, r, c) { return sheet && sheet.cells.get(addrOf(r, c)); }
  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* Header row: first row with >= 2 text cells and no formulas. */
  function headerRow(sheet) {
    for (let r = 1; r <= Math.min(sheet.maxR, 10); r++) {
      let t = 0, f = 0;
      for (let c = 1; c <= sheet.maxC; c++) { const x = cellAt(sheet, r, c); if (x) { if (x.f) f++; else if (isText(x.v)) t++; } }
      if (t >= 2 && !f) return r;
    }
    return 0;
  }
  function headerLabel(sheet, c) {
    const hr = sheet._hr; if (!hr) return null;
    const x = cellAt(sheet, hr, c);
    return x && isText(x.v) ? String(x.v).trim() : null;
  }
  /* Label of a single cell: text to its left on the same row, else header. */
  function rowLabel(sheet, r, c) {
    for (let cc = c - 1; cc >= 1; cc--) { const x = cellAt(sheet, r, cc); if (x && !x.f && isText(x.v)) return String(x.v).trim(); }
    return null;
  }

  /* ---------- main analysis ---------- */
  function analyse(wb) {
    wb.sheets.forEach((s) => { s._hr = headerRow(s); });
    const formulas = [];
    wb.sheets.forEach((s) => s.cells.forEach((x) => { if (x.f) { x.pattern = patternOf(x); x.refs = findRefs(x.f, s.name); formulas.push(x); } }));

    /* dependents count per cell (expanded, capped) */
    const dependents = new Map();
    const addDep = (key, from) => { let a = dependents.get(key); if (!a) dependents.set(key, (a = new Set())); a.add(from); };
    formulas.forEach((x) => x.refs.forEach((ref) => {
      const sh = sheetByName(wb, ref.sheet); if (!sh) return;
      const r2 = Math.min(ref.r2, sh.maxR), c2 = Math.min(ref.c2, sh.maxC);
      let n = 0;
      for (let r = ref.r1; r <= r2 && n < 20000; r++) for (let c = ref.c1; c <= c2; c++, n++) addDep(sh.name + '!' + addrOf(r, c), x);
    }));

    /* column patterns */
    const colGroups = new Map(); // sheet!col -> {pattern -> [cells]}
    formulas.forEach((x) => {
      const k = x.sheet + '!' + x.c;
      let g = colGroups.get(k); if (!g) colGroups.set(k, (g = new Map()));
      let a = g.get(x.pattern); if (!a) g.set(x.pattern, (a = [])); a.push(x);
    });
    const dominant = new Map(); // sheet!col -> {pattern, cells}
    colGroups.forEach((g, k) => {
      let best = null, total = 0;
      g.forEach((cells, p) => { total += cells.length; if (!best || cells.length > best.cells.length) best = { pattern: p, cells }; });
      if (best && best.cells.length >= 3 && best.cells.length / total >= 0.5) dominant.set(k, Object.assign(best, { total }));
    });
    const inDominantSpan = (sn, r, c) => { const d = dominant.get(sn + '!' + c); if (!d) return false; const rs = d.cells.map((x) => x.r); return r >= Math.min(...rs) && r <= Math.max(...rs); };
    const inRepeated = (x) => { const d = dominant.get(x.sheet + '!' + x.c); return d && d.pattern === x.pattern; };

    /* ---------- nodes for the map ---------- */
    const nodes = new Map(); // key -> {key, sheet, label, kind:'input'|'calc'|'param', cells:[]}
    function nodeFor(sheetName, r, c, viaRange, fromCell) {
      const sh = sheetByName(wb, sheetName); if (!sh) return null;
      const target = cellAt(sh, r, c);
      const colKey = sh.name + '!' + numToCol(c);
      const header = headerLabel(sh, c);
      const isFormula = target && target.f;
      let key, label;
      if (isFormula) {
        if (inRepeated(target)) { key = colKey; label = header || numToCol(c); }
        else { key = sh.name + '!' + addrOf(r, c); label = (inDominantSpan(sh.name, r, c) && header ? header + ' (row ' + r + ')' : null) || rowLabel(sh, r, c) || header || addrOf(r, c); }
      } else if (viaRange || (fromCell && fromCell.sheet === sh.name && fromCell.r === r && sh._hr && r > sh._hr)) {
        key = colKey; label = header || numToCol(c);
      } else {
        key = sh.name + '!' + addrOf(r, c);
        label = rowLabel(sh, r, c) || header || addrOf(r, c);
      }
      let n = nodes.get(key);
      if (!n) nodes.set(key, (n = { key, sheet: sh.name, hidden: sh.hidden, label, kind: isFormula ? 'calc' : 'input', cells: [], in: new Set(), out: new Set(), formula: null }));
      if (!isFormula && !viaRange && key.includes(addrOf(r, c)) && !key.endsWith('!' + numToCol(c))) n.kind = 'param';
      return n;
    }
    formulas.forEach((x) => {
      const me = nodeFor(x.sheet, x.r, x.c, false, null);
      if (!me) return;
      me.cells.push(x);
      if (!me.formula) me.formula = x;
      x.node = me.key;
      x.refs.forEach((ref) => {
        const sh = sheetByName(wb, ref.sheet); if (!sh) return;
        if (ref.range) {
          const c2 = Math.min(ref.c2, sh.maxC);
          for (let c = ref.c1; c <= c2 && c - ref.c1 < 30; c++) {
            const n = nodeFor(sh.name, Math.max(ref.r1, (sh._hr || 0) + 1), c, true, x);
            if (n && n !== me) { n.out.add(me.key); me.in.add(n.key); }
          }
        } else {
          const n = nodeFor(sh.name, ref.r1, ref.c1, false, x);
          if (n && n !== me) { n.out.add(me.key); me.in.add(n.key); }
        }
      });
    });
    // levels (longest path), guarding cycles
    const level = new Map();
    const visiting = new Set();
    function lv(k) {
      if (level.has(k)) return level.get(k);
      if (visiting.has(k)) return 0;
      visiting.add(k);
      const n = nodes.get(k); let L = 0;
      n.in.forEach((p) => { L = Math.max(L, lv(p) + 1); });
      visiting.delete(k); level.set(k, L); return L;
    }
    nodes.forEach((n, k) => { n.level = lv(k); });

    /* ---------- readable formulas ---------- */
    function readable(x) {
      const f = x.f; let out = '', pos = 0;
      for (const ref of x.refs) {
        out += f.slice(pos, ref.start);
        const sh = sheetByName(wb, ref.sheet);
        let name = ref.text;
        if (sh) {
          if (ref.range) {
            const h = headerLabel(sh, ref.c1);
            name = (h ? (ref.c1 === ref.c2 ? h : h + '…' + (headerLabel(sh, ref.c2) || numToCol(ref.c2))) : ref.text.split('!').pop());
            name = '[' + (sh.name !== x.sheet ? sh.name + ' › ' : 'all ') + name + ']';
          } else {
            const same = sh.name === x.sheet && ref.r1 === x.r && sh._hr && x.r > sh._hr;
            const lab = same ? headerLabel(sh, ref.c1) : (rowLabel(sh, ref.r1, ref.c1) || headerLabel(sh, ref.c1));
            name = lab ? '[' + (sh.name !== x.sheet ? sh.name + ' › ' : '') + lab + ']' : ref.text;
          }
        }
        out += name; pos = ref.end;
      }
      out += f.slice(pos);
      return out.replace(/>=/g, ' ≥ ').replace(/<=/g, ' ≤ ').replace(/<>/g, ' ≠ ').replace(/\*/g, ' × ').replace(/\//g, ' ÷ ')
        .replace(/([^≥≤≠ ])>([^=])/g, '$1 > $2').replace(/([^≥≤≠ ])<([^=])/g, '$1 < $2').replace(/,/g, ', ').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
    }
    formulas.forEach((x) => { x.readable = readable(x); });

    /* ---------- hidden business rules: literals in formulas ---------- */
    const rules = [];
    const ruleMap = new Map();
    formulas.forEach((x) => {
      const blanked = stripStrings(x.f).split('');
      x.refs.forEach((r) => { for (let i = r.start; i < r.end; i++) blanked[i] = ' '; });
      const s = blanked.join('');
      const NUM = /(\d+(?:\.\d+)?)(%?)/g; let m;
      while ((m = NUM.exec(s))) {
        const prevCh = s[m.index - 1] || '';
        if (/[A-Za-z_$.]/.test(prevCh)) continue;
        let v = parseFloat(m[1]); if (m[2]) v = v / 100;
        const before = s.slice(0, m.index).replace(/\s+$/, ''), after = s.slice(m.index + m[0].length).replace(/^\s+/, '');
        const pb = before.slice(-2), p1 = before.slice(-1), a1 = after[0] || '';
        const fn = (before.match(/([A-Z][A-Z0-9.]*)\((?:[^()]*)$/) || [])[1] || '';
        let kind = null;
        if (/^(ROUND|ROUNDUP|ROUNDDOWN|VLOOKUP|HLOOKUP|INDEX|LEFT|RIGHT|MID|DATE|OFFSET|CHOOSE|MATCH|WEEKDAY|TEXT)$/.test(fn) && v <= 12 && Number.isInteger(v)) continue;
        if (/[<>=]/.test(p1) || /[<>]/.test(a1)) kind = 'threshold';
        else if (p1 === '*' || p1 === '/' || a1 === '*' || a1 === '/') kind = v > 0 && v < 1 ? 'rate' : 'factor';
        else if (fn === 'IF' && (p1 === ',' || p1 === ';')) kind = 'amount';
        else if (p1 === '+' || p1 === '-' || a1 === '+' || a1 === '-') kind = 'offset';
        if (!kind) continue;
        if ((v === 0 || v === 1) && kind !== 'threshold') continue;
        if (kind === 'threshold' && v === 0) continue;
        const key = x.sheet + '!' + (inRepeated(x) ? numToCol(x.c) : x.addr) + '|' + kind + '|' + v;
        let rule = ruleMap.get(key);
        if (!rule) { ruleMap.set(key, (rule = { kind, value: v, sheet: x.sheet, cells: [], node: x.node, example: x })); rules.push(rule); }
        if (!rule.cells.includes(x)) rule.cells.push(x);
      }
    });
    const nodeLabel = (k) => (nodes.get(k) || {}).label || k;
    rules.forEach((r) => {
      const where = nodeLabel(r.example.node) + ' (' + r.sheet + ')';
      const fmt = fmtNum(r.value);
      const n = r.cells.length;
      if (r.kind === 'rate') r.text = `A rate of ${fmtNum(r.value * 100)}% is typed directly inside ${where}`;
      else if (r.kind === 'factor') r.text = `A factor of ${fmt}${r.value > 1 && r.value < 2 ? ` (+${fmtNum((r.value - 1) * 100)}%)` : ''} is typed inside ${where}`;
      else if (r.kind === 'threshold') r.text = `A threshold of ${fmt} decides the result of ${where}`;
      else if (r.kind === 'amount') r.text = `A fixed amount of ${fmt} is written into ${where}`;
      else r.text = `A fixed adjustment of ${fmt} is added in ${where}`;
      r.detail = n > 1 ? `Repeated in ${n} formulas. To change it, someone must edit every one of them.` : 'It lives inside a formula, invisible unless you click the cell.';
      r.cellsLabel = rangeLabel(r.cells);
    });

    /* ---------- risks ---------- */
    const risks = [];
    const add = (sev, title, detail, cells) => risks.push({ sev, title, detail, cells: cells || [], where: rangeLabel(cells || []) });

    formulas.forEach((x) => {
      if (/#REF!/.test(x.f) || (x.err === '#REF!')) add('high', `Broken reference in ${nodeLabel(x.node)}`, `${x.sheet}!${x.addr} points to a cell that no longer exists (#REF!). Its result is wrong, and anything using it is too.`, [x]);
      else if (x.err) add('medium', `Error ${x.err} in ${nodeLabel(x.node)}`, `${x.sheet}!${x.addr} currently shows ${x.err}.`, [x]);
      if (/\[[^\]]+\]/.test(stripStrings(x.f))) add('high', 'Link to another file', `${x.sheet}!${x.addr} reads from an external workbook. If that file moves or is renamed, the number silently goes stale.`, [x]);
    });
    dominant.forEach((d, k) => {
      const [sheetName, colNum] = k.split('!');
      const sh = sheetByName(wb, sheetName);
      const rows = d.cells.map((c) => c.r);
      const minR = Math.min(...rows), maxR = Math.max(...rows);
      const label = headerLabel(sh, +colNum) || numToCol(+colNum);
      const odd = [], typed = [];
      for (let r = minR; r <= maxR; r++) {
        const x = cellAt(sh, r, +colNum);
        if (!x) continue;
        if (x.f && x.pattern !== d.pattern && !/#REF!/.test(x.f)) odd.push(x);
        if (!x.f && x.v !== null && x.v !== '' && x.v !== undefined) typed.push(x);
      }
      odd.forEach((x) => add('high', `One "${label}" formula is different`, `${sheetName}!${x.addr} does not follow the same formula as the other ${d.cells.length} rows: ${x.readable}. Usually a copy-paste accident or a forgotten exception.`, [x]));
      typed.forEach((x) => add('high', `A typed number replaced the "${label}" formula`, `${sheetName}!${x.addr} contains a fixed value (${fmtNum(x.v)}) where every other row calculates it. If the inputs change, this one won't.`, [x]));
    });
    const byNode = new Map();
    rules.filter((r) => r.cells.length >= 3).forEach((r) => { const k = r.sheet + '|' + r.example.node; if (!byNode.has(k)) byNode.set(k, []); byNode.get(k).push(r); });
    byNode.forEach((rs) => {
      const cells = [...new Set(rs.flatMap((r) => r.cells))];
      const vals = rs.map((r) => r.kind === 'rate' ? fmtNum(r.value * 100) + '%' : fmtNum(r.value));
      const lab = nodeLabel(rs[0].example.node);
      add('medium', `${rs.length > 1 ? vals.length + ' hardcoded numbers' : 'A hardcoded number'} in "${lab}", copied ${cells.length} times`, `${vals.length > 1 ? vals.slice(0, -1).join(', ') + ' and ' + vals[vals.length - 1] + ' are' : vals[0] + ' is'} typed directly into ${cells.length} formulas. Changing ${vals.length > 1 ? 'them' : 'it'} means editing every cell by hand; one missed cell and the totals disagree.`, cells);
    });
    wb.sheets.filter((s) => s.hidden).forEach((s) => {
      const used = formulas.filter((x) => x.refs.some((r) => r.sheet.toLowerCase() === s.name.toLowerCase()));
      add(used.length ? 'medium' : 'low', `Hidden sheet "${s.name}"`, used.length ? `${used.length} formula${used.length > 1 ? 's' : ''} depend on values in a sheet most users never see. Changes there go unnoticed.` : 'A hidden sheet nobody references. Probably safe to clean up, but someone hid it for a reason.', used);
    });
    const VOL = { TODAY: 'changes every day', NOW: 'changes every second', RAND: 'changes on every recalculation', RANDBETWEEN: 'changes on every recalculation', OFFSET: 'is invisible to dependency tracing and slows the file', INDIRECT: 'builds references from text: it breaks silently when sheets are renamed and cannot be traced' };
    Object.keys(VOL).forEach((fn) => {
      const cs = formulas.filter((x) => new RegExp('(^|[^A-Z.])' + fn + '\\(').test(stripStrings(x.f)));
      if (cs.length) add(fn === 'INDIRECT' || fn === 'OFFSET' ? 'medium' : 'low', `${fn}() used`, `${rangeLabel(cs)}: the result ${VOL[fn]}.`, cs);
    });
    formulas.forEach((x) => {
      const ifs = (x.f.match(/IF\(/g) || []).length;
      if (x.f.length > 180 || ifs >= 4) {
        if (!inRepeated(x) || dominant.get(x.sheet + '!' + x.c).cells[0] === x)
          add('low', `Very complex formula in ${nodeLabel(x.node)}`, `${x.sheet}!${x.addr} has ${ifs} nested IFs / ${x.f.length} characters. Only its author can safely change it.`, [x]);
      }
    });
    // key-person cells: params with many dependents
    nodes.forEach((n) => {
      if (n.kind !== 'param') return;
      const cnt = [...(dependents.get(n.key) || [])].length;
      if (cnt >= 3) add('low', `Single point of failure: "${n.label}"`, `${n.key} feeds ${cnt} calculations. One wrong edit here changes every result downstream, with no warning.`, []);
    });
    const order = { high: 0, medium: 1, low: 2 };
    risks.sort((a, b) => order[a.sev] - order[b.sev]);
    const score = Math.min(100, risks.reduce((s, r) => s + (r.sev === 'high' ? 12 : r.sev === 'medium' ? 6 : 2), 0) + Math.min(8, rules.length));

    /* ---------- tables (for spec + Ask) ---------- */
    const tables = wb.sheets.map((s) => tableOf(s)).filter(Boolean);

    /* ---------- summary ---------- */
    const sinks = [...nodes.values()].filter((n) => n.kind === 'calc' && n.out.size === 0);
    const sources = [...nodes.values()].filter((n) => n.kind !== 'calc' && n.out.size > 0);

    return { wb, formulas, nodes, rules, risks, score, tables, sinks, sources, dominant, readable, inRepeated, dependents, nodeLabel };
  }

  function tableOf(s) {
    const hr = s._hr; if (!hr) return null;
    const cols = [];
    for (let c = 1; c <= s.maxC; c++) { const h = cellAt(s, hr, c); if (h && isText(h.v)) cols.push({ c, name: String(h.v).trim() }); }
    if (cols.length < 2) return null;
    const rows = [];
    for (let r = hr + 1; r <= s.maxR; r++) {
      const row = {}; let filled = 0;
      cols.forEach((col) => { const x = cellAt(s, r, col.c); const v = x ? x.v : null; if (v !== null && v !== undefined && v !== '') filled++; row[col.name] = v === undefined ? null : v; });
      if (!filled) { if (rows.length) break; else continue; }
      if (filled < Math.ceil(cols.length / 3)) continue; // summary lines
      rows.push(row);
    }
    if (rows.length < 2) return null;
    cols.forEach((col) => {
      const vals = rows.map((r) => r[col.name]).filter((v) => v !== null && v !== undefined && v !== '');
      const nums = vals.filter(isNum).length, dates = vals.filter((v) => v instanceof Date).length;
      col.type = dates > vals.length / 2 ? 'date' : nums > vals.length / 2 ? 'number' : 'text';
      const fc = [...Array(rows.length).keys()].map((i) => cellAt(s, hr + 1 + i, col.c)).filter((x) => x && x.f).length;
      col.calculated = fc > rows.length / 2;
      col.example = vals[0];
      col.unique = new Set(vals.map((v) => String(v))).size;
    });
    return { sheet: s.name, hidden: s.hidden, cols, rows };
  }

  /* ---------- formatting helpers ---------- */
  function fmtNum(v) {
    if (typeof v !== 'number') return String(v);
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 }).format(v);
  }
  function rangeLabel(cells) {
    if (!cells.length) return '';
    const bySheet = {};
    cells.forEach((x) => { (bySheet[x.sheet] = bySheet[x.sheet] || []).push(x); });
    return Object.entries(bySheet).map(([s, cs]) => {
      if (cs.length === 1) return s + '!' + cs[0].addr;
      const sameCol = cs.every((x) => x.c === cs[0].c);
      if (sameCol) { const rs = cs.map((x) => x.r); return s + '!' + numToCol(cs[0].c) + Math.min(...rs) + ':' + numToCol(cs[0].c) + Math.max(...rs) + ' (' + cs.length + ' cells)'; }
      return s + ' (' + cs.length + ' cells)';
    }).join(', ');
  }

  /* ---------- spec (Markdown) ---------- */
  function spec(A, fileName) {
    const title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*\(\d+\)\s*$/, '').replace(/\b(final|v\d+)\b/gi, '').replace(/\s+/g, ' ').trim() || 'Workbook';
    const L = [];
    L.push(`# Functional spec: ${title}`, '', `_Generated by Spreadsheet X-ray from "${fileName}". Review before use._`, '');
    L.push('## 1. Purpose', '');
    const outs = A.sinks.map((n) => n.label);
    const ins = A.sources.map((n) => n.label);
    L.push(`This workbook calculates **${list(outs) || 'its results'}** from **${list(ins) || 'manually entered data'}**.`, '');
    L.push('## 2. Data entities', '');
    A.tables.forEach((t) => {
      L.push(`### ${t.sheet}${t.hidden ? ' (hidden sheet)' : ''}`, '', '| Field | Type | Source | Example |', '|---|---|---|---|');
      t.cols.forEach((c) => L.push(`| ${c.name} | ${c.type} | ${c.calculated ? 'calculated' : 'entered'} | ${ex(c.example)} |`));
      L.push('', `${t.rows.length} records.`, '');
    });
    L.push('## 3. Parameters (should become editable settings)', '');
    const params = [...A.nodes.values()].filter((n) => n.kind === 'param');
    if (!params.length && !A.rules.length) L.push('None found.');
    params.forEach((p) => { const sh = A.wb.sheets.find((s) => s.name === p.sheet); const addr = p.key.split('!')[1]; const c = sh && sh.cells.get(addr); L.push(`- **${p.label}** = ${c ? ex(c.v) : '?'} (currently ${p.key}${p.hidden ? ', hidden sheet' : ''})`); });
    A.rules.forEach((r) => L.push(`- **${ruleName(r, A)}** = ${r.kind === 'rate' ? fmtNum(r.value * 100) + '%' : fmtNum(r.value)} (currently hardcoded in ${r.cellsLabel})`));
    L.push('', '## 4. Business rules and calculations', '');
    const seen = new Set();
    A.formulas.forEach((x) => {
      const k = x.node; if (seen.has(k)) return; seen.add(k);
      L.push(`- **${A.nodeLabel(k)}** = \`${x.readable}\``);
    });
    L.push('', '## 5. Issues to fix before migrating', '');
    if (!A.risks.length) L.push('No major issues found.');
    A.risks.forEach((r) => L.push(`- [${r.sev.toUpperCase()}] ${r.title}: ${r.detail}`));
    L.push('', '## 6. Proposed application', '', '**Screens**', '');
    A.tables.filter((t) => !t.hidden).forEach((t) => L.push(`- ${t.sheet}: list with filters and search, create / edit form with validation, CSV import`));
    if (params.length || A.rules.length) L.push('- Settings: one place to edit every parameter above, with change history');
    if (outs.length) L.push(`- Dashboard: ${list(outs)}, recalculated automatically`);
    L.push('', '**Roles**', '', '- Editor: enters and edits data', '- Approver / manager: changes parameters, validates results', '- Viewer: reads the dashboard', '');
    L.push('**Validation rules**', '');
    A.rules.filter((r) => r.kind === 'threshold').forEach((r) => L.push(`- ${ruleName(r, A)}: threshold ${fmtNum(r.value)} must be configurable, not typed in formulas`));
    L.push('- Calculated fields are read-only: nobody can type over a result', '- Every change to data or parameters is logged (who, when, old value, new value)', '');
    return L.join('\n');
  }
  function ruleName(r, A) {
    const lab = A.nodeLabel(r.example.node);
    return r.kind === 'rate' ? `${lab} rate` : r.kind === 'threshold' ? `${lab} threshold` : r.kind === 'amount' ? `${lab} fixed amount` : `${lab} factor`;
  }
  function list(a) { const u = [...new Set(a)]; return u.length <= 1 ? (u[0] || '') : u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1]; }
  function ex(v) { if (v instanceof Date) return v.toISOString().slice(0, 10); if (v === null || v === undefined) return ''; return String(typeof v === 'number' ? fmtNum(v) : v).replace(/\|/g, '/').slice(0, 40); }

  global.XRay = { analyse, spec, findRefs, patternOf, colToNum, numToCol, addrOf, fmtNum, tableOf };
})(window);
