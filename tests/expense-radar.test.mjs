// Expense Radar engine: money in cents, budgets, regular payments, unusual expenses, estimate, CSV import and export.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../projects/expense-radar/engine.js';
import { seed } from '../projects/expense-radar/seed.js';

const tx = (date, payee, euros, category = 'Other', id) => ({ id: id || date + payee + euros, date, payee, amount: Math.round(euros * 100), category, note: '' });

test('amounts are read into whole cents, in the usual European and English ways', () => {
  const cases = { '1 234,56': 123456, '1,234.56': 123456, '1.234.567,89': 123456789, '-12.5': -1250, '€ 9,99': 999, '(45.00)': -4500, '12-': -1200, '+3,00': 300, '0,5': 50, '10': 1000, '1,234': 123400 };
  for (const [k, v] of Object.entries(cases)) assert.equal(E.toCents(k), v, k);
  for (const bad of ['abc', '', '1,2,3.4.5', '12.345,678', '--']) assert.equal(E.toCents(bad), null, bad);
  assert.equal(E.toCents(0.1) + E.toCents(0.2), 30, 'no floating point drift');
});

test('money is shown with a real minus sign, thousands and two decimals', () => {
  assert.equal(E.formatMoney(-123456), '−€1,234.56');
  assert.equal(E.formatMoney(5, 'EUR', { sign: true }), '+€0.05');
  assert.equal(E.formatMoney(123456, 'EUR', { round: true }), '€1,235');
  assert.deepEqual(E.splitCents(1000, 3), [334, 333, 333]);
  assert.equal(E.sum(E.splitCents(-1001, 4)), -1001);
});

test('totals, savings rate and the six-month trend', () => {
  const txs = [tx('2026-10-25', 'Salary', 3000, 'Salary'), tx('2026-10-01', 'Rent', -1000, 'Housing'), tx('2026-10-05', 'Shop', -500.5, 'Groceries')];
  const t = E.totals(txs);
  assert.deepEqual(t, { income: 300000, spent: 150050, balance: 149950, savingsRate: 50 });
  assert.equal(E.totals([]).savingsRate, null);
  const tr = E.trend(txs, '2026-11', 6);
  assert.equal(tr.length, 6); assert.equal(tr[5].month, '2026-11'); assert.equal(tr[4].spent, 150050);
});

test('budgets: over, on a pace to go over, and regular payments not projected forward', () => {
  const d = { ...E.emptyData(), budgets: { Groceries: 30000, Subscriptions: 5000 }, transactions: [
    tx('2026-11-03', 'Shop', -200, 'Groceries'),
    ...['2026-08-02', '2026-09-02', '2026-10-02', '2026-11-02'].map(x => tx(x, 'Streamly', -45, 'Subscriptions')),
  ] };
  const st = E.budgetStatus(d, '2026-11', '2026-11-10');
  const g = st.find(x => x.category === 'Groceries'); const s = st.find(x => x.category === 'Subscriptions');
  assert.equal(g.state, 'pace'); assert.equal(g.projected, 60000);
  assert.equal(s.state, 'ok', 'a monthly subscription paid early in the month is not a pace problem');
  d.transactions.push(tx('2026-11-09', 'Shop', -150, 'Groceries'));
  assert.equal(E.budgetStatus(d, '2026-11', '2026-11-10').find(x => x.category === 'Groceries').state, 'over');
});

test('regular payments: same payee, similar amount, regular gap; price rises and stopped ones', () => {
  const txs = [
    ...['2026-05-08', '2026-06-08', '2026-07-08', '2026-08-08', '2026-09-08'].map(x => tx(x, 'Streamly 4471', -12.99, 'Subscriptions')),
    ...['2026-10-08', '2026-11-08'].map(x => tx(x, 'STREAMLY 9930', -15.99, 'Subscriptions')),
    ...['2026-01-15', '2026-02-15', '2026-03-15'].map(x => tx(x, 'Old gym', -30, 'Subscriptions')),
    tx('2026-11-01', 'Random shop', -10), tx('2026-11-20', 'Random shop', -80),
  ];
  const r = E.detectRecurring(txs, '2026-11-17');
  const s = r.find(x => x.key === 'streamly');
  assert.ok(s); assert.equal(s.cadence, 'Monthly'); assert.equal(s.amount, 1599); assert.equal(s.priceChange, 300); assert.equal(s.next, '2026-12-08');
  assert.equal(r.find(x => x.key === 'old gym').stopped, true);
  assert.ok(!r.some(x => x.key === 'random shop'));
  assert.equal(E.subscriptionYearly({ amount: 1000, cadence: 'Weekly' }), 52000);
});

