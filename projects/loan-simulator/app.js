(function () {
  const $ = (id) => document.getElementById(id);
  const pairs = [['amount', 'amountRange'], ['rate', 'rateRange'], ['years', 'yearsRange']];

  function money(v, cur) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: cur === 'TND' ? 3 : 2 }).format(v);
    } catch (e) { return v.toFixed(2) + ' ' + cur; }
  }
  function moneyShort(v, cur) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(v);
    } catch (e) { return Math.round(v) + ' ' + cur; }
  }
  function months(n) {
    const y = Math.floor(n / 12), m = n % 12;
    const parts = [];
    if (y) parts.push(y + (y === 1 ? ' year' : ' years'));
    if (m) parts.push(m + (m === 1 ? ' month' : ' months'));
    return parts.join(' ') || '0 months';
  }

  // Simulate a fixed-rate amortising loan, month by month.
  function simulate(P, annualRate, n, extra) {
    const r = annualRate / 100 / 12;
    const pay = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
    let bal = P, totalInt = 0, totalPaid = 0, m = 0;
    const balances = [P], rows = [];
    let yPaid = 0, yInt = 0;
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

  function drawChart(base, withExtra, n, cur) {
    const svg = $('chart');
    const small = window.innerWidth < 760;
    const W = 640, H = 260, L = small ? 92 : 64, R = small ? 30 : 16, T = 14, B = small ? 40 : 32;
    const max = base.balances[0] || 1;
    const x = (i) => L + (i / n) * (W - L - R);
    const y = (v) => T + (1 - v / max) * (H - T - B);
    let out = '';
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4, yy = y(v);
      out += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
      out += `<text class="axis" x="${L - 8}" y="${yy + 4}" text-anchor="end">${moneyShort(v, cur)}</text>`;
    }
    const yearsTotal = n / 12, step = yearsTotal > 20 ? 10 : yearsTotal > 8 ? 5 : yearsTotal > 3 ? 2 : 1;
    for (let yr = 0; yr <= yearsTotal; yr += step) {
      out += `<text class="axis" x="${x(yr * 12)}" y="${H - 8}" text-anchor="middle">${yr === 0 ? 'Start' : 'Yr ' + yr}</text>`;
    }
    const path = (b) => b.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const area = path(base.balances) + ` L ${x(base.balances.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;
    out += `<path d="${area}" fill="#1e3a2f" opacity="0.10"/>`;
    out += `<path d="${path(base.balances)}" fill="none" stroke="#1e3a2f" stroke-width="2.5"/>`;
    if (withExtra) out += `<path d="${path(withExtra.balances)}" fill="none" stroke="#a23b1c" stroke-width="2.5" stroke-dasharray="6 4"/>`;
    svg.innerHTML = out;
    window.__lastChart = [base, withExtra, n, cur];
  }

  function update() {
    const cur = $('currency').value;
    const P = Math.max(0, parseFloat($('amount').value) || 0);
    const rate = Math.max(0, parseFloat($('rate').value) || 0);
    const years = Math.min(40, Math.max(1, parseInt($('years').value, 10) || 1));
    const extra = Math.max(0, parseFloat($('extra').value) || 0);
    const n = years * 12;
    if (P <= 0) return;

    const base = simulate(P, rate, n, 0);
    const plan = extra > 0 ? simulate(P, rate, n, extra) : null;
    const shown = plan || base;

    $('monthly').textContent = money(base.pay, cur);
    $('monthlyExtra').textContent = plan ? `+ ${money(extra, cur)} extra = ${money(base.pay + extra, cur)} per month` : `for ${months(n)}`;
    $('interest').textContent = money(shown.totalInt, cur);
    $('total').textContent = money(shown.totalPaid, cur);
    $('duration').textContent = months(shown.months);

    if (plan) {
      $('savings').hidden = false;
      $('saveMoney').textContent = money(base.totalInt - plan.totalInt, cur);
      $('saveTime').textContent = months(base.months - plan.months);
    } else { $('savings').hidden = true; }
    $('legendExtra').hidden = !plan;

    const pPct = (P / shown.totalPaid) * 100;
    $('barPrincipal').style.width = pPct + '%';
    $('barInterest').style.width = (100 - pPct) + '%';
    $('pctPrincipal').textContent = Math.round(pPct) + '%';
    $('pctInterest').textContent = Math.round(100 - pPct) + '%';

    drawChart(base, plan, n, cur);

    $('schedule').innerHTML = shown.rows.map((r) =>
      `<tr><td>${r.year}</td><td>${money(r.paid, cur)}</td><td>${money(r.interest, cur)}</td><td>${money(r.balance, cur)}</td></tr>`
    ).join('');
  }

  pairs.forEach(([num, range]) => {
    $(num).addEventListener('input', () => { $(range).value = $(num).value; update(); });
    $(range).addEventListener('input', () => { $(num).value = $(range).value; update(); });
  });
  ['extra', 'currency'].forEach((id) => $(id).addEventListener('input', update));
  update();
})();
window.addEventListener('resize', function () {
  if (window.__lastChart) document.getElementById('years').dispatchEvent(new Event('input'));
});
