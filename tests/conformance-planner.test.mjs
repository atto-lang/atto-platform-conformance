import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { planConformance } from '../bin/list-cases.mjs';

const contract = JSON.parse(readFileSync(new URL('../contracts/aot-gc-tenant-evidence-v1.json', import.meta.url)));
const clone = () => structuredClone(contract);

test('all conformance plans remain unexecuted and never certify a backend', () => {
  const plan = planConformance(contract);
  assert.equal(plan.schema, 'atto.conformance-plan.v1');
  assert.equal(plan.certification, 'NOT_CERTIFIED');
  assert.equal(plan.guest_executed, false);
  assert.equal(plan.entries.length, Object.keys(contract.profiles).length * contract.cases.length);
  assert.ok(plan.entries.every(x => x.status === 'not_executed'));
  assert.equal(new Set(plan.entries.map(x => x.profile + ':' + x.case_id)).size, plan.entries.length);
});

test('backend filtering picks every profile of the selected backend', () => {
  for (const backend of ['java', 'llvm', 'wasm', 'forge', 'net']) {
    const expected = Object.values(contract.profiles).filter(x => x.backend === backend).length;
    const plan = planConformance(contract, backend);
    assert.equal(plan.entries.length, expected * contract.cases.length);
    assert.ok(plan.entries.every(x => x.backend === backend));
  }
  assert.throws(() => planConformance(contract, 'unknown'), /unsupported backend/);
});

test('baseline promotion, invalid cases and false security labels fail closed', () => {
  const altered = [
    x => { x.status = 'PASSED'; },
    x => { x.default_statuses.llvm = 'PASSED'; },
    x => { x.cases.push({ ...x.cases[0] }); },
    x => { x.cases[0].fixture = 'missing'; },
    x => { x.cases[0].require_tenant_security = true; },
    x => { x.profiles['extra'] = { backend: 'unknown' }; }
  ];
  for (const mutate of altered) {
    const value = clone();
    mutate(value);
    assert.throws(() => planConformance(value), /E_CONFORMANCE_PLAN/);
  }
});

test('CLI reports machine-readable plans and rejects invalid flags', () => {
  const script = new URL('../bin/list-cases.mjs', import.meta.url).pathname;
  const good = spawnSync(process.execPath, [script, '--backend', 'llvm'], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.ok(JSON.parse(good.stdout).entries.every(x => x.backend === 'llvm'));
  const bad = spawnSync(process.execPath, [script, '--backend', 'fake'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  const usage = spawnSync(process.execPath, [script, '--status', 'passed'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, '');
});
