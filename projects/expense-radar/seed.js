// Made-up sample data for a fictional person: six months of everyday money, built from today's date
// so the screens always look current. Same result every time for the same date (seeded random).
import { addMonths, monthOf, daysInMonth } from './engine.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pad = n => String(n).padStart(2, '0');

export function seed(today) {
  const r = rng(20261117);
  const cur = monthOf(today); const dayNow = Number(today.slice(8, 10));
  const txs = []; let k = 0;
  const add = (date, payee, euros, category, note = '') => { if (date <= today) txs.push({ id: 's' + (k++).toString(36), date, payee, amount: Math.round(euros * 100), category, note }); };
  const pick = list => list[Math.floor(r() * list.length)];
  const around = (base, spread) => Math.round((base + (r() * 2 - 1) * spread) * 100) / 100;
  for (let i = -6; i <= 0; i++) {
    const m = addMonths(cur, i); const days = daysInMonth(m); const last = i === 0 ? dayNow : days;
    const d = n => m + '-' + pad(Math.min(n, days));
    add(d(25), 'Northwind Studio — salary', 3420, 'Salary');
    if (i === -2) add(d(14), 'Freelance illustration', 380, 'Other income', 'Poster for a local café');
    add(d(1), 'Linden Court rent', -1150, 'Housing');
    add(d(3), 'City Power & Water', -around(96, 14), 'Utilities');
    add(d(5), 'Mobi phone plan', -18.99, 'Subscriptions');
    add(d(8), 'Streamly', i >= -1 ? -15.99 : -12.99, 'Subscriptions');
    add(d(12), 'Fitloop gym', -39, 'Subscriptions');
    add(d(19), 'Cloudbox storage', -2.99, 'Subscriptions');
    add(d(2), 'Metro monthly pass', -49, 'Transport');
    // weekly groceries, a few small shops
    for (let day = 4; day <= last; day += 7) add(d(day), pick(['FreshMart', 'FreshMart', 'Green Basket']), -around(72, 18), 'Groceries');
    for (let j = 0; j < 3; j++) { const day = 1 + Math.floor(r() * last); add(d(day), pick(['Corner Bakery', 'Daily Fruit']), -around(9, 4), 'Groceries'); }
    // eating out: more this month, so the budget is under pressure
    const meals = i === 0 ? 9 : 5;
    for (let j = 0; j < meals; j++) { const day = 1 + Math.floor(r() * last); add(d(day), pick(['Olive & Thyme', 'Noodle Bar 21', 'Café Lumen', 'Pizza Forno']), -around(i === 0 ? 31 : 24, 9), 'Eating out'); }
    for (let j = 0; j < 2; j++) { const day = 1 + Math.floor(r() * last); add(d(day), pick(['RideNow', 'City Bikes']), -around(11, 5), 'Transport'); }
    if (r() > 0.4) { const day = 1 + Math.floor(r() * last); add(d(day), pick(['Pharma Plus', 'Dr. Ivo Petrov clinic']), -around(28, 12), 'Health'); }
    for (let j = 0; j < 2; j++) { const day = 1 + Math.floor(r() * last); add(d(day), pick(['Bookhouse', 'Homeware Co', 'Threads & Co']), -around(34, 14), 'Shopping'); }
    if (r() > 0.3) { const day = 1 + Math.floor(r() * last); add(d(day), pick(['Cinema Aurora', 'Open Air Concert']), -around(22, 8), 'Leisure'); }
    if (i === -3) { add(d(16), 'SkyHop airlines', -214, 'Travel', 'Weekend in Porto'); add(d(17), 'Harbour Inn', -186, 'Travel'); }
    if (i === -1) add(d(20), 'Gift shop Ribbon', -45, 'Gifts', 'Birthday present');
  }
  // one clearly unusual purchase this month
  const odd = cur + '-' + pad(Math.max(1, dayNow - 3));
  add(odd, 'TechCorner', -389, 'Shopping', 'New headphones');
  txs.sort((a, b) => b.date.localeCompare(a.date) || a.payee.localeCompare(b.payee));
  return {
    version: 1, currency: 'EUR', transactions: txs,
    budgets: { Groceries: 360_00, 'Eating out': 150_00, Transport: 80_00, Shopping: 120_00, Subscriptions: 80_00, Leisure: 60_00, Utilities: 120_00 },
    subscriptions: [{ id: 'm1', name: 'Newspaper (paid yearly)', amount: 89_00, cadence: 'Yearly', category: 'Subscriptions', next: addMonths(cur, 4) + '-10' }],
    dismissed: [],
  };
}
