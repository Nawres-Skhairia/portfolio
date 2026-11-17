// Process X-ray: the made-up order log (R1). Generated in the page from a fixed seed, so every visitor
// sees the same 2,000 orders. Never Math.random. No real company, no real process, no real people.
(function (root) {
  'use strict';
  const SEED = 20261116;
  const N = 2000;
  const DAY = 864e5;
  const START = Date.UTC(2026, 8, 1); // 1 Sept 2026, UTC. Only durations are used, so time zones change nothing.

  // mulberry32: a tiny seeded random generator.
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // A wait in days with a long tail, like real queues (mean = m).
  const wait = (r, m) => -Math.log(1 - r() * 0.999) * m;

  // Planted on purpose for this demo, named after the analysis.
  const PLANTED = { shippedBeforePaid: 37, packedTwice: 112, cancelledAfterPacking: 54 };
  const MEAN = { paid: 0.25, packed: 0.4, shippedNorth: 3.1, shippedSouth: 0.55, delivered: 0.6 };

  function generate() {
    const r = rng(SEED);
    // Pick the planted orders: a seeded shuffle, then exact counts, never overlapping.
    const idx = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const kind = new Array(N).fill('normal');
    let k = 0;
    for (const [name, count] of [['shippedBeforePaid', PLANTED.shippedBeforePaid], ['packedTwice', PLANTED.packedTwice], ['cancelledAfterPacking', PLANTED.cancelledAfterPacking]])
      for (let c = 0; c < count; c++) kind[idx[k++]] = name;

    const events = [];
    for (let i = 0; i < N; i++) {
      const order = 'A' + String(10001 + i);
      const warehouse = r() < 0.5 ? 'North' : 'South';
      let t = START + Math.floor(r() * 60 * DAY);
      const add = (step) => events.push({ order, step, time: Math.round(t), warehouse });
      const next = (m) => { t += wait(r, m) * DAY; };
      const ship = warehouse === 'North' ? MEAN.shippedNorth : MEAN.shippedSouth;
      add('Ordered');
      if (kind[i] === 'shippedBeforePaid') {
        next(MEAN.packed); add('Packed'); next(ship); add('Shipped'); next(MEAN.paid * 4); add('Paid'); next(MEAN.delivered); add('Delivered');
        continue;
      }
      next(MEAN.paid); add('Paid');
      next(MEAN.packed); add('Packed');
      if (kind[i] === 'packedTwice') { next(0.3); add('Packed'); }
      if (kind[i] === 'cancelledAfterPacking') { next(1.5); add('Cancelled'); continue; }
      next(ship); add('Shipped');
      next(MEAN.delivered); add('Delivered');
    }
    // A real log arrives in time order, not grouped by order.
    events.sort((a, b) => a.time - b.time || (a.order < b.order ? -1 : 1));
    return events;
  }

  root.PX_GEN = { generate, SEED, N, PLANTED };
})(typeof window !== 'undefined' ? window : globalThis);