test('unusual expenses: well above the usual for the category, never for a new category or a regular payment', () => {
  const hist = ['2026-09-02', '2026-09-12', '2026-09-22', '2026-10-02', '2026-10-12', '2026-10-22'].map((x, i) => tx(x, 'Bookhouse', -(30 + i), 'Shopping'));
  const txs = [...hist, tx('2026-11-05', 'TechCorner', -389, 'Shopping'), tx('2026-11-06', 'Bookhouse', -36, 'Shopping'), tx('2026-11-07', 'First trip', -900, 'Travel')];
  const u = E.unusual(txs, '2026-11', '2026-11-17');
  assert.equal(u.length, 1); assert.equal(u[0].tx.payee, 'TechCorner'); assert.ok(u[0].times > 10);
});

test('month on month and the estimate (average of the 3 months before, only with 3 months of history)', () => {
  const txs = ['08', '09', '10'].flatMap(m => [tx('2026-' + m + '-10', 'Shop', -300, 'Groceries'), tx('2026-' + m + '-25', 'Pay', 2000, 'Salary')]);
  txs.push(tx('2026-10-11', 'Shop', -60, 'Groceries'));
  const f = E.forecast(txs, '2026-11');
  assert.equal(f.ready, true); assert.equal(f.perCategory[0].estimate, 32000); assert.equal(f.income, 200000);
  assert.equal(E.forecast(txs.filter(t => !t.date.startsWith('2026-08')), '2026-11').ready, false);
  const mom = E.monthOnMonth(txs, '2026-10');
  assert.equal(mom[0].change, 6000); assert.equal(mom[0].changePct, 20);
});

test('CSV: delimiters, quotes, header guess, dates, debit and credit columns', () => {
  const text = '﻿Date;Description;Amount;Category\r\n17.11.2026;"Café ""Lumen""; table 4";-12,50;Eating out\r\n18.11.2026;Salary;3 420,00;Salary\r\n';
  const d = E.detectDelimiter(text); assert.equal(d, ';');
  const rows = E.parseCsv(text, d);
  assert.equal(rows.length, 3); assert.equal(rows[1][1], 'Café "Lumen"; table 4');
  const map = E.guessMapping(rows[0]);
  assert.deepEqual([map.date, map.payee, map.amount, map.category], [0, 1, 2, 3]);
  const prep = E.prepareImport(rows, map, { dateFormat: 'DMY' }, []);
  assert.equal(prep[0].tx.amount, -1250); assert.equal(prep[0].tx.date, '2026-11-17'); assert.equal(prep[1].tx.category, 'Salary');
  assert.equal(E.parseDate('11/17/2026', 'MDY'), '2026-11-17'); assert.equal(E.parseDate('31/02/2026', 'DMY'), null);
  const dc = E.parseCsv('date,payee,debit,credit\n2026-11-01,Shop,25.00,\n2026-11-02,Refund,,5.00', ',');
  const m2 = E.guessMapping(dc[0]); const p2 = E.prepareImport(dc, m2, {}, []);
  assert.deepEqual(p2.map(x => x.tx.amount), [-2500, 500]);
});

test('import: every unusable row says why; duplicates found in the file and in what is already there', () => {
  const rows = [['date', 'payee', 'amount'], ['2026-11-01', 'Shop', '-10'], ['2026-11-01', 'Shop', '-10'], ['someday', 'Shop', '-5'], ['2026-11-03', '', 'x'], ['2026-11-04', 'FreshMart', '-72.10']];
  const existing = [tx('2026-11-04', 'FRESHMART 0042', -72.10, 'Groceries')];
  const p = E.prepareImport(rows, E.guessMapping(rows[0]), {}, existing);
  assert.equal(p[0].duplicate, ''); assert.equal(p[1].duplicate, 'appears twice in this file');
  assert.match(p[2].errors[0], /date/); assert.equal(p[3].errors.length, 2);
  assert.equal(p[4].duplicate, 'already in your transactions');
  assert.equal(p[2].line, 4);
});

