/* Spreadsheet X-ray: UI. Reads the file in the browser, hands it to engine.js and ask.js. */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => typeof v === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v == null ? '' : v);
  const DEMO = 'demo/Sales_commissions_FINAL_v3 (2).xlsx';
  let A = null, specMd = '', fileName = '';

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400); }

  /* ---------- reading files ---------- */
  let excelLoading = null;
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    if (!excelLoading) excelLoading = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'vendor/exceljs.min.js'; s.onload = ok; s.onerror = () => ko(new Error('Could not load the Excel reader.')); document.head.appendChild(s); });
    return excelLoading;
  }

  async function readXlsx(buf, name) {
    await loadExcelJS();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buf);
    const wb = { name, sheets: [] };
    book.eachSheet((ws) => {
      const sheet = { name: ws.name, hidden: ws.state === 'hidden' || ws.state === 'veryHidden', cells: new Map(), maxR: 0, maxC: 0 };
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        row.eachCell({ includeEmpty: false }, (cell, c) => {
          const raw = cell.value;
          let v = raw, f = null, err = null;
          if (raw && typeof raw === 'object' && !(raw instanceof Date)) {
            if ('formula' in raw || 'sharedFormula' in raw) {
              f = cell.formula || raw.formula || null;
              v = raw.result;
              if (v && typeof v === 'object' && 'error' in v) { err = v.error; v = null; }
              if (v && typeof v === 'object' && !(v instanceof Date)) v = null;
            } else if ('richText' in raw) v = raw.richText.map((x) => x.text).join('');
            else if ('error' in raw) { err = raw.error; v = null; }
            else if ('text' in raw) v = typeof raw.text === 'string' ? raw.text : (raw.text && raw.text.richText ? raw.text.richText.map((x) => x.text).join('') : '');
            else v = null;
          }
          if (f) f = String(f).replace(/^=/, '');
          if (v === undefined) v = null;
          const addr = XRay.addrOf(r, c);
          sheet.cells.set(addr, { sheet: ws.name, addr, r, c, v, f, err });
          if (r > sheet.maxR) sheet.maxR = r; if (c > sheet.maxC) sheet.maxC = c;
        });
      });
      wb.sheets.push(sheet);
    });
    return wb;
  }

  function readCsv(text, name) {
    const first = text.split(/\r?\n/)[0] || '';
    const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const sname = name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Data';
    const sheet = { name: sname, hidden: false, cells: new Map(), maxR: 0, maxC: 0 };
    rows.forEach((cols, i) => cols.forEach((raw, j) => {
      const s = raw.trim(); if (!s) return;
      let v = s;
      const n = s.replace(/\s/g, '');
      if (/^-?\d+(?:[.,]\d+)?$/.test(n)) v = parseFloat(n.replace(',', '.'));
      else if (/^\d{4}-\d{2}-\d{2}/.test(s)) v = new Date(s.slice(0, 10) + 'T00:00:00Z');
      else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) { const [dd, mm, yy] = s.split('/'); v = new Date(Date.UTC(+yy, +mm - 1, +dd)); }
      const r = i + 1, c = j + 1, addr = XRay.addrOf(r, c);
      const f = /^=/.test(s) ? s.slice(1) : null;
      sheet.cells.set(addr, { sheet: sname, addr, r, c, v: f ? null : v, f, err: null });
      sheet.maxR = Math.max(sheet.maxR, r); sheet.maxC = Math.max(sheet.maxC, c);
    }));
    return { name, sheets: [sheet] };
  }

  async function openFile(buf, name) {
    const drop = $('#drop'); drop.classList.add('busy');
    try {
      const wb = /\.csv$/i.test(name) ? readCsv(new TextDecoder('utf-8').decode(buf), name) : await readXlsx(buf, name);
      if (!wb.sheets.some((s) => s.cells.size)) throw new Error('This file looks empty.');
      fileName = name;
      A = XRay.analyse(wb);
      specMd = XRay.spec(A, name);
      render();
    } catch (e) {
      console.error(e);
      toast(/zip|central directory|end of data/i.test(e.message) ? 'This doesn’t look like an .xlsx file. Try saving it as .xlsx or .csv.' : e.message || 'Could not read this file.');
    } finally { drop.classList.remove('busy'); }
  }

  $('#file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await openFile(await f.arrayBuffer(), f.name); e.target.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) await openFile(await f.arrayBuffer(), f.name); });
  $('#demoBtn').addEventListener('click', async () => {
    const b = $('#demoBtn'); b.disabled = true; b.textContent = 'Opening…';
    try { const r = await fetch(encodeURI(DEMO)); if (!r.ok) throw new Error('Demo file not found'); await openFile(await r.arrayBuffer(), DEMO.split('/').pop()); }
    catch (e) { toast(e.message); }
    finally { b.disabled = false; b.textContent = 'Open the demo file'; }
  });
  $('#another').addEventListener('click', () => { $('#report').hidden = true; $('#start').hidden = false; $('#start').scrollIntoView({ behavior: 'smooth' }); });

  /* ---------- tabs ---------- */
  function show(tab) {
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('#report .view').forEach((v) => { v.hidden = v.id !== 'view-' + tab; });
    if (tab === 'ask') $('#askInput').focus({ preventScroll: true });
  }
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });

  /* ---------- render ---------- */
  function render() {
    $('#start').hidden = true; $('#report').hidden = false;
    const wb = A.wb;
    const cellCount = wb.sheets.reduce((s, x) => s + x.cells.size, 0);
    $('#fileName').textContent = fileName;
    $('#fileMeta').textContent = `${wb.sheets.length} sheet${wb.sheets.length > 1 ? 's' : ''} · ${cellCount.toLocaleString('en-US')} filled cells · ${A.formulas.length} formulas`;
    const high = A.risks.filter((r) => r.sev === 'high').length;
    $('#riskBadge').textContent = A.risks.length; $('#riskBadge').hidden = !A.risks.length;
    renderOverview(high); renderMap(); renderFindings(); renderSpec(); renderAsk();
    show('overview');
    $('#report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function gauge(score) {
    const band = score >= 60 ? ['Fragile', '#a23b1c'] : score >= 30 ? ['Needs care', '#8a5a00'] : ['Healthy', '#2f7a4f'];
    const R = 80, cx = 100, cy = 100, a = Math.PI * (1 - score / 100);
    const x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
    return `<svg viewBox="0 0 200 128" role="img" aria-label="Fragility score ${score} out of 100: ${band[0]}">
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#e7dccb" stroke-width="16" stroke-linecap="round"/>
      ${score > 0 ? `<path d="M20 100 A80 80 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${band[1]}" stroke-width="16" stroke-linecap="round"/>` : ''}
      <text x="100" y="92" text-anchor="middle" font-family="Gloock, Georgia, serif" font-size="44" fill="#1f1a15">${score}</text>
      <text x="100" y="120" text-anchor="middle" font-family="Karla, sans-serif" font-size="15" font-weight="700" fill="${band[1]}">${band[0]}</text></svg>`;
  }

  function renderOverview(high) {
    $('#gauge').innerHTML = gauge(A.score);
    const hiddenUsed = A.wb.sheets.filter((s) => s.hidden && A.formulas.some((x) => x.refs.some((r) => r.sheet.toLowerCase() === s.name.toLowerCase())));
    const ruleEx = A.rules.find((r) => r.kind === 'rate') || A.rules[0];
    const parts = [];
    if (A.rules.length) parts.push(`<b>${A.rules.length} business rule${A.rules.length > 1 ? 's' : ''}</b> typed inside formulas${ruleEx ? ` (${esc(ruleEx.kind === 'rate' ? XRay.fmtNum(ruleEx.value * 100) + '% in ' + A.nodeLabel(ruleEx.example.node) : XRay.fmtNum(ruleEx.value) + ' in ' + A.nodeLabel(ruleEx.example.node))})` : ''}`);
    if (hiddenUsed.length) parts.push(`a hidden sheet, <b>${esc(hiddenUsed.map((s) => s.name).join(', '))}</b>, that the results depend on`);
    if (high) parts.push(`<b>${high} cell${high > 1 ? 's' : ''}</b> that already give wrong or frozen results`);
    $('#busText').innerHTML = parts.length
      ? `Nobody else would know about ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]}. That knowledge lives in one person's head today. This report puts it on paper.`
      : 'Good news: this file is fairly transparent. Its logic is visible and consistent, so someone else could take it over.';
    const k = [
      ['Formulas', A.formulas.length], ['Calculations', [...A.nodes.values()].filter((n) => n.kind === 'calc').length],
      ['Hidden rules', A.rules.length], ['High risks', high, high > 0]
    ];
    $('#kpis').innerHTML = k.map(([l, v, al]) => `<div class="kpi${al ? ' alert' : ''}"><span class="k-label">${l}</span><span class="k-val">${v}</span></div>`).join('');
    $('#topRisks').innerHTML = A.risks.slice(0, 4).map(riskItem).join('') || '<li class="empty">No risks found. Nice file.</li>';
  }

  function riskItem(r) {
    return `<li><span class="sev ${r.sev}">${r.sev}</span><span class="r-title">${esc(r.title)}</span><span class="r-detail">${esc(r.detail)}</span>${r.where ? `<span class="r-where"><span class="cell-btn" aria-label="Cells">${esc(r.where)}</span></span>` : ''}</li>`;
  }
  function renderFindings() {
    $('#rules').innerHTML = A.rules.map((r) => `<li><span class="sev rule">${r.kind}</span><span class="r-title">${esc(r.text)}</span><span class="r-detail">${esc(r.detail)}</span><span class="r-where"><span class="cell-btn">${esc(r.cellsLabel)}</span></span></li>`).join('') || '<li class="empty">No numbers typed inside formulas.</li>';
    $('#risks').innerHTML = A.risks.map(riskItem).join('') || '<li class="empty">Nothing worrying found.</li>';
  }

  /* ---------- formula map ---------- */
  const PALETTE = [['#1e3a2f', '#e3ebe5'], ['#a23b1c', '#f6e2d9'], ['#8a5a00', '#f5e8c8'], ['#3d5a80', '#e1e8f1'], ['#6b4c7a', '#ece3f0'], ['#4a6b2a', '#e8eedc']];
  let selKey = null;
  function renderMap() {
    const nodes = [...A.nodes.values()];
    const host = $('#map');
    if (!nodes.length) { host.innerHTML = '<p class="empty">No formulas in this file, so there is nothing to map. Ask questions about the data in the Ask tab.</p>'; $('#legend').innerHTML = ''; return; }
    const sheets = [...new Set(A.wb.sheets.map((s) => s.name))].filter((s) => nodes.some((n) => n.sheet === s));
    const color = (s) => PALETTE[sheets.indexOf(s) % PALETTE.length];
    $('#legend').innerHTML = sheets.map((s) => `<span><i style="background:${color(s)[0]}"></i>${esc(s)}${A.wb.sheets.find((x) => x.name === s).hidden ? ' (hidden)' : ''}</span>`).join('');
    const levels = new Map();
    nodes.forEach((n) => { if (!levels.has(n.level)) levels.set(n.level, []); levels.get(n.level).push(n); });
    const maxL = Math.max(...levels.keys());
    const W = 176, H = 46, GX = 70, GY = 14, P = 8;
    const pos = new Map();
    let maxRows = 0;
    for (let l = 0; l <= maxL; l++) {
      const col = (levels.get(l) || []);
      // order: by average position of inputs, then sheet, to reduce crossings
      col.forEach((n) => { const ys = [...n.in].map((k) => pos.get(k)).filter(Boolean).map((p) => p.y); n._ord = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : sheets.indexOf(n.sheet) * 1000 + (n.kind === 'param' ? 500 : 0); });
      col.sort((a, b) => a._ord - b._ord || a.label.localeCompare(b.label));
      col.forEach((n, i) => pos.set(n.key, { x: P + l * (W + GX), y: P + i * (H + GY) }));
      maxRows = Math.max(maxRows, col.length);
    }
    const SW = P * 2 + (maxL + 1) * W + maxL * GX, SH = P * 2 + maxRows * (H + GY) - GY;
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    let edges = '', boxes = '';
    nodes.forEach((n) => n.out.forEach((k) => {
      const a = pos.get(n.key), b = pos.get(k); if (!a || !b) return;
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
      edges += `<path class="edge" data-from="${esc(n.key)}" data-to="${esc(k)}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 4} ${y2}" marker-end="url(#arr)"/>`;
    }));
    nodes.forEach((n) => {
      const p = pos.get(n.key), [c1, c2] = color(n.sheet);
      const kind = n.kind === 'calc' ? (n.cells.length > 1 ? `calculated · ${n.cells.length} rows` : 'calculated') : n.kind === 'param' ? 'setting' : 'typed in';
      const risky = A.risks.some((r) => r.sev === 'high' && r.cells.some((c) => c.node === n.key));
      boxes += `<g class="node" tabindex="0" role="button" data-key="${esc(n.key)}" aria-label="${esc(n.label + ', ' + n.sheet + ', ' + kind)}" transform="translate(${p.x},${p.y})">
        <rect width="${W}" height="${H}" rx="10" fill="${n.kind === 'calc' ? c2 : '#fffdf9'}" stroke="${c1}" stroke-width="1.5" ${n.hidden || n.kind === 'param' ? 'stroke-dasharray="5 3"' : ''}/>
        <text x="12" y="20" font-family="Karla, sans-serif" font-size="14" font-weight="700" fill="#1f1a15">${esc(cut(n.label, 21))}</text>
        <text x="12" y="36" font-family="Karla, sans-serif" font-size="11.5" fill="#5a4f44">${esc(cut(n.sheet, 12))} · ${kind}</text>
        ${risky ? `<circle cx="${W - 12}" cy="12" r="6" fill="#a23b1c"><title>Has a high risk</title></circle>` : ''}</g>`;
    });
    host.innerHTML = `<svg width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" role="group" aria-label="Formula dependency map"><defs><marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#b9ab96"/></marker></defs><g>${edges}</g><g>${boxes}</g></svg>`;
    $$('.node', host).forEach((g) => {
      g.addEventListener('click', () => selectNode(g.dataset.key));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(g.dataset.key); } });
    });
    selKey = null;
    const first = A.sinks.sort((a, b) => b.level - a.level)[0];
    if (first) selectNode(first.key, true);
  }

  function selectNode(key, quiet) {
    const n = A.nodes.get(key); if (!n) return;
    selKey = key;
    const svg = $('#map svg');
    svg.classList.toggle('dim', !quiet);
    $$('.node', svg).forEach((g) => { const k = g.dataset.key; g.classList.toggle('sel', k === key && !quiet); g.classList.toggle('hl', k === key || n.in.has(k) || n.out.has(k)); });
    $$('.edge', svg).forEach((p) => p.classList.toggle('hl', !quiet && (p.dataset.from === key || p.dataset.to === key)));
    const link = (k) => `<li><button type="button" class="cell-btn" data-node="${esc(k)}">${esc(A.nodeLabel(k))}</button></li>`;
    const x = n.formula;
    const rules = A.rules.filter((r) => r.cells.some((c) => c.node === key));
    const risks = A.risks.filter((r) => r.cells.some((c) => c.node === key));
    let valueLine = '';
    if (!x) { const sh = A.wb.sheets.find((s) => s.name === n.sheet); const c = sh && sh.cells.get(key.split('!')[1]); if (c) valueLine = `<p>Current value: <b>${esc(fmt(c.v))}</b></p>`; }
    $('#nodeInfo').innerHTML = `<div class="node-info"><h3>${esc(n.label)}</h3><p class="hint">${esc(key)}${n.hidden ? ' · on a hidden sheet' : ''} · ${n.kind === 'calc' ? `calculated${n.cells.length > 1 ? ` in ${n.cells.length} rows` : ''}` : n.kind === 'param' ? 'a single setting other cells read' : 'typed in by hand'}</p></div>
      ${x ? `<p class="formula plain">${esc(n.label)} = ${esc(x.readable)}</p><details><summary>Show the raw Excel formula</summary><p class="formula">=${esc(x.f)}</p></details>` : valueLine}
      ${rules.length ? `<p><b>Hidden rule${rules.length > 1 ? 's' : ''}:</b> ${rules.map((r) => esc(r.text)).join('; ')}.</p>` : ''}
      ${risks.length ? `<p><b style="color:#a23b1c">Watch out:</b> ${risks.map((r) => esc(r.title)).join('; ')}.</p>` : ''}
      <div class="flow"><div><h4>Uses</h4><ul>${[...n.in].map(link).join('') || '<li class="empty">Nothing: typed in</li>'}</ul></div><div><h4>Feeds into</h4><ul>${[...n.out].map(link).join('') || '<li class="empty">Nothing: a final result</li>'}</ul></div></div>`;
    $$('#nodeInfo [data-node]').forEach((b) => b.addEventListener('click', () => selectNode(b.dataset.node)));
    if (!quiet && window.innerWidth < 800) $('#nodeInfo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- spec ---------- */
  function md(src) {
    const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s.,)]|$)/g, '$1<em>$2</em>');
    const out = []; const lines = src.split('\n'); let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); i++; }
      else if (/^\|/.test(l)) {
        const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        out.push('<table><thead><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + rows.slice(2).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      } else if (/^- /.test(l)) { const items = []; while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2)); out.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>'); }
      else if (l.trim()) { out.push(`<p>${inline(l)}</p>`); i++; }
      else i++;
    }
    return out.join('');
  }
  function renderSpec() { $('#spec').innerHTML = md(specMd); }
  $('#copySpec').addEventListener('click', async () => { try { await navigator.clipboard.writeText(specMd); toast('Spec copied'); } catch (e) { toast('Copy blocked by the browser. Use Download instead.'); } });
  $('#dlSpec').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([specMd], { type: 'text/markdown' }));
    a.download = 'spec-' + fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') + '.md';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  /* ---------- ask ---------- */
  function renderAsk() {
    const sug = XAsk.suggestions(A.tables);
    $('#suggest').innerHTML = sug.map((q) => `<button type="button" class="chip-btn">${esc(q)}</button>`).join('');
    $$('#suggest .chip-btn').forEach((b) => b.addEventListener('click', () => { $('#askInput').value = b.textContent; ask(b.textContent); }));
    $('#answers').innerHTML = A.tables.length ? '' : '<div class="panel miss"><p>X-ray couldn’t find a table with column headers in this file, so there is nothing to ask about yet.</p></div>';
  }
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#askInput').value.trim(); if (q) ask(q); });

  function barChart(groups, label) {
    const g = groups.slice(0, 12), max = Math.max(...g.map((x) => Math.abs(x.value)), 1);
    const topI = g.findIndex((x) => Math.abs(x.value) === max);
    const W = 640, LW = 150, row = 30, H = g.length * row + 8;
    const cut = (s) => (s.length > 20 ? s.slice(0, 19) + '…' : s);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g.map((x, i) => {
      const w = Math.max(2, (Math.abs(x.value) / max) * (W - LW - 90));
      return `<g transform="translate(0,${i * row + 4})"><text x="${LW - 10}" y="16" text-anchor="end" font-size="14" fill="#1f1a15">${esc(cut(x.key))}</text>
        <rect x="${LW}" y="2" width="${w.toFixed(1)}" height="20" rx="5" fill="${i === topI ? '#a23b1c' : '#1e3a2f'}" opacity="${i === topI ? 1 : 0.85}"/>
        <text x="${LW + w + 8}" y="16" font-size="13" font-weight="700" fill="#5a4f44">${esc(fmt(x.value))}</text></g>`;
    }).join('')}</svg>`;
  }
  function table(cols, rows) {
    return `<div class="res-table"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${typeof r[c] === 'number' ? 'n' : ''}">${esc(fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function ask(q) {
    let r;
    try { r = XAsk.answer(q, A.tables); } catch (e) { console.error(e); r = { ok: false, reason: 'error', lang: 'en' }; }
    const el = document.createElement('div');
    if (!r.ok) {
      const fr = r.lang === 'fr';
      const cols = A.tables.filter((t) => !t.hidden).map((t) => `<b>${esc(t.sheet)}</b>: ${t.cols.map((c) => esc(c.name)).join(', ')}`).join('<br>');
      el.className = 'panel answer miss';
      el.innerHTML = `<p class="q">${esc(q)}</p><p>${fr ? 'Je n’ai pas compris cette question avec mes règles. Essayez d’utiliser le nom d’une colonne, par exemple « total <i>colonne</i> par <i>colonne</i> ».' : 'I couldn’t match that question with my built-in rules. Try using a column name, like “total <i>column</i> by <i>column</i>”.'}</p><p class="hint">${fr ? 'Colonnes disponibles' : 'Columns I know'}:<br>${cols}</p>`;
    } else {
      const fr = r.lang === 'fr';
      el.className = 'panel answer';
      let body = `<p class="q">${esc(q)}</p><p class="a">${r.answer}</p>`;
      if (r.groups && r.groups.length > 1) body += `<div class="chart">${barChart(r.groups, r.valueLabel.replace(/<[^>]+>/g, ''))}</div>`;
      body += `<details><summary>${fr ? 'Comment je l’ai calculé' : 'How I calculated it'}</summary><ol class="how">${r.how.map((h) => `<li>${h}</li>`).join('')}</ol></details>`;
      if (r.groups && r.groups.length) body += `<details><summary>${fr ? 'Voir le tableau' : 'See the table'}</summary>${table([r.groupCol, r.valueLabel.replace(/<[^>]+>/g, '')], r.groups.map((x) => ({ [r.groupCol]: x.key, [r.valueLabel.replace(/<[^>]+>/g, '')]: x.value })))}</details>`;
      else if (r.rows && r.rows.length) body += `<details><summary>${fr ? `Voir les lignes (${r.rows.length})` : `See the rows (${r.rows.length})`}</summary>${table(r.cols, r.rows)}</details>`;
      el.innerHTML = body;
    }
    const host = $('#answers');
    host.prepend(el);
    while (host.children.length > 6) host.lastElementChild.remove();
  }

  // ?demo in the address opens the demo straight away (handy for sharing)
  if (/[?&]demo\b/.test(location.search)) $('#demoBtn').click();
})();
