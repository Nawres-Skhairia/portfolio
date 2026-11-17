// Process X-ray core: turns any order log into the process map, the slowest step, the detours and the
// sentence. Pure code, no AI, no page access (R2, R3). The page draws ONLY from analyse()'s result,
// and the automatic check runs the same function, so screen and check always use the same numbers (AT3).
(function (root) {
  'use strict';
  const STEPS = ['Ordered', 'Paid', 'Packed', 'Shipped', 'Delivered'];
  const DAY = 864e5;
  const r1 = (x) => Math.round(x * 10) / 10;
  const NOUN = { Ordered: 'ordering', Paid: 'payment', Packed: 'packing', Shipped: 'shipping', Delivered: 'delivery' };
  const quantile = (sorted, q) => { if (!sorted.length) return 0; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

  function paths(events) {
    const by = new Map();
    for (const e of events) {
      if (!by.has(e.order)) by.set(e.order, { order: e.order, warehouse: e.warehouse, ev: [] });
      by.get(e.order).ev.push(e);
    }
    for (const p of by.values()) p.ev.sort((a, b) => a.time - b.time);
    return [...by.values()];
  }

  // Wait from step A to step B in one order: the last A before the first B. Null if B never follows A.
  function waitOf(p, a, b) {
    const bi = p.ev.findIndex((e) => e.step === b);
    if (bi < 0) return null;
    let ai = -1;
    for (let i = 0; i < bi; i++) if (p.ev[i].step === a) ai = i;
    return ai < 0 ? null : (p.ev[bi].time - p.ev[ai].time) / DAY;
  }

  const DETOURS = [
    { key: 'shippedBeforePaid', kind: 'rule', label: (n) => `${n} orders shipped before payment`,
      test: (p) => { const s = p.ev.findIndex((e) => e.step === 'Shipped'), pd = p.ev.findIndex((e) => e.step === 'Paid'); return s >= 0 && (pd < 0 || pd > s); } },
    { key: 'packedTwice', kind: 'rework', label: (n) => `${n} orders packed twice`,
      test: (p) => p.ev.filter((e) => e.step === 'Packed').length >= 2 },
    { key: 'cancelledAfterPacking', kind: 'exit', label: (n) => `${n} orders cancelled after packing`,
      test: (p) => { const c = p.ev.findIndex((e) => e.step === 'Cancelled'); return c > 0 && p.ev.slice(0, c).some((e) => e.step === 'Packed'); } }
  ];

  function analyse(events) {
    const ps = paths(events);
    const arrows = [];
    for (let i = 0; i < STEPS.length - 1; i++) {
      const a = STEPS[i], b = STEPS[i + 1];
      const waits = ps.map((p) => ({ p, w: waitOf(p, a, b) })).filter((x) => x.w !== null);
      const avg = waits.reduce((s, x) => s + x.w, 0) / waits.length;
      const byWh = {};
      for (const wh of ['North', 'South']) {
        const ws = waits.filter((x) => x.p.warehouse === wh);
        byWh[wh] = { orders: ws.length, avgDays: r1(ws.reduce((s, x) => s + x.w, 0) / ws.length), totalDays: ws.reduce((s, x) => s + x.w, 0) };
      }
      arrows.push({ from: a, to: b, orders: waits.length, avgDays: r1(avg), exactAvg: avg, byWarehouse: byWh, waits });
    }
    // AT2: the slowest arrow is the largest average wait, compared on exact values.
    const order = arrows.map((x, i) => i).sort((x, y) => arrows[y].exactAvg - arrows[x].exactAvg);
    const slow = arrows[order[0]], second = arrows[order[1]];
    const times = r1(slow.exactAvg / second.exactAvg);
    const whs = Object.entries(slow.byWarehouse).sort((x, y) => y[1].totalDays - x[1].totalDays);
    const share = whs[0][1].totalDays / (whs[0][1].totalDays + whs[1][1].totalDays);
    const slowOrders = slow.waits.slice().sort((x, y) => y.w - x.w).slice(0, 10)
      .map((x) => ({ order: x.p.order, warehouse: x.p.warehouse, days: r1(x.w) }));
    const detours = DETOURS.map((d) => {
      const hits = ps.filter(d.test);
      return { key: d.key, kind: d.kind, count: hits.length, label: d.label(hits.length),
        orders: hits.slice(0, 10).map((p) => ({ order: p.order, warehouse: p.warehouse, path: p.ev.map((e) => e.step).join(' → ') })) };
    }).filter((d) => d.count > 0);

    // R3: the sentence is fixed wording filled with computed numbers only.
    const sentenceMain = `Orders wait ${slow.avgDays} days between ${NOUN[slow.from]} and ${NOUN[slow.to]}, ${times} times longer than the next slowest step.`;
    const sentenceDetail = share > 0.5 ? `${Math.round(share * 100)}% of that waiting happens at the ${whs[0][0]} warehouse: ${whs[0][1].avgDays} days on average, against ${whs[1][1].avgDays} at ${whs[1][0]}.` : '';
    const sentence = (sentenceMain + ' ' + sentenceDetail).trim();

    // Variants: each distinct path through the process, with its share of orders.
    const vmap = new Map();
    for (const p of ps) { const k = p.ev.map((e) => e.step).join(' → '); vmap.set(k, (vmap.get(k) || 0) + 1); }
    const variants = [...vmap.entries()].sort((a, b) => b[1] - a[1]).map(([path, n]) => ({ path, orders: n, share: r1(n / ps.length * 100), happy: path === STEPS.join(' → ') }));
    // Conformance against the reference process (the 5 steps, once each, in order).
    const happy = variants.filter((v) => v.happy).reduce((s, v) => s + v.orders, 0);
    // Lead time: first event to Delivered, for delivered orders.
    const leads = ps.map((p) => { const d = p.ev.find((e) => e.step === 'Delivered'); return d ? (d.time - p.ev[0].time) / DAY : null; }).filter((x) => x !== null).sort((a, b) => a - b);
    // Directly-follows relations: every pair of consecutive events, counted (the raw material of a process map).
    const df = new Map();
    for (const p of ps) for (let i = 0; i + 1 < p.ev.length; i++) { const k = p.ev[i].step + ' → ' + p.ev[i + 1].step; df.set(k, (df.get(k) || 0) + 1); }
    const directlyFollows = [...df.entries()].sort((a, b) => b[1] - a[1]).map(([pair, n]) => ({ pair, count: n }));
    const kpis = {
      orders: ps.length, events: events.length, variants: variants.length,
      conformance: r1(happy / ps.length * 100),
      medianLeadDays: r1(quantile(leads, 0.5)), p90LeadDays: r1(quantile(leads, 0.9)), delivered: leads.length
    };

    return {
      orders: ps.length, events: events.length, kpis, variants, directlyFollows,
      arrows: arrows.map(({ waits, exactAvg, ...rest }) => rest),
      slowest: arrows.indexOf(slow), timesSecond: times,
      warehouses: { worst: whs[0][0], best: whs[1][0], share: Math.round(share * 100) },
      slowOrders, detours, sentence, sentenceMain, sentenceDetail
    };
  }

  root.PX_CORE = { STEPS, NOUN, analyse };
})(typeof window !== 'undefined' ? window : globalThis);