test('CSV export cannot carry a spreadsheet formula', () => {
  const csv = E.toCsv([tx('2026-11-01', '=HYPERLINK("x")', -10, 'Other'), tx('2026-11-02', 'Shop, "big"', 5.5, 'Other income')]);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"|'=HYPERLINK/);
  assert.match(csv, /"Shop, ""big"""/);
  assert.match(csv, /,-10\.00,/); assert.match(csv, /,5\.50,/);
});

test('changes are checked: transactions and budgets', () => {
  let d = E.emptyData();
  const bad = E.upsertTx(d, { date: '2026-13-01', payee: '', amount: 0, category: 'Nope' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'category', 'date', 'payee']);
  const ok = E.upsertTx(d, { date: '2026-11-01', payee: ' Shop ', amount: -1000, category: 'Groceries' });
  assert.equal(ok.tx.payee, 'Shop'); d = ok.data;
  d = E.upsertTx(d, { ...ok.tx, amount: -2000 }).data; assert.equal(d.transactions.length, 1); assert.equal(d.transactions[0].amount, -2000);
  assert.equal(E.removeTx(d, [ok.tx.id]).transactions.length, 0);
  assert.ok(E.setBudget(d, 'Salary', 100).error); assert.ok(E.setBudget(d, 'Groceries', -1).error);
  assert.equal(E.setBudget(d, 'Groceries', 0).data.budgets.Groceries, undefined);
});

test('the sample data is valid and tells a story: an overspend, an unusual purchase, a price rise', () => {
  const d = seed('2026-11-17');
  assert.ok(E.isValidData(d));
  const ins = E.insights(d, '2026-11-17').map(i => i.title).join(' | ');
  assert.match(ins, /over budget/); assert.match(ins, /unusual/); assert.match(ins, /costs more/);
  assert.deepEqual(seed('2026-11-17'), d, 'same day, same sample');
  assert.ok(E.isValidData(seed('2027-03-01')));
});

test('daily habit: spent now, per day left, logged days, recap, due now, reminder file', () => {
  const d = { ...E.emptyData(), transactions: [
    { id: 'a', date: '2026-11-17', payee: 'Bakery', amount: -450, category: 'Groceries', note: '' },
    { id: 'b', date: '2026-11-16', payee: 'Bus', amount: -200, category: 'Transport', note: '' },
    { id: 'c', date: '2026-11-10', payee: 'Shop', amount: -3000, category: 'Shopping', note: '' },
    { id: 'd', date: '2026-11-04', payee: 'Shop', amount: -1000, category: 'Shopping', note: '' },
  ], checkins: ['2026-11-15'] };
  assert.equal(E.weekStart('2026-11-17'), '2026-11-16'); // a Tuesday; the week starts on Monday
  assert.deepEqual(E.spentNow(d, '2026-11-17'), { today: 450, week: 650 });
  assert.equal(E.perDayLeft(d, '2026-11-17'), null);
  const b = { ...d, budgets: { Groceries: 20000, Shopping: 3000 } };
  const p = E.perDayLeft(b, '2026-11-17');
  assert.equal(p.daysLeft, 14); assert.equal(p.left, 19550); assert.equal(p.perDay, 1396); assert.deepEqual(p.over, ['Shopping']);
  assert.deepEqual(E.loggedDays(d, '2026-11-17', 7), { count: 3, of: 7, today: true });
  const r = E.weekRecap(d, '2026-11-17');
  assert.equal(r.spent, 3000); assert.equal(r.before, 1000); assert.equal(r.top, 'Shopping');
  const ics = E.reminderIcs('20:30', 'https://example.test/x/#/overview', '2026-11-17', 'u1');
  assert.match(ics, /DTSTART:20261117T203000/); assert.match(ics, /RRULE:FREQ=DAILY/); assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  const monthly = ['2026-08-03', '2026-09-03', '2026-10-03'].map((date, i) => ({ id: 'm' + i, date, payee: 'Streamly', amount: -1299, category: 'Subscriptions', note: '' }));
  const due = E.dueNow({ ...E.emptyData(), transactions: monthly }, '2026-11-04');
  assert.equal(due.length, 1); assert.equal(due[0].amount, 1299);
  assert.equal(E.dueNow({ ...E.emptyData(), transactions: monthly, dismissed: [due[0].id] }, '2026-11-04').length, 0);
});

