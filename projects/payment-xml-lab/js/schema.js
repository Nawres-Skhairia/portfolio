// Schema layer: libxml2 (xmllint-wasm, MIT) compiled to WebAssembly, run in its own worker.
// The worker is killed after TIME_LIMIT_MS. No network: the schema is a file served by this site.
// Adapted from xmllint-wasm 5.3.0 index-browser.mjs (MIT, see ../vendor/xmllint-5.3.0/COPYING).

const MESSAGE_KEY = 'xmllint-wasm';
export const TIME_LIMIT_MS = 20000;
const schemaCache = new Map();

export async function loadSchema(url) {
  if (!schemaCache.has(url)) {
    schemaCache.set(url, fetch(url, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error('Schema file could not be loaded (' + r.status + ').');
      return r.text();
    }));
  }
  return schemaCache.get(url);
}

// Returns { valid, errors: [{ line, raw, message }], timeMs }
export function validate(xmlText, schemaText, schemaName) {
  const started = performance.now();
  const inputFiles = [
    { fileName: 'payment.xml', contents: xmlText },
    { fileName: schemaName, contents: schemaText },
  ];
  // --nonet: never fetch anything. No --noent, no --loaddtd, no --dtdvalid:
  // entities are not expanded and no DTD is read (and the safety gate already refused any DOCTYPE).
  const args = ['--schema', schemaName, '--noout', '--nonet', 'payment.xml'];
  const job = { inputFiles, args, initialMemory: 256, maxMemory: 4096 };
  job[MESSAGE_KEY] = true;

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../vendor/xmllint-5.3.0/xmllint-browser.mjs', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('The schema check took longer than ' + TIME_LIMIT_MS / 1000 + ' seconds and was stopped.'));
    }, TIME_LIMIT_MS);
    worker.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d[MESSAGE_KEY] !== true) return;
      clearTimeout(timer);
      worker.terminate();
      const timeMs = Math.round(performance.now() - started);
      if (d.exitCode === 0) return resolve({ valid: true, errors: [], timeMs });
      if (d.exitCode === 1 || d.exitCode === 3 || d.exitCode === 4) {
        return resolve({ valid: false, errors: parseErrors(d.stderr), timeMs });
      }
      reject(new Error('The schema check could not finish (code ' + d.exitCode + '). ' + String(d.stderr || '').slice(0, 300)));
    });
    worker.addEventListener('error', (err) => {
      clearTimeout(timer); worker.terminate();
      reject(new Error('The schema engine could not start: ' + (err.message || 'unknown error')));
    });
    worker.postMessage(job);
  });
}

// libxml2 prints "payment.xml:12: element Amt: Schemas validity error : ...", then the source line and a caret.
function parseErrors(stderr) {
  const out = [];
  for (const line of String(stderr).split('\n')) {
    const m = line.match(/^payment\.xml:(\d+):\s*(.*)$/);
    if (m) { out.push({ line: Number(m[1]), raw: line, message: m[2] }); continue; }
    const s = line.match(/^(?:\S+\.xsd):(\d+):\s*(.*)$/);
    if (s) out.push({ line: null, raw: line, message: 'Schema file problem: ' + s[2] });
  }
  return out;
}
