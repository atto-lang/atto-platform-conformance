#!/usr/bin/env node
// Source-free fixture inventory gate only. Does NOT parse, compile or execute AttoLang.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/actor-external-entrypoints-v1.json'), 'utf8'));
assert.equal(contract.schema, 'atto.actor.external-entrypoints/1');
assert.equal(contract.status, 'PROPOSED_NOT_EXECUTED');
assert.deepEqual(contract.backends, ['java', 'llvm', 'net', 'wasm', 'forge']);
assert.equal(contract.semantics.ingress, 'RUNTIME_ONLY');
assert.equal(contract.semantics.guest_visibility, 'PRIVATE');
assert.equal(contract.semantics.public_rpc, false);
assert.deepEqual(contract.semantics.roles, ['INIT', 'RECEIVE']);
assert.equal(contract.fixtures.length, 10);
assert.equal(new Set(contract.fixtures.map((f) => f.id)).size, contract.fixtures.length);
assert.equal(new Set(contract.fixtures.map((f) => f.path)).size, contract.fixtures.length);

const records = [];
for (const fixture of contract.fixtures) {
  assert.ok(fixture.path.startsWith('fixtures/actor-external-entrypoints/v1/'), fixture.id);
  assert.ok(!isAbsolute(fixture.path) && !fixture.path.split('/').includes('..'), fixture.id);
  const absolute = realpathSync(resolve(root, fixture.path));
  const rel = relative(root, absolute);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), fixture.id);
  const bytes = readFileSync(absolute);
  const source = bytes.toString('utf8');
  assert.ok(source.includes('namespace '), fixture.id);
  // Do not accept an inline implementation in the out-of-line declaration
  // group, or a stand-alone declaration as proof of an inline implementation.
  if (fixture.id === 'inline_lifecycle') {
    assert.ok(source.includes('define actor '), fixture.id);
  } else {
    assert.ok(source.includes('declare actor ')
      || source.includes('declare pub actor '), fixture.id);
  }
  assert.ok(source.includes('external '), fixture.id);
  assert.ok(fixture.expect === 'ACCEPT' || fixture.expect === 'REJECT', fixture.id);
  if (fixture.expect === 'REJECT') {
    assert.ok(/^ACTOR_[A-Z_]+$/.test(fixture.diagnostic), fixture.id);
    assert.equal(fixture.required_phase, 'COMPILE_REJECT', fixture.id);
    assert.ok(source.includes(fixture.diagnostic), fixture.id);
  } else {
    assert.equal(fixture.required_phase, 'GUEST_EXECUTED', fixture.id);
  }
  records.push({ id: fixture.id, expect: fixture.expect, sha256: createHash('sha256').update(bytes).digest('hex') });
}
assert.equal(records.filter((r) => r.expect === 'ACCEPT').length, 3);
assert.equal(records.filter((r) => r.expect === 'REJECT').length, 7);
process.stdout.write(JSON.stringify({ status: 'SOURCE_FREE_CONTRACT_ONLY', compiler_executed: false, backends_verified: [], fixtures: records }, null, 2) + '\n');
