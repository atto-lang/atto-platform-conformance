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
    assert.match(src,/Mutex<int>/);
    assert.match(src,/lock_async\(\)/);
    assert.match(src,/\busing\b/);
    if(c.kind==='compile_negative'){
      assert.equal(c.guest_artifact,false);
      assert.match(src,new RegExp(c.expected_diagnostic));
    } else {
      assert.equal(c.expected_exit,0);
    }
  }
  assert.ok(contract.cases.some(x=>x.kind==='runtime_probe'));
});
