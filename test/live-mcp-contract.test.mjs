import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify } from '../bin/verify-live-mcp-contract.mjs';

const original = JSON.parse(readFileSync(
  new URL('../contracts/live-devtools-mcp-v1.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(original);

test('requires evidence for each promoted host case while keeping runtime cases unexecuted', () => {
  assert.deepEqual(verify(original), { total: 12, executed: 3 });
  assert.ok(original.cases.filter(c => c.status !== 'NOT_EXECUTED')
      .every(c => c.tier === 'host-protocol'));
});

test('rejects missing and duplicate case identifiers', () => {
  const missing = clone();
  missing.cases.pop();
  assert.throws(() => verify(missing), /cases/);
  const duplicate = clone();
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => verify(duplicate), /cases/);
});

test('rejects execution promotion without evidence', () => {
  const host = clone();
  host.cases[0].status = 'HOST_PROTOCOL_TESTED';
  assert.throws(() => verify(host), /evidence/);
  const parity = clone();
  parity.cases[11].status = 'BACKEND_PARITY_VERIFIED';
  assert.throws(() => verify(parity), /evidence/);
});

test('rejects wrong protocol, backend list and unknown states', () => {
  const wrongProtocol = clone();
  wrongProtocol.protocol = '2025-11-25';
  assert.throws(() => verify(wrongProtocol), /version/);
  const missingBackend = clone();
  missingBackend.backends.pop();
  assert.throws(() => verify(missingBackend), /backend/);
  const badState = clone();
  badState.cases[0].status = 'PASS';
  assert.throws(() => verify(badState), /status/);
});
