// CV page budget (speed and accessibility). Runs in the free GitHub check. No network, no packages.
// Fails when the CV pages grow past the budget or lose a basic accessibility guarantee.
import { readFileSync, statSync } from 'node:fs';

const BUDGET = { cssJsBytes: 60 * 1024, htmlBytes: 40 * 1024 };
const pages = [['cv/index.html', 'en'], ['cv/fr/index.html', 'fr']];
const assets = ['cv/cv.css', 'cv/cv.js', 'cv/cv-fx.js'];
const fail = [];
const size = (f) => statSync(f).size;

const total = assets.reduce((n, f) => n + size(f), 0);
if (total > BUDGET.cssJsBytes) fail.push(`CV CSS + JS is ${total} bytes, budget ${BUDGET.cssJsBytes}`);

for (const [file, lang] of pages) {
  const html = readFileSync(file, 'utf8');
  if (size(file) > BUDGET.htmlBytes) fail.push(`${file} is ${size(file)} bytes, budget ${BUDGET.htmlBytes}`);
  if (!new RegExp(`<html lang="${lang}"`).test(html)) fail.push(`${file}: html lang="${lang}" missing`);
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) fail.push(`${file}: needs exactly one h1`);
  if (!/<main id="main"/.test(html)) fail.push(`${file}: main landmark missing`);
  if (/<img(?![^>]*\balt=)[^>]*>/.test(html)) fail.push(`${file}: an image has no alt text`);
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) fail.push(`${file}: inline script found (the safety rules forbid it)`);
  if (/<(script|link)[^>]+(src|href)="https?:\/\/(?!nawres-skhairia\.vercel\.app)/.test(html)) fail.push(`${file}: loads a file from another server`);
  if (!/hreflang="en"/.test(html) || !/hreflang="fr"/.test(html)) fail.push(`${file}: language alternates missing`);
  for (const id of ['cv-profile', 'cv-exp', 'cv-skills']) if (!html.includes(`id="${id}"`)) fail.push(`${file}: section ${id} missing`);
}
const fx = readFileSync('cv/cv-fx.js', 'utf8');
if (!/cv-motion-off/.test(readFileSync('cv/cv.js', 'utf8'))) fail.push('cv.js lost the Motion off switch');
if (/localStorage|document\.cookie|fetch\(|XMLHttpRequest/.test(fx + readFileSync('cv/cv.js', 'utf8'))) fail.push('CV scripts must not store data or make requests');
const css = readFileSync('cv/cv.css', 'utf8');
if (!/@media print/.test(css)) fail.push('cv.css lost its print rules');

if (fail.length) { console.error('CV budget failed:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log(`CV budget passed: CSS + JS ${(total / 1024).toFixed(1)} KB of ${BUDGET.cssJsBytes / 1024} KB, 2 pages checked.`);
