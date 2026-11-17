// Builds the private site into public/: the Expense Radar app files plus the private layer. No other tool is included.
import { cp, mkdir, rm } from 'node:fs/promises';
const here = new URL('.', import.meta.url).pathname;
const out = here + 'public/';
const er = here + '../../projects/expense-radar/';
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
for (const f of ['app.js', 'engine.js', 'seed.js', 'style.css', 'er-theme.js']) await cp(er + f, out + f);
for (const d of ['fonts', 'icons']) await cp(er + d, out + d, { recursive: true });
for (const f of ['index.html', 'personal.js', 'vault.js', 'personal.css', 'tt.js', 'sw.js', 'manifest.webmanifest', 'robots.txt']) await cp(here + f, out + f);
console.log('built', out);
