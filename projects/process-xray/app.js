// Process X-ray page. Draws ONLY from PX_CORE.analyse(), so screen and checks share the same numbers.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const events = window.PX_GEN.generate();
  const A = window.PX_CORE.analyse(events);
  const STEPS = window.PX_CORE.STEPS;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n) => n.toLocaleString('en-GB');

  // Text is always set as text, never as HTML.
  function el(tag, cls, ...kids) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k)); });
    return n;
  }
  function svg(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function table(t, head, rows) {
    t.replaceChildren(el('thead', null, el('tr', null, head.map((h) => el('th', null, h)))), el('tbody', null, rows.map((r) => el('tr', null, r.map((c) => el('td', null, c))))));
  }

  $('sMain').textContent = A.sentenceMain;
  $('sDetail').textContent = A.sentenceDetail;

  // ---------- the map: one line of 5 steps, slowest arrow thick and rust (Olivia: no spaghetti) ----------
  let shownDetours = false;
  function draw() {
    // Always one horizontal line (Olivia: one glance). A phone gets a narrower drawing with the same layout.
    const compact = $('map').clientWidth < 560;
    const W = compact ? 440 : 1000, gap = compact ? 87 : 200, x0 = compact ? 46 : 100, Y = 150;
    const R = compact ? 19 : 30, f = compact ? 0.9 : 1;
    const pos = STEPS.map((s, i) => ({ x: x0 + i * gap, y: Y }));
    const top = shownDetours ? (compact ? 40 : 10) : Y - (compact ? 62 : 58), bottom = shownDetours ? Y + (compact ? 150 : 140) : Y + R + (compact ? 30 : 34);
    const s = svg('svg', { viewBox: `0 ${top} ${W} ${bottom - top}`, class: 'pmap' + (reduce ? '' : ' animate') + (compact ? ' compact' : '') });
    const defs = svg('defs');
    for (const [id, c, size] of [['ah', '#8a7f72', 12], ['ahs', '#a23b1c', 18], ['ahr', '#a23b1c', 12], ['aha', '#9a6212', 12]])
      { const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: size * f, markerHeight: size * f, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }); m.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: c })); defs.append(m); }
    s.append(defs);
    A.arrows.forEach((a, i) => {
      const p = pos[i], q = pos[i + 1], slow = i === A.slowest;
      const line = svg('line', { x1: p.x + R, y1: Y, x2: q.x - R - 3, y2: Y, class: 'seg' + (slow ? ' slow' : ''), 'marker-end': slow ? 'url(#ahs)' : 'url(#ah)' });
      line.style.animationDelay = (i * 0.4) + 's';
      s.append(line);
      const lx = (p.x + q.x) / 2;
      s.append(svg('text', { x: lx, y: Y - (compact ? 14 : 20), class: 'wait' + (slow ? ' slow' : ''), 'text-anchor': 'middle' }, compact ? a.avgDays + ' d' : a.avgDays + ' days'));
      if (slow) s.append(svg('text', { x: lx, y: Y - (compact ? 38 : 46), class: 'tagline', 'text-anchor': 'middle' }, 'slowest'));
    });
    STEPS.forEach((st, i) => {
      const p = pos[i];
      s.append(svg('circle', { cx: p.x, cy: Y, r: R, class: 'node' }));
      s.append(svg('text', { x: p.x, y: Y + 5, 'text-anchor': 'middle', class: 'num' }, String(i + 1)));
      s.append(svg('text', { x: p.x, y: Y + R + (compact ? 18 : 24), 'text-anchor': 'middle', class: 'step' }, st));
    });
    if (shownDetours) drawDetours(s, pos, compact, R, Y);
    $('map').replaceChildren(s);
    $('map').setAttribute('aria-label', 'Process map: ' + A.arrows.map((a) => `${a.from} to ${a.to}, ${a.avgDays} days`).join('; ') + '.');
  }
  const D = Object.fromEntries(A.detours.map((d) => [d.key, d]));
  function drawDetours(s, pos, compact, R, Y) {
    const o = pos[0], k = pos[2], h = compact ? 0.7 : 1;
    if (D.shippedBeforePaid) { // skips payment: Ordered straight to Packed, above the line
      s.append(svg('path', { d: `M ${o.x + 8} ${Y - R} C ${o.x + 40} ${Y - 130 * h}, ${k.x - 40} ${Y - 130 * h}, ${k.x - 8} ${Y - R - 2}`, class: 'det rule', 'marker-end': 'url(#ahr)' }));
      s.append(svg('text', { x: (o.x + k.x) / 2, y: Y - 128 * h, 'text-anchor': 'middle', class: 'dlab rule' }, D.shippedBeforePaid.count + ' shipped before payment'));
    }
    if (D.packedTwice) { // rework loop under Packed
      const ly = Y + R + (compact ? 24 : 32); // start under the step name, so the loop never crosses it
      s.append(svg('path', { d: `M ${k.x - 30 * h} ${ly} C ${k.x - 60 * h} ${ly + 60 * h}, ${k.x + 60 * h} ${ly + 60 * h}, ${k.x + 30 * h} ${ly + 2}`, class: 'det rework', 'marker-end': 'url(#aha)' }));
      s.append(svg('text', { x: k.x, y: Y + 118 * h + (compact ? 10 : 0), 'text-anchor': 'middle', class: 'dlab rework' }, D.packedTwice.count + ' packed twice'));
    }
    if (D.cancelledAfterPacking) { // exit: Packed to Cancelled, down and right
      const c = { x: k.x + (compact ? 95 : 150), y: Y + (compact ? 100 : 110) };
      s.append(svg('path', { d: `M ${k.x + R * 0.75} ${Y + R * 0.7} L ${c.x - 12} ${c.y - 10}`, class: 'det exit', 'marker-end': 'url(#aha)' }));
      s.append(svg('rect', { x: c.x - 9, y: c.y - 9, width: 18, height: 18, rx: 4, class: 'xnode' }));
      s.append(svg('text', { x: c.x + 16, y: c.y + 5, class: 'dlab exit' }, D.cancelledAfterPacking.count + (compact ? ' cancelled' : ' cancelled after packing')));
    }
  }
  draw();
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(draw, 150); });

  // ---------- slow orders ----------
  const slow = A.arrows[A.slowest];
  $('ordersTitle').textContent = `Slowest orders between ${window.PX_CORE.NOUN[slow.from]} and ${window.PX_CORE.NOUN[slow.to]}`;
  const maxWh = Math.max(...Object.values(slow.byWarehouse).map((w) => w.avgDays));
  $('whBars').replaceChildren(...Object.entries(slow.byWarehouse).map(([name, w]) =>
    el('div', 'bar' + (name === A.warehouses.worst ? ' worst' : ''), el('span', 'bl', name), el('span', 'bt', el('span', 'bf')), el('span', 'bv', w.avgDays + ' days'))));
  [...$('whBars').querySelectorAll('.bar')].forEach((b, i) => { b.querySelector('.bf').style.width = (Object.values(slow.byWarehouse)[i].avgDays / maxWh * 100) + '%'; });
  table($('ordersTable'), ['Order', 'Warehouse', 'Wait (days)'], A.slowOrders.map((o) => [o.order, o.warehouse, o.days]));
  $('showOrders').addEventListener('click', () => {
    const open = $('ordersBox').hidden; $('ordersBox').hidden = !open; $('showOrders').setAttribute('aria-expanded', String(open));
    if (open) $('ordersBox').scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  });

  // ---------- detours ----------
  const KIND = { rule: 'Rule broken', rework: 'Rework', exit: 'Exit' };
  $('detourList').replaceChildren(...A.detours.map((d) => {
    const b = el('button', 'detour ' + d.kind, el('span', 'dk', KIND[d.kind]), el('span', 'dl', d.label));
    b.type = 'button';
    b.addEventListener('click', () => {
      [...$('detourList').querySelectorAll('.detour')].forEach((x) => x.classList.toggle('on', x === b));
      table($('detourTable'), ['Order', 'Warehouse', 'Path it took'], d.orders.map((o) => [o.order, o.warehouse, o.path]));
      $('detourTable').hidden = false;
    });
    return el('li', null, b);
  }));
  $('showDetours').addEventListener('click', () => {
    shownDetours = $('detoursBox').hidden; $('detoursBox').hidden = !shownDetours; $('showDetours').setAttribute('aria-expanded', String(shownDetours));
    draw();
  });

  // ---------- key figures and the deeper views ----------
  const K = A.kpis;
  const kpi = (v, l) => el('div', 'kpi', el('b', null, v), el('span', null, l));
  $('kpis').replaceChildren(kpi(fmt(K.orders), 'orders (cases)'), kpi(fmt(K.events), 'events'), kpi(K.variants, 'variants'),
    kpi(K.conformance + '%', 'follow the reference process'), kpi(K.medianLeadDays + ' d', 'median order-to-delivery'), kpi(K.p90LeadDays + ' d', '90% delivered within'));
  table($('variants'), ['Path', 'Orders', 'Share'], A.variants.map((v) => [v.path + (v.happy ? '  (reference)' : ''), fmt(v.orders), v.share + '%']));
  table($('dfg'), ['From → to', 'Times'], A.directlyFollows.map((d) => [d.pair, fmt(d.count)]));
  $('evCount').textContent = fmt(events.length);
  const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);
  table($('log'), ['Case ID', 'Activity', 'Timestamp (UTC)', 'Warehouse'], events.slice(0, 25).map((e) => [e.order, e.step, iso(e.time), e.warehouse]));
  const csv = 'case_id,activity,timestamp_utc,warehouse\n' + events.map((e) => [e.order, e.step, new Date(e.time).toISOString(), e.warehouse].join(',')).join('\n') + '\n';
  $('csv').href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); // made in the page, nothing is fetched

  window.PX_RESULT = A; // read by the automatic checks
})();
