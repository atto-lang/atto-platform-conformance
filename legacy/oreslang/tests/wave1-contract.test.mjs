import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {loadWave1, validateWave1Spec, verifyWave1Fixtures} from '../src/wave1-contract.mjs';
const fresh = value => structuredClone(value);

test('the entire five-task target inventory and pinned seven-file corpus are accounted for', async () => {
  const {spec, result} = await loadWave1();
  assert.deepEqual(spec.tasks.map(x => x.task), [1,2,3,4,5]);
  assert.equal(result.fixturesPinned, 7);
  assert.equal(result.backendTargets, 5);
  assert.equal(result.compilerExecutions, 0);
  assert.equal(result.parityEstablished, false);
  assert.equal(result.status, 'CONTRACT_ONLY');
});

test('fake evidence, statuses and missing backend coverage cannot self-promote', async () => {
  const {spec} = await loadWave1();
  for (const mutate of [
    x => { x.tasks[2].backends.java = 'verified'; },
    x => { delete x.tasks[4].backends.llvm; },
    x => { x.backends.splice(x.backends.indexOf('forge'),1); },
    x => { x.tasks[2].cases.pop(); },
    x => { x.tasks[1].task = 1; },
    x => { x.tasks[1].relatedPRs.push('https://evil.example/1'); },
    x => { x.fixtures[0].path = '../outside.ores'; },
    x => { x.fixtures[1].id = x.fixtures[0].id; },
    x => { x.fixtures[0].sha256 = 'not-a-hash'; },
    x => { x.fixtures[0].expectedInt = '42'; },
    x => { x.fixtures[1].diagnosticClass = 'anything-failed'; },
    x => { delete x.fixtures[4].diagnosticClass; },
    x => { x.tasks[3].cases.push('nonexistent'); },
    x => { x.tasks[4].backends.wasm = {status:'verified', evidence:'fake'}; },
  ]) {
    const broken = fresh(spec); mutate(broken);
    assert.throws(() => validateWave1Spec(broken));
  }
});

test('tampered content, missing content and synthetic non-buffer content fail closed', async () => {
  const {spec} = await loadWave1();
  const reader = p => readFile(new URL('../'+p, import.meta.url));
  await assert.rejects(verifyWave1Fixtures(spec, async p =>
    p === spec.fixtures[0].path ? Buffer.from('changed') : reader(p)), /changed/);
  await assert.rejects(verifyWave1Fixtures(spec, async p =>
    p === spec.fixtures[0].path ? Buffer.from([]) : reader(p)), /changed/);
  await assert.rejects(verifyWave1Fixtures(spec, async p =>
    p === spec.fixtures[0].path ? 'not bytes' : reader(p)), /changed/);
});

test('CLI validation success never equals backend certification', () => {
  const cli = new URL('../bin/wave1-status.mjs', import.meta.url).pathname;
  const report = spawnSync(process.execPath, [cli], {encoding:'utf8'});
  assert.equal(report.status, 0);
  const data = JSON.parse(report.stdout);
  assert.equal(data.parityEstablished, false);
  assert.equal(data.compilerExecutions, 0);
  const strict = spawnSync(process.execPath, [cli, '--require-parity'], {encoding:'utf8'});
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).status, 'CONTRACT_ONLY');
  const bad = spawnSync(process.execPath, [cli, '--fake-verified'], {encoding:'utf8'});
  assert.equal(bad.status, 2);
});
