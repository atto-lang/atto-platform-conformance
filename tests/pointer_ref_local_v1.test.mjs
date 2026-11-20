// Source-only contract integrity. Not a compiler test, Wasm guest, or AOT proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/pointer-ref-local-v1.json'), 'utf8'));
const load = path => {
  assert.match(path, /^fixtures\/pointer-ref-local-v1\/(pass|fail)\/[a-z-]+\.atto$/);
  return readFileSync(resolve(root, path), 'utf8');
};

test('versioned alias contract contains two exact positive programs and six negatives', () => {
  assert.equal(manifest.schema, 'atto.pointer-ref-local.v1');
  assert.equal(manifest.status, 'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(manifest.cases.length, 8);
  assert.deepEqual(manifest.cases.map(c => c.id), Array.from({length:8}, (_,i) => 'PRL-'+String(i+1).padStart(3,'0')));
  assert.deepEqual(manifest.cases.map(c => c.result), ['PASS','PASS',...Array(6).fill('REJECT_NO_ARTIFACT')]);
  const [rt, bang] = manifest.cases.map(c => load(c.path));
  assert.match(rt, /val Pointer<int> ptr = rt ref value;/);
  assert.match(rt, /val answer = rt deref ptr;/);
  assert.match(rt, /rt unref ptr;/);
  assert.match(bang, /val Pointer<int> ptr = rt ref value;/);
  assert.match(bang, /val answer = deref! ptr;/);
  assert.match(bang, /unref! ptr;/);
  assert.equal(rt.replace('rt deref ptr', 'deref! ptr').replace('rt unref ptr', 'unref! ptr'), bang);
  assert.equal(manifest.cases[0].exit, 42);
  assert.equal(manifest.cases[1].exit, 42);
});

test('every backend is unverified and every case is target-only', () => {
  assert.deepEqual(Object.keys(manifest.backend_status).sort(), ["atto-source.atto","atto-source.cranelift","atto-source.forge","atto-source.hdl","atto-source.java","atto-source.js","atto-source.llvm","atto-source.net","atto-source.realtime","atto-source.rs","atto-source.wasm"]);
  for (const v of Object.values(manifest.backend_status)) {
    assert.equal(v.status, 'NOT_EXECUTED');
    assert.equal(v.compiler_commit, null);
    assert.equal(v.guest_artifact, null);
  }
  for (const c of manifest.cases) {
    assert.equal(c.status, 'NOT_EXECUTED');
    const source = load(c.path);
    assert.ok(source.endsWith('\n'));
    assert.match(source, /pub fnc main\(\): int/);
    if (c.result === 'PASS') assert.ok(!('error_category' in c));
    else {
      assert.match(c.error_category, /^E_POINTER_/);
      assert.ok(!('exit' in c));
    }
  }
  const negatives = manifest.cases.slice(2).map(c => load(c.path));
  assert.match(negatives[0], /unref! ptr;[\s\S]*rt unref ptr;/);
  assert.match(negatives[1], /unref! ptr;[\s\S]*deref! ptr;/);
  assert.match(negatives[2], /return ptr;/);
  assert.match(negatives[3], /42 as Pointer<int>/);
  assert.match(negatives[4], /value = 43;/);
  assert.match(negatives[5], /return rt deref ptr;/);
});
