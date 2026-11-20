// Source-only contract integrity. This NEVER runs/validates a guest compiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(resolve(root,'contracts/mutex-async-lease-v1.json'),'utf8'));

test('mutex contract is target-only and every backend starts NOT_EXECUTED', () => {
  assert.equal(contract.schema, 'atto.conformance.mutex-async-lease.v1');
  assert.equal(contract.status, 'TARGET_SOURCE_ONLY_NOT_EXECUTED');
  assert.equal(Object.keys(contract.backend_evidence).length,10);
  for (const evidence of Object.values(contract.backend_evidence)) {
    assert.equal(evidence.status,'NOT_EXECUTED');
    assert.equal(evidence.guest_evidence_url,null);
  }
});

test('mutex fixture sources are present, unique and declare exact outcomes', () => {
  const seen = new Set();
  for (const c of contract.cases.filter(x => x.source)) {
    assert.equal(seen.has(c.source),false, 'duplicate fixture '+c.source);
    seen.add(c.source);
    const full = resolve(root,contract.fixtures_dir,c.source);
    assert.equal(existsSync(full),true,full);
    const src = readFileSync(full,'utf8');
    if (c.feature !== 'await') {
      assert.match(src,/Mutex<int>/, 'mutex fixture must reference typed Mutex');
      assert.match(src,/lock_async\(\)/, 'mutex fixture must acquire asynchronously');
      assert.match(src,/\busing\b/, 'mutex fixture must use scoped cleanup');
    } else {
      assert.match(src,/await\s+42\s*;/, 'ready-await case must not depend on a host Promise');
    }
    if(c.kind==='compile_negative'){
      assert.equal(c.guest_artifact,false);
      assert.match(src,new RegExp(c.expected_diagnostic));
    } else {
      assert.equal(typeof c.expected_exit,'number');
    }
  }
  assert.ok(contract.cases.some(x=>x.kind==='runtime_probe'));
});

test('ready await and guard-await prohibition are separate source contracts', () => {
  const get = id => contract.cases.find(x => x.id === id);
  assert.equal(get('ready-await-no-forced-yield').expected_runtime_suspensions, 0);
  assert.equal(get('reject-guard-ready-await').expected_diagnostic, 'E_GUARD_SUSPEND');
  assert.equal(get('reject-guard-ready-await').guest_artifact, false);
  assert.ok(contract.cases.some(x => x.id === 'legacy-async-2-abi-rejection'));
});

test('two sequential acquisitions and overflowing guard are explicit unexecuted target cases', () => {
  const get = id => contract.cases.find(x => x.id === id);
  assert.equal(get('two-sequential-ready').expected_exit,2);
  assert.equal(get('two-sequential-ready').expected_sequential_acquisitions,2);
  assert.equal(get('two-sequential-ready').expected_releases,2);
  assert.equal(get('reject-guard-overflow').expected_diagnostic,'E_OVERFLOW');
  assert.equal(get('reject-guard-overflow').guest_artifact,false);
  assert.ok(contract.cases.length >= 18);
  assert.equal(contract.backend_evidence['atto-source.rs'].status,'NOT_EXECUTED',
    'source-only fixtures never promote actual compiler/guest parity');
});
