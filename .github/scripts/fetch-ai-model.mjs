// Downloads the Test Pilot AI model once from Hugging Face, checks every large
// file against the SHA-256 that Hugging Face publishes, and writes a manifest.
// Runs only in GitHub Actions (PORT-30 step 3). No secrets are used.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const cfg = Object.fromEntries(readFileSync('.github/ai-model.txt', 'utf8').split('\n')
  .filter((l) => l && !l.startsWith('#')).map((l) => l.split('=').map((s) => s.trim())));
if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo) || !/^[\w.-]+$/.test(cfg.revision)) throw new Error('bad ai-model.txt');
const HF = 'https://huggingface.co';
const OUT = 'projects/test-pilot/ai/model';
const KEEP = /^(mlc-chat-config\.json|ndarray-cache\.json|tokenizer\.json|tokenizer_config\.json|vocab\.json|merges\.txt|params_shard_\d+\.bin)$/;

const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' -> ' + r.status); return r; };
const rev = (await (await get(`${HF}/api/models/${cfg.repo}/revision/${cfg.revision}`)).json()).sha;
if (!/^[0-9a-f]{40}$/.test(rev)) throw new Error('no commit for revision');
const tree = await (await get(`${HF}/api/models/${cfg.repo}/tree/${rev}`)).json();
const files = tree.filter((f) => f.type === 'file' && KEEP.test(f.path));
if (!files.some((f) => f.path === 'ndarray-cache.json')) throw new Error('not an MLC model');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifest = { repo: cfg.repo, commit: rev, fetched: new Date().toISOString(), files: [] };
for (const f of files) {
  const buf = Buffer.from(await (await get(`${HF}/${cfg.repo}/resolve/${rev}/${f.path}`)).arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (f.lfs && f.lfs.oid !== sha) throw new Error(`${f.path}: SHA-256 mismatch`);
  if (buf.length !== (f.lfs ? f.lfs.size : f.size)) throw new Error(`${f.path}: size mismatch`);
  if (buf.length > 95 * 1024 * 1024) throw new Error(`${f.path}: over 95 MB, GitHub would refuse it`);
  writeFileSync(join(OUT, f.path), buf);
  manifest.files.push({ path: f.path, bytes: buf.length, sha256: sha });
  console.log(`${f.path}  ${(buf.length / 1048576).toFixed(1)} MB  ${sha}`);
}
manifest.totalMB = +(manifest.files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1);
writeFileSync(join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Total ${manifest.totalMB} MB in ${files.length} files, commit ${rev}`);
