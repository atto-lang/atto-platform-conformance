// A deliberately source-only integrity gate; it never starts any Atto compiler.
import {readFileSync, lstatSync, readdirSync, openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {resolve, relative, sep, join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const IDS = ["guard-success","guard-fallthrough-reject","guard-else-reject","routine-direct","fnc-recursive","routine-self-reject","routine-mutual-reject","routine-value-reject","export-forward","export-trailing-pkg","export-kind-reject","export-unknown-reject"];
const BACKENDS = ["java","llvm","net","wasm","forge","rust_browser"];
// Independent literal pins; self-referential manifest digests are not sufficient.
const PINNED = [
  {
    "id": "guard-success",
    "path": "fixtures/guard-v1/canonical-scalar.atto",
    "git_blob": "c86ac476e55074031c0bcda02f5eaf3cb1399477",
    "kind": "ACCEPT",
    "expected_result": 42
  },
  {
    "id": "guard-fallthrough-reject",
    "path": "fixtures/guard-v1/reject-fallthrough.atto",
    "git_blob": "1ff87aa95ed2537839347e80984c69ae46fdfa17",
    "kind": "REJECT",
    "diagnostic_class": "GUARD_FALLTHROUGH"
  },
  {
    "id": "guard-else-reject",
    "path": "fixtures/guard-v1/reject-else.atto",
    "git_blob": "b2bbee98cd3b95ac19462b4efd95a2e98b469154",
    "kind": "REJECT",
    "diagnostic_class": "GUARD_ELSE_FORBIDDEN"
  },
  {
    "id": "routine-direct",
    "path": "fixtures/atto-language-previews-v1/routine-direct.atto",
    "git_blob": "66d9dad98958809bae20d3608ff7f8621c1484e2",
    "kind": "ACCEPT",
    "expected_result": 42
  },
  {
    "id": "fnc-recursive",
    "path": "fixtures/atto-language-previews-v1/fnc-recursive.atto",
    "git_blob": "4c07c9df1e3a4090b746e59076dea2dd7c91f887",
    "kind": "ACCEPT",
    "expected_result": 42
  },
  {
    "id": "routine-self-reject",
    "path": "fixtures/atto-language-previews-v1/routine-self-reject.atto",
    "git_blob": "09b26694926ba306786ea9230bf9c8611d0b6a2a",
    "kind": "REJECT",
    "diagnostic_class": "RECURSIVE_ROUTINE"
  },
  {
    "id": "routine-mutual-reject",
    "path": "fixtures/atto-language-previews-v1/routine-mutual-reject.atto",
    "git_blob": "f157ce9590d90439caaee1f269620025c5466a21",
    "kind": "REJECT",
    "diagnostic_class": "RECURSIVE_ROUTINE"
  },
  {
    "id": "routine-value-reject",
    "path": "fixtures/atto-language-previews-v1/routine-value-reject.atto",
    "git_blob": "76117416e4cc96cc08d59222399687b38e035fab",
    "kind": "REJECT",
    "diagnostic_class": "ROUTINE_NOT_FIRST_CLASS"
  },
  {
    "id": "export-forward",
    "path": "fixtures/atto-language-previews-v1/export-forward.atto",
    "git_blob": "4a7fe76ab77d14bee1c00176087fd116d87be09c",
    "kind": "ACCEPT",
    "expected_result": 42
  },
  {
    "id": "export-trailing-pkg",
    "path": "fixtures/atto-language-previews-v1/export-trailing-pkg.atto",
    "git_blob": "1896ee7a5d1ff694ec19f4dcbca9fc2da256120f",
    "kind": "ACCEPT",
    "expected_result": 42
  },
  {
    "id": "export-kind-reject",
    "path": "fixtures/atto-language-previews-v1/export-kind-reject.atto",
    "git_blob": "a7d77c52e57c966fe6211288f5d450146fc719d5",
    "kind": "REJECT",
    "diagnostic_class": "EXPORT_KIND_MISMATCH"
  },
  {
    "id": "export-unknown-reject",
    "path": "fixtures/atto-language-previews-v1/export-unknown-reject.atto",
    "git_blob": "2384d5c5417719e2d7178bed576e9ac49ee4806e",
    "kind": "REJECT",
    "diagnostic_class": "EXPORT_UNKNOWN_TARGET"
  }
];
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
  // Follow the already-vetted descriptor rather than reopening the path.
  const fd = openSync(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_CLOEXEC ?? 0));
  let bytes;
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size < 40 || st.size > 65536)
      throw new Error('Fixture size invalid: ' + relativePath);
    bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!n) throw new Error('Truncated fixture: ' + relativePath);
      offset += n;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0)
      throw new Error('Fixture grew while reading: ' + relativePath);
    const after = fstatSync(fd);
    if (st.dev !== after.dev || st.ino !== after.ino || st.size !== after.size || st.mtimeMs !== after.mtimeMs)
      throw new Error('Fixture mutated during read: ' + relativePath);
  } finally { closeSync(fd); }
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
  assert.deepEqual(manifest.fixtures, PINNED, 'Fixture identity / outcome drift');
  assert.deepEqual(manifest.fixtures.map(x=>x.id), IDS);
  assert.equal(new Set(manifest.fixtures.map(x=>x.path)).size, IDS.length);
  const actual = readdirSync(resolve(root,'fixtures/atto-language-previews-v1'))
    .filter(name => name.endsWith('.atto')).sort();
  const wanted = PINNED.filter(x=>x.path.startsWith('fixtures/atto-language-previews-v1/'))
    .map(x=>x.path.split('/').at(-1)).sort();
  assert.deepEqual(actual,wanted,'Unlisted fixture source is not allowed');
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
