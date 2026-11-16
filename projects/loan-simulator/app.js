(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GREEN = '#1e3a2f', RUST = '#a23b1c';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode = 'single';
  let chartData = null;
  let firstDraw = true;

  /* ---------- formatting ---------- */
  function money(v, cur, dec) {
    const d = dec === undefined ? 2 : dec;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
    } catch (e) { return v.toFixed(d) + ' ' + cur; }
  }
  function moneyShort(v, cur) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(v);
    } catch (e) { return Math.round(v) + ' ' + cur; }
  }
  function months(n) {
    const y = Math.floor(n / 12), m = n % 12, parts = [];
    if (y) parts.push(y + (y === 1 ? ' year' : ' years'));
    if (m) parts.push(m + (m === 1 ? ' month' : ' months'));
    return parts.join(' ') || '0 months';
  }
  /* ---------- input rules (PORT-12): never calculate with a number that is not the one on screen ---------- */
  const RULES = {
    amount: { min: 1000, max: 10000000, msg: 'Enter an amount between 1,000 and 10,000,000.', neg: 'A loan cannot be negative. Enter an amount between 1,000 and 10,000,000.' },
    rateA: { min: 0, max: 30, msg: 'Enter a rate between 0 and 30%.' },
    rateB: { min: 0, max: 30, msg: 'Enter a rate between 0 and 30%.' },
    yearsA: { min: 1, max: 40, whole: true, msg: 'Enter a whole number of years between 1 and 40.' },
    yearsB: { min: 1, max: 40, whole: true, msg: 'Enter a whole number of years between 1 and 40.' },
    feesA: { min: 0, max: 1000000, msg: 'Enter fees between 0 and 1,000,000.' },
    feesB: { min: 0, max: 1000000, msg: 'Enter fees between 0 and 1,000,000.' },
    extra: { min: 0, max: 1000000, msg: 'Enter an extra payment between 0 and 1,000,000 a month.' },
    income: { min: 0, max: 10000000, optional: true, msg: 'Enter an income between 0 and 10,000,000 a month, or leave it empty.' }
  };
  const FIELDS = {
    single: ['amount', 'rateA', 'yearsA', 'extra', 'income'],
    compare: ['amount', 'rateA', 'yearsA', 'feesA', 'rateB', 'yearsB', 'feesB', 'income']
  };
  // The browser could not read the number at all, e.g. "3,5" where only a dot is accepted (PORT-12 R3).
  const BAD_INPUT = 'Use digits only, with a dot for decimals (for example 3.5).';
  // Chrome and Safari silently drop a typed comma (3,5 becomes 35), so the comma key itself shows the message.
  const commaTyped = new Set();
  // Returns an error message, or '' when the value on screen is valid.
  function problem(id) {
    const el = $(id), rule = RULES[id], raw = el.value.trim();
    if (commaTyped.has(id) || (el.validity && el.validity.badInput)) return BAD_INPUT;
    if (raw === '') return rule.optional ? '' : rule.msg;
    const v = Number(raw);
    if (!isFinite(v)) return rule.msg;
    if (v < 0 && rule.neg) return rule.neg;
    if (v < rule.min || (rule.max !== undefined && v > rule.max) || (rule.whole && !Number.isInteger(v))) return rule.msg;
    return '';
  }
  function showProblem(id, msg) {
    const el = $(id), err = $(id + 'Err');
    el.classList.toggle('invalid', !!msg);
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    err.textContent = msg; err.hidden = !msg;
  }
  // Validates the boxes used in the current mode; returns true when all are valid.
  function validate() {
    let ok = true;
    Object.keys(RULES).forEach((id) => {
      const msg = FIELDS[mode].includes(id) ? problem(id) : '';
      showProblem(id, msg);
      if (msg) ok = false;
    });
    return ok;
  }
  const val = (id) => { const raw = $(id).value.trim(); return raw === '' ? 0 : Number(raw); };

  /* ---------- maths: fixed-rate amortising loan ---------- */
  function simulate(P, annualRate, n, extra) {
    const r = annualRate / 100 / 12;
    const pay = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
    let bal = P, totalInt = 0, totalPaid = 0, m = 0, yPaid = 0, yInt = 0;
    const balances = [P], rows = [];
    while (bal > 0.005 && m < n) {
      const interest = bal * r;
      let principal = pay - interest + extra;
      if (principal > bal) principal = bal;
      const paid = principal + interest;
      bal -= principal; totalInt += interest; totalPaid += paid; m++;
      yPaid += paid; yInt += interest;
      balances.push(Math.max(bal, 0));
      if (m % 12 === 0 || bal <= 0.005) {
        rows.push({ year: Math.ceil(m / 12), paid: yPaid, interest: yInt, balance: Math.max(bal, 0) });
        yPaid = 0; yInt = 0;
      }
    }
    return { pay, totalInt, totalPaid, months: m, balances, rows };
  }

  /* ---------- animated numbers ---------- */
  const anims = new WeakMap();
  function animateText(el, to, fmt) {
    const from = anims.get(el) === undefined ? 0 : anims.get(el);
    anims.set(el, to);
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 650;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1 && anims.get(el) === to) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- chart ---------- */
  function geom() {
    const small = window.innerWidth < 760;
    return { W: 640, H: 260, L: small ? 92 : 64, R: small ? 30 : 16, T: 14, B: small ? 40 : 32 };
  }
  function drawChart(series, n, cur, animate) {
    const svg = $('chart'), g = geom();
    const max = Math.max.apply(null, series.map((s) => s.balances[0])) || 1;
    const x = (i) => g.L + (i / n) * (g.W - g.L - g.R);
    const y = (v) => g.T + (1 - v / max) * (g.H - g.T - g.B);
    let out = '';
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4, yy = y(v);
      out += `<line class="grid" x1="${g.L}" x2="${g.W - g.R}" y1="${yy}" y2="${yy}"/>`;
      out += `<text class="axis" x="${g.L - 8}" y="${yy + 4}" text-anchor="end">${moneyShort(v, cur)}</text>`;
    }
    const yearsTotal = n / 12, step = yearsTotal > 20 ? 10 : yearsTotal > 8 ? 5 : yearsTotal > 3 ? 2 : 1;
    for (let yr = 0; yr <= yearsTotal; yr += step) {
      out += `<text class="axis" x="${x(yr * 12)}" y="${g.H - 8}" text-anchor="middle">${yr === 0 ? 'Start' : 'Yr ' + yr}</text>`;
    }
    const path = (b) => b.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const first = series[0];
    out += `<path class="${animate ? 'area' : ''}" d="${path(first.balances)} L ${x(first.balances.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z" fill="${first.color}" opacity="${animate ? 0 : 0.1}"/>`;
    series.forEach((s) => {
      out += `<path class="${animate ? 'line' : ''} ln" d="${path(s.balances)}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash ? 'stroke-dasharray="6 4"' : ''}/>`;
    });
    out += `<line id="cross" x1="0" x2="0" y1="${g.T}" y2="${g.H - g.B}" stroke="#1f1a15" stroke-width="1" opacity="0"/>`;
    series.forEach((s, i) => { out += `<circle id="pt${i}" r="5" fill="${s.color}" stroke="#fbf8f2" stroke-width="2" opacity="0"/>`; });
    svg.innerHTML = out;
    if (animate) {
      svg.querySelectorAll('.line').forEach((p) => {
        if (p.getAttribute('stroke-dasharray')) { p.classList.remove('line'); return; }
        const len = p.getTotalLength(); p.style.setProperty('--len', len);
      });
    }
    chartData = { series, n, cur, x, y, g };
    $('legend').innerHTML = series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.name}</span>`).join('');
  }
  function hover(evt) {
    if (!chartData) return;
    const svg = $('chart'), rect = svg.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const { g, n, x, y, series, cur } = chartData;
    const px = ((clientX - rect.left) / rect.width) * g.W;
    let i = Math.round(((px - g.L) / (g.W - g.L - g.R)) * n);
    i = Math.max(0, Math.min(n, i));
    const cross = $('cross');
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 0.35);
    let html = `<b>${i === 0 ? 'Start' : months(i)}</b>`;
    series.forEach((s, k) => {
      const v = s.balances[Math.min(i, s.balances.length - 1)];
      const c = $('pt' + k); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v)); c.setAttribute('opacity', 1);
      html += `<br>${s.name}: ${money(v, cur, 0)}`;
    });
    const tip = $('tip');
    tip.innerHTML = html; tip.hidden = false;
    const left = (x(i) / g.W) * rect.width;
    tip.style.left = Math.max(70, Math.min(rect.width - 70, left)) + 'px';
  }
  function leave() {
    $('tip').hidden = true;
    const c = $('cross'); if (c) c.setAttribute('opacity', 0);
    document.querySelectorAll('[id^=pt]').forEach((p) => p.setAttribute('opacity', 0));
  }

  /* ---------- affordability ---------- */
  function afford(monthly, cur) {
    const income = val('income');
    if (!income) { $('afford').hidden = true; return; }
    $('afford').hidden = false;
    const pct = (monthly / income) * 100;
    $('affordPct').textContent = pct.toFixed(1) + '%';
    const fill = $('gaugeFill');
    fill.style.width = Math.min(100, pct) + '%';
    fill.style.background = pct <= 30 ? GREEN : pct <= 35 ? '#b7791f' : RUST;
    const left = income - monthly;
    $('affordText').textContent = pct <= 30
      ? `Comfortable. The payment takes ${pct.toFixed(0)}% of your income, leaving ${money(left, cur, 0)} each month for everything else.`
      : pct <= 35
        ? `Tight but common. Many banks cap loan payments at around 35% of income, so this is close to the limit.`
        : `Above the usual 35% guideline. Banks may hesitate. A longer duration or a smaller amount would bring it down.`;
  }

  /* ---------- main update ---------- */
  function update(opts) {
    const animate = !!(opts && opts.animate);
    const valid = validate();
    // Invalid input: keep the last valid result on screen, faded, and say why.
    $('results').classList.toggle('stale', !valid);
    $('fixNote').hidden = valid;
    if (!valid) return;
    const cur = $('currency').value || 'EUR';
    const P = val('amount');
    const rateA = val('rateA'), yearsA = val('yearsA');
    const nA = yearsA * 12;

    if (mode === 'single') {
      const extra = val('extra');
      const base = simulate(P, rateA, nA, 0);
      const plan = extra > 0 ? simulate(P, rateA, nA, extra) : null;
      const shown = plan || base;

      animateText($('monthly'), base.pay, (v) => money(v, cur));
      $('monthlyExtra').textContent = plan ? `+ ${money(extra, cur)} extra = ${money(base.pay + extra, cur)} per month` : `every month for ${months(nA)}`;
      animateText($('interest'), shown.totalInt, (v) => money(v, cur, 0));
      animateText($('total'), shown.totalPaid, (v) => money(v, cur, 0));
      $('duration').textContent = months(shown.months);

      const extraPct = (shown.totalInt / P) * 100;
      $('insight').innerHTML = `You borrow ${money(P, cur, 0)} and pay the bank <b>${money(shown.totalInt, cur, 0)}</b> in interest. That's <b>${extraPct.toFixed(0)}%</b> on top.`;

      if (plan) {
        $('savings').hidden = false;
        $('saveMoney').textContent = money(base.totalInt - plan.totalInt, cur, 0);
        $('saveTime').textContent = months(base.months - plan.months);
      } else { $('savings').hidden = true; }

      const pPct = (P / shown.totalPaid) * 100;
      $('barPrincipal').style.width = pPct + '%';
      $('barInterest').style.width = (100 - pPct) + '%';
      $('pctPrincipal').textContent = Math.round(pPct) + '%';
      $('pctInterest').textContent = Math.round(100 - pPct) + '%';

      const series = [{ name: plan ? 'Standard plan' : 'Balance left', balances: base.balances, color: GREEN }];
      if (plan) series.push({ name: 'With extra payment', balances: plan.balances, color: RUST, dash: true });
      drawChart(series, nA, cur, animate);

      $('schedule').innerHTML = shown.rows.map((r) =>
        `<tr><td>${r.year}</td><td>${money(r.paid, cur, 0)}</td><td>${money(r.interest, cur, 0)}</td><td>${money(r.balance, cur, 0)}</td></tr>`
      ).join('');
      afford(base.pay + extra, cur);
    } else {
      const feesA = val('feesA'), feesB = val('feesB');
      const rateB = val('rateB'), yearsB = val('yearsB');
      const nB = yearsB * 12;
      const A = simulate(P, rateA, nA, 0), B = simulate(P, rateB, nB, 0);
      const costA = A.totalInt + feesA, costB = B.totalInt + feesB;

      $('cMonthlyA').textContent = money(A.pay, cur); $('cMonthlyB').textContent = money(B.pay, cur);
      $('cInterestA').textContent = money(A.totalInt, cur, 0); $('cInterestB').textContent = money(B.totalInt, cur, 0);
      $('cFeesA').textContent = money(feesA, cur, 0); $('cFeesB').textContent = money(feesB, cur, 0);
      animateText($('cCostA'), costA, (v) => money(v, cur, 0));
      animateText($('cCostB'), costB, (v) => money(v, cur, 0));

      const diff = Math.abs(costA - costB);
      const best = costA < costB ? 'A' : costB < costA ? 'B' : null;
      document.querySelectorAll('.ccard').forEach((c, i) => c.classList.toggle('best', (best === 'A' && i === 0) || (best === 'B' && i === 1)));
      const w = $('winner');
      if (!best) {
        w.innerHTML = `<p class="label">Result</p><p class="w-title">Both offers cost the same.</p>`;
      } else {
        const lowerRateLoses = (best === 'A' && rateA > rateB) || (best === 'B' && rateB > rateA);
        w.innerHTML = `<p class="label">The better deal</p><p class="w-title">Offer ${best} saves you ${money(diff, cur, 0)}</p>` +
          `<p class="w-sub">${lowerRateLoses ? 'Even with a higher rate: the fees make the difference. ' : ''}Total cost = interest + fees, over the whole loan.</p>`;
      }
      $('insight').innerHTML = best
        ? `Same ${money(P, cur, 0)}, two offers: one costs <b>${money(diff, cur, 0)}</b> more than the other.`
        : `Same ${money(P, cur, 0)}, two offers, identical total cost.`;

      drawChart([
        { name: 'Offer A', balances: A.balances, color: GREEN },
        { name: 'Offer B', balances: B.balances, color: RUST, dash: true }
      ], Math.max(nA, nB), cur, animate);
      afford(best === 'B' ? B.pay : A.pay, cur);
    }
    leave();
  }

  /* ---------- share link (state in the URL) ---------- */
  const keys = ['currency', 'amount', 'rateA', 'yearsA', 'feesA', 'rateB', 'yearsB', 'feesB', 'extra', 'income'];
  function toURL() {
    const q = new URLSearchParams();
    q.set('mode', mode);
    keys.forEach((k) => { if ($(k).value !== '') q.set(k, $(k).value); });
    return location.origin + location.pathname + '?' + q.toString();
  }
  // Currencies the tool offers; anything else in a share link falls back to euro, with a note (PORT-12 R2).
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'TND'];
  function fromURL() {
    const q = new URLSearchParams(location.search);
    keys.forEach((k) => { if (q.has(k) && k !== 'currency') $(k).value = q.get(k); });
    if (q.has('currency')) {
      const c = q.get('currency').toUpperCase();
      const known = CURRENCIES.includes(c);
      $('currency').value = known ? c : 'EUR';
      $('currencyNote').hidden = known;
    }
    if (q.get('mode') === 'compare') mode = 'compare';
  }
  function syncRanges() {
    [['amount', 'amountRange'], ['rateA', 'rateARange'], ['yearsA', 'yearsARange']].forEach(([a, b]) => { if (!problem(a)) $(b).value = $(a).value; });
  }

  function setMode(m) {
    mode = m;
    document.body.classList.toggle('compare', m === 'compare');
    $('modeSingle').classList.toggle('on', m === 'single'); $('modeSingle').setAttribute('aria-pressed', m === 'single');
    $('modeCompare').classList.toggle('on', m === 'compare'); $('modeCompare').setAttribute('aria-pressed', m === 'compare');
    update({ animate: true });
  }

  /* ---------- wiring ---------- */
  [['amount', 'amountRange'], ['rateA', 'rateARange'], ['yearsA', 'yearsARange']].forEach(([a, b]) => {
    $(a).addEventListener('input', () => { if (!problem(a)) $(b).value = $(a).value; update(); });
    $(b).addEventListener('input', () => { $(a).value = $(b).value; update(); });
  });
  // R3: a comma in a number box is refused with a clear message instead of being dropped without a word.
  $('form').addEventListener('keydown', (e) => {
    if (e.key === ',' && e.target.type === 'number' && RULES[e.target.id]) { e.preventDefault(); commaTyped.add(e.target.id); update(); }
  });
  // A pasted "3,5" or "1,000" is refused the same way: browsers may otherwise turn it into 35 or 1000 without a word.
  $('form').addEventListener('paste', (e) => {
    const t = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (t.includes(',') && e.target.type === 'number' && RULES[e.target.id]) { e.preventDefault(); commaTyped.add(e.target.id); update(); }
  });
  // The message stays until the visitor empties the box or uses a dot, so "2,5" can never end as 25 without a word.
  $('form').addEventListener('input', (e) => {
    const v = e.target.value;
    if (v === '' || v.includes('.')) commaTyped.delete(e.target.id);
  }, true);
  $('currency').addEventListener('change', () => { $('currencyNote').hidden = true; });
  ['currency', 'feesA', 'rateB', 'yearsB', 'feesB', 'extra', 'income'].forEach((id) => $(id).addEventListener('input', () => update()));
  $('modeSingle').addEventListener('click', () => setMode('single'));
  $('modeCompare').addEventListener('click', () => setMode('compare'));

  const svg = $('chart');
  svg.addEventListener('mousemove', hover);
  svg.addEventListener('touchstart', hover, { passive: true });
  svg.addEventListener('touchmove', hover, { passive: true });
  svg.addEventListener('mouseleave', leave);

  $('shareBtn').addEventListener('click', () => {
    const url = toURL();
    history.replaceState(null, '', url);
    const done = () => { $('copied').textContent = 'Link copied ✓'; setTimeout(() => { $('copied').textContent = ''; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { $('copied').textContent = url; });
    else $('copied').textContent = url;
  });
  $('printBtn').addEventListener('click', () => {
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
    window.print();
  });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => update(), 150); });

  fromURL();
  syncRanges();
  setMode(mode);
})();
