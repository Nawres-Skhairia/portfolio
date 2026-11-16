// Check worker: runs the whole pipeline (gate, libxml2, tree, rules) off the page.
// The page terminates this worker on time-out, which also stops the libxml2 worker it started.
import { check } from './engine.js';
import { validate } from './schema.js';

let xsdText = null;
self.addEventListener('message', async (e) => {
  const { type } = e.data || {};
  if (type === 'schema') { xsdText = e.data.text; return; }
  if (type !== 'check') return;
  const { id, src, bytes, procDate, xsdName } = e.data;
  try {
    const report = await check(src, {
      bytes, procDate,
      validateSchema: (xml) => validate(xml, xsdText, xsdName),
      onStage: (stage) => self.postMessage({ type: 'stage', id, stage }),
    });
    self.postMessage({ type: 'done', id, report });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err && err.message || err) });
  }
});
