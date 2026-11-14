/*
 * Rulebench engine: pure functions, no DOM.
 *
 * A rule set is a decision table (DMN-style):
 *   inputs  : [{ key, label, type: 'number' | 'enum', values?, min? }]
 *   outputs : [{ key, label, type: 'percent' | 'money' | 'enum', values? }]
 *   rows    : [{ id, when: { [inputKey]: {min,max} | [values] | null }, then: { [outputKey]: value } }]
 *   hitPolicy 'unique': exactly one row should match each case.
 *
 * Three tests run against it:
 *   coverage() : partitions the input space on every row boundary and finds
 *                regions no row covers (gaps) or where rows disagree (conflicts).
 *   replay()   : runs last year's real cases through the current and draft
 *                rules and diffs the outcomes.
 *   redTeam()  : an adversary applies "moves" a person really controls
 *                (split a claim, move a signing date) and hill-climbs on
 *                the scenario's objective to find exploits.
 */
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- matching ----------
  function condMatches(input, cond, v) {
    if (cond == null) return true;
    if (input.type === 'number') {
      return (cond.min == null || v >= cond.min) && (cond.max == null || v < cond.max);
    }
    return cond.length === 0 || cond.length === input.values.length || cond.indexOf(v) !== -1;
  }
  function matchRows(table, c) {
    const hits = [];
    table.rows.forEach((r, i) => {
      if (table.inputs.every((inp) => condMatches(inp, r.when[inp.key], c[inp.key]))) hits.push(i);
    });
    return hits;
  }
  // Resolve one case: first matching row wins, but conflicts are reported.
  function decide(table, c) {
    const hits = matchRows(table, c);
    if (!hits.length) return { row: null, hits, conflict: false };
    const first = table.rows[hits[0]];
    const conflict = hits.some((i) => !same(table.rows[i].then, first.then));
    return { row: first, hits, conflict };
  }

  // ---------- coverage: gaps and conflicts ----------
  function coverage(table) {
    const dims = table.inputs.map((inp) => {
      if (inp.type === 'enum') return inp.values.map((v) => ({ value: v }));
      const pts = new Set([inp.min || 0]);
      table.rows.forEach((r) => {
        const c = r.when[inp.key];
        if (c && c.min != null) pts.add(c.min);
        if (c && c.max != null) pts.add(c.max);
      });
      const sorted = [...pts].filter((p) => p >= (inp.min || 0)).sort((a, b) => a - b);
      return sorted.map((p, i) => ({ min: p, max: i + 1 < sorted.length ? sorted[i + 1] : null }));
    });

    // Walk every cell of the partition.
    let cells = [];
    (function walk(d, acc) {
      if (d === dims.length) { cells.push(acc.slice()); return; }
      dims[d].forEach((seg) => { acc.push(seg); walk(d + 1, acc); acc.pop(); });
    })(0, []);

    const issues = [];
    cells.forEach((cell) => {
      const probe = {};
      table.inputs.forEach((inp, d) => { probe[inp.key] = inp.type === 'enum' ? cell[d].value : cell[d].min; });
      const hits = matchRows(table, probe);
      let kind = null;
      if (!hits.length) kind = 'gap';
      else if (hits.some((i) => !same(table.rows[i].then, table.rows[hits[0]].then))) kind = 'conflict';
      if (!kind) return;
      const region = {};
      table.inputs.forEach((inp, d) => {
        region[inp.key] = inp.type === 'enum' ? [cell[d].value] : { min: cell[d].min, max: cell[d].max };
      });
      issues.push({ kind, rows: kind === 'gap' ? [] : hits.map((i) => table.rows[i].id), region });
    });

    // Merge neighbours: contiguous numeric ranges, then enum values.
    let merged = issues;
    table.inputs.forEach((inp) => {
      const out = [];
      const keyOf = (it) => JSON.stringify([it.kind, it.rows, table.inputs.filter((x) => x.key !== inp.key).map((x) => it.region[x.key])]);
      const groups = new Map();
      merged.forEach((it) => { const k = keyOf(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
      groups.forEach((list) => {
        if (inp.type === 'enum') {
          const base = clone(list[0]);
          base.region[inp.key] = inp.values.filter((v) => list.some((it) => it.region[inp.key].indexOf(v) !== -1));
          out.push(base);
        } else {
          list.sort((a, b) => a.region[inp.key].min - b.region[inp.key].min);
          let cur = clone(list[0]);
          for (let i = 1; i < list.length; i++) {
            const r = list[i].region[inp.key];
            if (cur.region[inp.key].max === r.min) cur.region[inp.key].max = r.max;
            else { out.push(cur); cur = clone(list[i]); }
          }
          out.push(cur);
        }
      });
      merged = out;
    });
    return merged;
  }

  function inRegion(table, region, c) {
    return table.inputs.every((inp) => {
      const r = region[inp.key];
      if (inp.type === 'enum') return r.indexOf(c[inp.key]) !== -1;
      return c[inp.key] >= r.min && (r.max == null || c[inp.key] < r.max);
    });
  }

  // ---------- replay ----------
  function replay(scn, current, draft, cases) {
    const a = scn.evaluate(cases, current);
    const b = scn.evaluate(cases, draft);
    const changed = [];
    cases.forEach((c, i) => {
      if (a.perCase[i].label !== b.perCase[i].label) changed.push({ c, before: a.perCase[i], after: b.perCase[i] });
    });
    changed.sort((x, y) => Math.abs(y.after.weight - y.before.weight) - Math.abs(x.after.weight - x.before.weight));
    return { before: a, after: b, metrics: scn.metrics(a, b), changed, changedCount: changed.length };
  }

  // ---------- red team ----------
  function redTeam(scn, plan, cases, opts) {
    opts = opts || {};
    const maxSteps = opts.maxSteps || 25;
    const byActor = new Map();
    cases.forEach((c) => { const k = c[scn.actorKey]; if (!byActor.has(k)) byActor.set(k, []); byActor.get(k).push(c); });

    let tried = 0;
    const steps = [];
    let honestTotal = 0;
    byActor.forEach((own, actor) => {
      let cur = own.map((c) => Object.assign({}, c));
      let score = scn.objective(cur, plan);
      honestTotal += score;
      for (let s = 0; s < maxSteps; s++) {
        const moves = scn.moves(cur, plan);
        let best = null;
        moves.forEach((m) => {
          tried++;
          const next = m.apply(cur);
          const sc = scn.objective(next, plan);
          if (sc - score > 0.5 && (!best || sc - score > best.gain)) best = { m, next, gain: sc - score };
        });
        if (!best) break;
        steps.push({ actor, kind: best.m.kind, gain: best.gain, text: best.m.describe, impact: best.m.impact || 0, fromGap: !!best.m.fromGap });
        cur = best.next;
        score += best.gain;
      }
    });

    const kinds = new Map();
    steps.forEach((st) => {
      if (!kinds.has(st.kind)) kinds.set(st.kind, { kind: st.kind, gain: 0, impact: 0, count: 0, actors: new Set(), example: st });
      const k = kinds.get(st.kind);
      k.gain += st.gain; k.impact += st.impact; k.count++; k.actors.add(st.actor);
      // Prefer an example that is not just a case falling in a coverage gap.
      if ((k.example.fromGap && !st.fromGap) || (st.fromGap === k.example.fromGap && st.gain > k.example.gain)) k.example = st;
    });
    const exploits = [...kinds.values()].map((k) => {
      const share = honestTotal ? k.gain / Math.abs(honestTotal) : 0;
      return Object.assign(k, {
        actors: [...k.actors],
        share,
        severity: share > 0.03 ? 'high' : share > 0.01 ? 'medium' : 'low',
      });
    }).sort((x, y) => y.gain - x.gain);
    return { tried, exploits, honestTotal };
  }

  // ======================================================================
  // Scenario 1: sales commission plan
  // ======================================================================
  const DAY = 86400000;
  const YEAR = 2025;
  const qOf = (day) => Math.min(3, Math.floor(day / 91.25));
  const qStart = [0, 90, 181, 273, 365];
  const dateLabel = (day) => new Date(Date.UTC(YEAR, 0, 1) + day * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function groupDeals(deals, window, keyFn) {
    const sorted = deals.slice().sort((a, b) => a.day - b.day);
    const groups = [];
    const open = new Map();
    sorted.forEach((d) => {
      const k = keyFn(d);
      const g = open.get(k);
      if (g && d.day - g.day <= window) { g.amount += d.amount; g.members.push(d); }
      else { const ng = Object.assign({}, d, { members: [d] }); groups.push(ng); open.set(k, ng); }
    });
    return groups;
  }

  const commission = {
    id: 'commission',
    actorKey: 'rep',
    actorLabel: 'rep',
    caseLabel: 'deal',
    caseLabelPlural: 'deals',
    weightLabel: 'commission',
    inputs: [
      { key: 'amount', label: 'Deal amount', type: 'number', min: 0 },
      { key: 'type', label: 'Deal type', type: 'enum', values: ['New', 'Renewal', 'Upsell'] },
    ],
    outputs: [
      { key: 'rate', label: 'Rate', type: 'percent' },
      { key: 'bonus', label: 'Bonus per deal', type: 'money' },
    ],
    current: {
      rows: [
        { id: 'C1', when: { amount: null, type: ['New'] }, then: { rate: 7, bonus: 0 } },
        { id: 'C2', when: { amount: null, type: ['Renewal'] }, then: { rate: 3, bonus: 0 } },
        { id: 'C3', when: { amount: null, type: ['Upsell'] }, then: { rate: 5, bonus: 0 } },
      ],
      settings: { quota: 120000, multiplier: 1, mode: 'cliff', groupSplits: false },
    },
    draft: {
      rows: [
        { id: 'R1', when: { amount: { min: null, max: 10000 }, type: ['New'] }, then: { rate: 6, bonus: 400 } },
        { id: 'R2', when: { amount: { min: 10000, max: 50000 }, type: ['New'] }, then: { rate: 8, bonus: 0 } },
        { id: 'R3', when: { amount: { min: 60000, max: null }, type: ['New'] }, then: { rate: 10, bonus: 0 } },
        { id: 'R4', when: { amount: null, type: ['Renewal'] }, then: { rate: 3, bonus: 0 } },
        { id: 'R5', when: { amount: { min: null, max: 25000 }, type: ['Upsell'] }, then: { rate: 5, bonus: 0 } },
        { id: 'R6', when: { amount: { min: 20000, max: null }, type: ['Upsell'] }, then: { rate: 7, bonus: 0 } },
      ],
      settings: { quota: 120000, multiplier: 1.5, mode: 'cliff', groupSplits: false },
    },
    settingsSpec: [
      { key: 'quota', label: 'Quota per rep, per quarter', type: 'money' },
      { key: 'multiplier', label: 'Accelerator once quota is hit', type: 'multiplier' },
      { key: 'mode', label: 'Accelerator applies to', type: 'choice', options: [['cliff', 'the whole quarter'], ['marginal', 'only sales above the quarter quota'], ['ytd', 'sales above quota, counted year to date']] },
      { key: 'groupSplits', label: 'Count deals with the same customer within 30 days as one deal', type: 'toggle', safeguard: true },
    ],

    generate(seed) {
      const r = rng(seed);
      const reps = ['Amira', 'Youssef', 'Claire', 'Karim', 'Sofia', 'Malek'];
      const companies = ['Atlas', 'Medina Foods', 'Carthage Air', 'Nordline', 'Sahel Tech', 'Olivia Cosmetics', 'Bizerte Port', 'Lumen', 'Kairo Textiles', 'Verde', 'Polaris', 'Djerba Resorts', 'Ferro', 'Sousse Pharma', 'Altamira', 'Cap Bon Agri'];
      const deals = [];
      let id = 1;
      reps.forEach((rep, ri) => {
        const n = 20 + Math.floor(r() * 7);
        for (let i = 0; i < n; i++) {
          const t = r();
          const type = t < 0.5 ? 'New' : t < 0.78 ? 'Renewal' : 'Upsell';
          const base = type === 'New' ? 4000 + Math.pow(r(), 1.7) * 82000 : type === 'Renewal' ? 6000 + r() * 50000 : 3000 + Math.pow(r(), 1.3) * 38000;
          deals.push({
            id: 'D' + String(id++).padStart(3, '0'),
            rep,
            customer: companies[(ri * 5 + Math.floor(r() * companies.length)) % companies.length],
            type,
            amount: Math.round(base / 100) * 100,
            day: Math.floor(r() * 365),
          });
        }
      });
      return deals.sort((a, b) => a.day - b.day);
    },

    evaluate(deals, plan) {
      const s = plan.settings;
      const table = { inputs: this.inputs, rows: plan.rows };
      const units = s.groupSplits ? groupDeals(deals, 30, (d) => d.rep + '|' + d.customer + '|' + d.type) : deals.map((d) => Object.assign({}, d, { members: [d] }));
      const perDeal = new Map();
      let base = 0, undef = 0, conflicts = 0;
      const quarter = new Map();
      units.forEach((u) => {
        const dec = decide(table, u);
        if (!dec.row) undef += u.members.length;
        if (dec.conflict) conflicts += u.members.length;
        const rate = dec.row ? dec.row.then.rate : 0;
        const bonus = dec.row ? dec.row.then.bonus : 0;
        const value = u.amount * rate / 100 + bonus;
        base += value;
        const qk = u.rep + '|' + qOf(u.day);
        if (!quarter.has(qk)) quarter.set(qk, { amount: 0, rateValue: 0 });
        const q = quarter.get(qk);
        q.amount += u.amount; q.rateValue += u.amount * rate / 100;
        u.members.forEach((m) => {
          perDeal.set(m, {
            rowId: dec.row ? dec.row.id : null,
            conflict: dec.conflict,
            label: dec.row ? `${rate}%${bonus ? ' + ' + fmtMoney(bonus) + ' bonus' : ''}` : 'No rule: unpaid',
            weight: value * (m.amount / u.amount),
          });
        });
      });
      let accel = 0, quartersHit = 0;
      if (s.mode === 'ytd') {
        // Quota counted year to date: one true-up on everything above the annual target.
        const reps = new Map();
        quarter.forEach((q, k) => {
          const rep = k.split('|')[0];
          if (!reps.has(rep)) reps.set(rep, { amount: 0, rateValue: 0, qs: [0, 0, 0, 0] });
          const r = reps.get(rep); r.amount += q.amount; r.rateValue += q.rateValue; r.qs[+k.split('|')[1]] += q.amount;
        });
        reps.forEach((r) => {
          let cum = 0;
          r.qs.forEach((a, i) => { cum += a; if (s.multiplier > 1 && cum >= s.quota * (i + 1)) quartersHit++; });
          const above = r.amount - 4 * s.quota;
          if (s.multiplier > 1 && above > 0) accel += (s.multiplier - 1) * above * (r.rateValue / r.amount);
        });
      } else {
        quarter.forEach((q) => {
          if (s.multiplier > 1 && q.amount >= s.quota) {
            quartersHit++;
            if (s.mode === 'cliff') accel += (s.multiplier - 1) * q.rateValue;
            else accel += (s.multiplier - 1) * (q.amount - s.quota) * (q.rateValue / q.amount);
          }
        });
      }
      const byActor = {};
      deals.forEach((d) => { byActor[d.rep] = (byActor[d.rep] || 0) + perDeal.get(d).weight; });
      return { perCase: deals.map((d) => perDeal.get(d)), total: base + accel, base, accel, undef, conflicts, quartersHit, byActor };
    },

    metrics(a, b) {
      return [
        { label: 'Total commission cost', before: a.total, after: b.total, fmt: 'money', bad: 'up' },
        { label: 'Paid by accelerators', before: a.accel, after: b.accel, fmt: 'money', bad: 'up' },
        { label: 'Quarters where a rep hit quota', before: a.quartersHit, after: b.quartersHit, fmt: 'int' },
        { label: 'Deals no rule covers', before: a.undef, after: b.undef, fmt: 'int', bad: 'up', alarm: true },
        { label: 'Deals matching rules that disagree', before: a.conflicts, after: b.conflicts, fmt: 'int', bad: 'up', alarm: true },
      ];
    },
    describeCase(d) { return `${d.rep} · ${d.customer} · ${d.type} · ${fmtMoney(d.amount)} · ${dateLabel(d.day)}`; },

    objective(deals, plan) { return this.evaluate(deals, plan).total; },

    moves(deals, plan) {
      const out = [];
      const breaks = new Set();
      plan.rows.forEach((r) => { const c = r.when.amount; if (c && c.min) breaks.add(c.min); if (c && c.max) breaks.add(c.max); });
      deals.forEach((d, i) => {
        if (!d.part) {
          breaks.forEach((b) => {
            if (d.amount < b) return;
            const k = Math.floor(d.amount / b) + 1;
            if (k < 2 || k > 5) return;
            const piece = Math.round(d.amount / k);
            out.push({
              kind: 'split',
              impact: d.amount,
              fromGap: !decide({ inputs: commission.inputs, rows: plan.rows }, d).row,
              describe: `${d.rep} splits a ${fmtMoney(d.amount)} ${d.type.toLowerCase()} deal with ${d.customer} into ${k} deals of about ${fmtMoney(piece)}`,
              apply(cur) {
                const next = cur.slice(0, i).concat(cur.slice(i + 1));
                for (let p = 0; p < k; p++) next.push(Object.assign({}, d, { id: d.id + '.' + (p + 1), amount: p === k - 1 ? d.amount - piece * (k - 1) : piece, day: Math.min(364, d.day + p * 3), part: true }));
                return next;
              },
            });
          });
        }
        if (!d.moved) {
          const q = qOf(d.day);
          const toNext = qStart[q + 1] - d.day, fromStart = d.day - qStart[q];
          if (q < 3 && toNext <= 30) out.push(shift(d, i, qStart[q + 1] + 1, 'delays'));
          if (q > 0 && fromStart <= 30) out.push(shift(d, i, qStart[q] - 2, 'pulls forward'));
        }
      });
      function shift(d, i, day, verb) {
        return {
          kind: 'timing',
          impact: d.amount,
          describe: `${d.rep} ${verb} a ${fmtMoney(d.amount)} deal with ${d.customer} from ${dateLabel(d.day)} to ${dateLabel(day)}, into another quarter`,
          apply(cur) { const next = cur.slice(); next[i] = Object.assign({}, d, { day, moved: true }); return next; },
        };
      }
      return out;
    },

    exploitText: {
      split: {
        title: 'Split one deal into several smaller ones',
        why: 'Smaller deals land in a better row of the table (a per-deal bonus, or a range with a higher rate), and nothing stops a rep from signing one customer through several contracts.',
        fix: 'Count deals with the same customer within 30 days as one deal',
        fixKey: 'groupSplits', fixValue: true,
      },
      timing: {
        title: 'Move a signing date into another quarter',
        why: 'Once quota is reached, the accelerator multiplies the commission on the whole quarter. A rep who is short of quota holds a deal back or pulls one forward to cross the line in one quarter.',
        fix: 'Count quota year to date, so moving a deal between quarters changes nothing',
        fixKey: 'mode', fixValue: 'ytd',
      },
    },
  };

  // ======================================================================
  // Scenario 2: expense approval routing
  // ======================================================================
  const LEVEL = { Auto: 0, Manager: 1, 'Finance director': 2 };
  const expenses = {
    id: 'expenses',
    actorKey: 'person',
    actorLabel: 'employee',
    caseLabel: 'claim',
    caseLabelPlural: 'claims',
    weightLabel: 'approval level',
    inputs: [
      { key: 'amount', label: 'Claim amount', type: 'number', min: 0 },
      { key: 'category', label: 'Category', type: 'enum', values: ['Meals', 'Travel', 'Hotel', 'Equipment', 'Software'] },
      { key: 'role', label: 'Submitted by', type: 'enum', values: ['Employee', 'Manager', 'Contractor'] },
    ],
    outputs: [
      { key: 'approver', label: 'Approved by', type: 'enum', values: ['Auto', 'Manager', 'Finance director'] },
    ],
    current: {
      rows: [
        { id: 'C1', when: { amount: { min: null, max: 200 }, category: null, role: null }, then: { approver: 'Auto' } },
        { id: 'C2', when: { amount: { min: 200, max: null }, category: null, role: null }, then: { approver: 'Manager' } },
      ],
      settings: { groupSplits: false },
    },
    draft: {
      rows: [
        { id: 'E1', when: { amount: { min: null, max: 100 }, category: ['Meals', 'Travel', 'Hotel', 'Software'], role: null }, then: { approver: 'Auto' } },
        { id: 'E2', when: { amount: { min: 100, max: 1000 }, category: null, role: ['Employee', 'Manager'] }, then: { approver: 'Manager' } },
        { id: 'E3', when: { amount: { min: 1000, max: null }, category: null, role: null }, then: { approver: 'Finance director' } },
        { id: 'E4', when: { amount: null, category: ['Equipment'], role: null }, then: { approver: 'Manager' } },
      ],
      settings: { groupSplits: false },
    },
    settingsSpec: [
      { key: 'groupSplits', label: 'Add up claims from the same person and merchant within 7 days before routing', type: 'toggle', safeguard: true },
    ],

    generate(seed) {
      const r = rng(seed);
      const people = [['Ines', 'Employee'], ['Omar', 'Employee'], ['Lucie', 'Manager'], ['Hedi', 'Employee'], ['Nadia', 'Manager'], ['Paul', 'Contractor'], ['Rania', 'Employee'], ['Selim', 'Contractor'], ['Emma', 'Employee'], ['Walid', 'Employee'], ['Yasmine', 'Manager'], ['Tarek', 'Contractor']];
      const spec = {
        Meals: [15, 220, ['Dar El Jeld', 'Café Lotus', 'Le Golfe', 'Bistro 21']],
        Travel: [60, 1500, ['Tunisair', 'Taxi Plus', 'SNCFT', 'Air France']],
        Hotel: [90, 950, ['Hôtel Majestic', 'Movenpick', 'Ibis', 'Dar Ben Gacem']],
        Equipment: [150, 2600, ['Mytek', 'Tunisianet', 'Darty']],
        Software: [20, 1300, ['Figma', 'Atlassian', 'Adobe', 'Notion']],
      };
      const cats = Object.keys(spec);
      const claims = [];
      for (let i = 0; i < 280; i++) {
        const [person, role] = people[Math.floor(r() * people.length)];
        const category = cats[Math.floor(Math.pow(r(), 1.3) * cats.length)];
        const [lo, hi, merchants] = spec[category];
        claims.push({
          id: 'X' + String(i + 1).padStart(3, '0'),
          person, role, category,
          merchant: merchants[Math.floor(r() * merchants.length)],
          amount: Math.round(lo + Math.pow(r(), 1.8) * (hi - lo)),
          day: Math.floor(r() * 365),
        });
      }
      return claims.sort((a, b) => a.day - b.day);
    },

    evaluate(claims, plan) {
      const table = { inputs: this.inputs, rows: plan.rows };
      const units = plan.settings.groupSplits ? groupDeals(claims, 7, (c) => c.person + '|' + c.merchant) : claims.map((c) => Object.assign({}, c, { members: [c] }));
      const per = new Map();
      const counts = { Auto: 0, Manager: 0, 'Finance director': 0 };
      let undef = 0, conflicts = 0, autoMoney = 0, financeMoney = 0;
      units.forEach((u) => {
        const dec = decide(table, u);
        const ap = dec.row ? dec.row.then.approver : null;
        u.members.forEach((m) => {
          if (!ap) undef++; else counts[ap]++;
          if (dec.conflict) conflicts++;
          if (ap === 'Auto') autoMoney += m.amount;
          if (ap === 'Finance director') financeMoney += m.amount;
          per.set(m, { rowId: dec.row ? dec.row.id : null, conflict: dec.conflict, label: ap || 'No rule: shared inbox', weight: ap ? LEVEL[ap] : -1 });
        });
      });
      return { perCase: claims.map((c) => per.get(c)), counts, undef, conflicts, autoMoney, financeMoney, total: financeMoney };
    },

    metrics(a, b) {
      return [
        { label: 'Claims approved automatically', before: a.counts.Auto, after: b.counts.Auto, fmt: 'int' },
        { label: 'Claims for managers to review', before: a.counts.Manager, after: b.counts.Manager, fmt: 'int' },
        { label: 'Claims for the finance director', before: a.counts['Finance director'], after: b.counts['Finance director'], fmt: 'int' },
        { label: 'Money approved with no human check', before: a.autoMoney, after: b.autoMoney, fmt: 'money', bad: 'up' },
        { label: 'Claims no rule covers', before: a.undef, after: b.undef, fmt: 'int', bad: 'up', alarm: true },
        { label: 'Claims matching rules that disagree', before: a.conflicts, after: b.conflicts, fmt: 'int', bad: 'up', alarm: true },
      ];
    },
    describeCase(c) { return `${c.person} (${c.role}) · ${c.category} · ${c.merchant} · ${fmtMoney(c.amount)} · ${dateLabel(c.day)}`; },

    // The adversary wants as little scrutiny as possible: money weighted by approval level.
    objective(claims, plan) {
      const table = { inputs: this.inputs, rows: plan.rows };
      const units = plan.settings.groupSplits ? groupDeals(claims, 7, (c) => c.person + '|' + c.merchant) : claims;
      let s = 0;
      units.forEach((u) => { const d = decide(table, u); s -= u.amount * (d.row ? LEVEL[d.row.then.approver] : 1); });
      return s;
    },

    moves(claims, plan) {
      const out = [];
      const breaks = new Set();
      plan.rows.forEach((r) => { const c = r.when.amount; if (c && c.min) breaks.add(c.min); if (c && c.max) breaks.add(c.max); });
      claims.forEach((c, i) => {
        if (c.part) return;
        breaks.forEach((b) => {
          if (c.amount < b) return;
          const k = Math.floor(c.amount / b) + 1;
          if (k < 2 || k > 4) return;
          const piece = Math.round(c.amount / k);
          out.push({
            kind: 'split',
            impact: c.amount,
            fromGap: !decide({ inputs: expenses.inputs, rows: plan.rows }, c).row || c.role === 'Contractor',
            describe: `${c.person} turns one ${fmtMoney(c.amount)} ${c.category.toLowerCase()} claim at ${c.merchant} into ${k} claims of about ${fmtMoney(piece)} on consecutive days`,
            apply(cur) {
              const next = cur.slice(0, i).concat(cur.slice(i + 1));
              for (let p = 0; p < k; p++) next.push(Object.assign({}, c, { id: c.id + '.' + (p + 1), amount: p === k - 1 ? c.amount - piece * (k - 1) : piece, day: Math.min(364, c.day + p), part: true }));
              return next;
            },
          });
        });
      });
      return out;
    },

    exploitText: {
      split: {
        title: 'Split a claim to stay under an approval limit',
        why: 'Routing looks at one claim at a time. Two claims just under the limit go to a lower approver than the single claim they really are. Auditors call this split purchasing.',
        fix: 'Add up claims from the same person and merchant within 7 days before routing',
        fixKey: 'groupSplits', fixValue: true,
      },
    },
  };

  function fmtMoney(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  const api = { rng, matchRows, decide, coverage, inRegion, replay, redTeam, scenarios: { commission, expenses }, fmtMoney, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rulebench = api;
})(typeof window !== 'undefined' ? window : globalThis);