test('savings goals: honest percentages, a kind pace, never below zero, cents only', () => {
  const g = { id: 'g1', name: 'Trip', target: 300000, by: '2027-06-20', icon: 'trip', pinned: false, adds: [{ amount: 299999, date: '2026-11-01', note: '' }] };
  assert.equal(E.goalProgress(g, '2026-11-17').percent, 99, '100 % only when fully reached');
  assert.equal(E.goalProgress({ ...g, adds: [{ amount: 300000, date: '2026-11-01' }] }, '2026-11-17').percent, 100);
  assert.equal(E.goalProgress({ ...g, adds: [{ amount: 300000, date: '2026-11-01' }] }, '2026-11-17').line, 'Goal reached. Well done.');
  assert.equal(E.goalProgress({ ...g, adds: [{ amount: 300000, date: '2026-11-01' }] }, '2026-11-17').pace, null, 'no pace once reached');
  const half = { ...g, adds: [{ amount: 150000, date: '2026-11-01' }] };
  assert.equal(E.goalProgress(half, '2026-11-17').line, 'Halfway there.');
  assert.equal(E.goalProgress({ ...g, adds: [] }, '2026-11-17').line, 'A first step is all it takes.');
  // pace: remaining / weeks left, rounded up to a whole unit
  const p = E.goalProgress({ ...g, adds: [], by: '2026-11-25' }, '2026-11-17').pace;
  assert.deepEqual(p, { perWeek: 150000, weeks: 2 });
  assert.deepEqual(E.goalProgress({ ...g, adds: [], by: '2026-11-18' }, '2026-11-17').pace, { perWeek: 300000, weeks: 1 }, 'less than a week counts as one');
  assert.equal(E.goalProgress({ ...g, adds: [], by: '2026-11-17' }, '2026-11-17').pace.stale, true, 'date reached: could use a new date');
  assert.equal(E.goalProgress({ ...g, adds: [], by: '2026-10-01' }, '2026-11-17').pace.stale, true);
  assert.equal(E.goalProgress({ ...g, adds: [{ amount: 1, date: '2026-11-01' }], by: '2027-11-17' }, '2026-11-17').pace.perWeek % 100, 0, 'whole units');
  // taking out
  assert.ok(E.goalEntry(half, -150001, '2026-11-17', 'repair').error, 'cannot go below zero');
  assert.equal(E.goalSaved(E.goalEntry(half, -50000, '2026-11-17', 'repair').goal), 100000);
  // validation
  assert.ok(E.validateGoal({ ...g, target: 12.5 }).target, 'cents only');
  assert.ok(E.validateGoal({ ...g, name: 'x'.repeat(41) }).name);
  assert.ok(E.validateGoal({ ...g, adds: [{ amount: 1.5, date: '2026-11-01' }] }).adds);
  assert.deepEqual(E.validateGoal(g), {});
  // banner: pinned, else nearest date, archived never
  const a = { ...g, id: 'a', by: '2027-01-01' }; const b = { ...g, id: 'b', by: '2026-12-01' }; const c = { ...g, id: 'c', by: '', pinned: true };
  assert.equal(E.bannerGoal([a, b]).id, 'b'); assert.equal(E.bannerGoal([a, b, c]).id, 'c'); assert.equal(E.bannerGoal([{ ...b, archivedAt: '2026-11-01' }]), null);
  // the sample: Summer trip, 3,000, 41 %
  const s = seed('2026-11-17'); const sp = E.goalProgress(s.goals[0], '2026-11-17');
  assert.equal(s.goals[0].name, 'Summer trip'); assert.equal(s.goals[0].target, 300000); assert.equal(sp.percent, 41);
  assert.ok(E.isValidData(s));
  // month card: savings are not spending
  const mc = E.monthCard(s, '2026-10', '2026-11-17');
  assert.equal(mc.saved, 20500); assert.ok(mc.plan > 0);
});
