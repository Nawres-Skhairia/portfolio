// Test File Maker: builds a pain.001.001.09 file with made-up data, valid or with one planted mistake.
// Everything happens in this tab; nothing is uploaded or stored. "Open in Payment File Check" passes only the recipe.
import { SCENARIOS, generate } from './factory.js';
import { nextBusinessDay } from './rules.js';

const $ = (id) => document.getElementById(id);
const todayLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const sel = $('fScenario');
const groups = [['Valid file', (s) => s.expect === null], ['A SEPA rule broken', (s) => /^SCT/.test(s.expect || '')], ['The schema broken', (s) => s.expect === 'XSD'], ['The XML broken', (s) => s.expect === 'XML']];
for (const [label, test] of groups) {
  const og = document.createElement('optgroup'); og.label = label;
  for (const s of SCENARIOS.filter(test)) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; og.append(o); }
  sel.append(og);
}
const def = SCENARIOS.find((s) => s.id === 'header-sum'); if (def) sel.value = def.id;
$('fDate').value = nextBusinessDay(todayLocal());

let file = null;
$('makerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = sel.value, count = Math.min(10000, Math.max(1, Number($('fCount').value) || 25)), seed = Number($('fSeed').value) || 2026;
  const date = $('fDate').value || undefined;
  const g = generate({ scenario: id, count, seed, execDate: id === 'date-past' || id === 'date-closed' ? undefined : date, procDate: todayLocal() });
  file = g;
  const first = (g.xml.match(/<!--\s*([\s\S]*?)\s*-->/) || [])[1] || '';
  const expect = (first.match(/Expected finding: (.*)$/) || [])[1] || '';
  $('what').textContent = `${g.fileName} · ${count.toLocaleString('en')} payment${count > 1 ? 's' : ''} · expected finding: ${expect}`;
  const lines = g.xml.split('\n');
  $('pre').textContent = lines.slice(0, 40).join('\n') + (lines.length > 40 ? `\n… ${(lines.length - 40).toLocaleString('en')} more lines in the file` : '');
  const q = new URLSearchParams({ scenario: id, count: String(count), seed: String(seed) }); if (date) q.set('date', date);
  $('openCheck').href = '/projects/payment-file-check/?' + q.toString();
  $('out').hidden = false;
});
$('dl').addEventListener('click', () => {
  if (!file) return;
  const url = URL.createObjectURL(new Blob([file.xml], { type: 'application/xml' }));
  const a = document.createElement('a'); a.href = url; a.download = file.fileName; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
