// A deliberately source-only integrity gate; it never starts any Atto compiler.
import {readFileSync, lstatSync} from 'node:fs';
import {resolve, relative, sep, join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const IDS = ["guard-success","guard-fallthrough-reject","guard-else-reject","routine-direct","fnc-recursive","routine-self-reject","routine-mutual-reject","routine-value-reject","export-forward","export-trailing-pkg","export-kind-reject","export-unknown-reject"];
const BACKENDS = ["java","llvm","net","wasm","forge","rust_browser"];
export const EXPECTED_EVIDENCE_CLASS = 'SOURCE_ONLY_NOT_COMPILER_EXECUTION';

export function gitBlob(bytes) {
  return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}
function pinnedRegularFile(root, relativePath) {
  if (!/^(?:fixtures\/(?:guard-v1|atto-language-previews-v1)\/[a-z0-9-]+\.atto)$/.test(relativePath))
    throw new Error('Unexpected fixture path: ' + relativePath);
  let current = resolve(root);
  const segments = relativePath.split('/');
  for (const name of segments) {
    current = join(current, name);
    const st = lstatSync(current);
    if (st.isSymbolicLink()) throw new Error('Symlink fixture component: ' + relativePath);
    if (name === segments.at(-1) && !st.isFile()) throw new Error('Not a regular fixture: ' + relativePath);
    if (name !== segments.at(-1) && !st.isDirectory()) throw new Error('Invalid fixture directory: ' + relativePath);
  }
  const rel = relative(resolve(root), current);
  if (rel.startsWith('..' + sep) || rel === '..') throw new Error('Fixture escaped root');
  const bytes = readFileSync(current);
  if (bytes.length < 40 || bytes.length > 65536) throw new Error('Fixture size invalid: ' + relativePath);
  const content = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (content.includes('\0') || !content.endsWith('\n')) throw new Error('Invalid fixture source: ' + relativePath);
  return {bytes, content};
}
export function validateAttoPreviewManifest(manifest, root) {
  assert.equal(manifest.schema, 'atto.language.previews.source-v1');
  assert.equal(manifest.evidence_class, EXPECTED_EVIDENCE_CLASS);
  assert.equal(manifest.status, 'NOT_EXECUTED');
  assert.equal(manifest.canonical_extension, '.atto');
  assert.deepEqual(manifest.compiler_receipts, []);
  assert.deepEqual(Object.keys(manifest.backend_status), BACKENDS);
  assert.deepEqual(Object.values(manifest.backend_status), BACKENDS.map(() => 'UNVERIFIED'));
  assert.deepEqual(manifest.existing_contracts, {
    guard:'contracts/guard-v1.json',
    explicit_exports:'contracts/explicit-exports-v1.json',
    routine_tailcalls:'contracts/tail-calls-v1.json'
  });
  assert.deepEqual(manifest.fixtures.map(x=>x.id), IDS);
  assert.equal(new Set(manifest.fixtures.map(x=>x.path)).size, IDS.length);
  const guard = JSON.parse(readFileSync(resolve(root,'contracts/guard-v1.json'),'utf8'));
  assert.equal(guard.status, 'SOURCE_CONTRACT_NOT_BACKEND_EXECUTION');
  assert.deepEqual(guard.receipts, []);
  const results = {};
  for(const entry of manifest.fixtures) {
    assert.match(entry.git_blob,/^[a-f0-9]{40}$/);
    assert.ok(['ACCEPT','REJECT'].includes(entry.kind));
    if(entry.kind==='ACCEPT') {
      assert.equal(entry.expected_result,42);
      assert.equal(entry.diagnostic_class,undefined);
    } else {
      assert.match(entry.diagnostic_class,/^[A-Z_]+$/);
      assert.equal(entry.expected_result,undefined);
    }
    const {bytes,content}=pinnedRegularFile(root,entry.path);
    if(gitBlob(bytes)!==entry.git_blob)throw new Error('Git blob drift: '+entry.path);
    if(!/\b(?:fnc|routine)\b/.test(content))throw new Error('Missing callable: '+entry.path);
    if(entry.id.startsWith('guard-')) {
      const pinned = guard.fixtures.find(x=>x.path===entry.path);
      if(!pinned || pinned.git_blob!==entry.git_blob)throw new Error('Guard contract drift: '+entry.path);
    }
    results[entry.id] = {git_blob:entry.git_blob,bytes:bytes.length,kind:entry.kind};
  }
  return results;
}
