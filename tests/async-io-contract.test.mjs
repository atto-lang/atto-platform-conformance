import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadAsyncIoContract,
  verifyAsyncIoReceipt
} from '../bin/verify-async-io-receipt.mjs';

function passingCases(ids) {
  return Object.fromEntries(ids.map(id => [id, {status: 'pass'}]));
}

function providerReceipt(contract) {
  return {
    schema: 'oreslang.async-io.receipt/1',
    backend: 'llvm',
    mode: 'provider',
    source_commit_sha: '1'.repeat(40),
    source_tree_sha: '2'.repeat(40),
    exact_tree_verified: true,
    executed_steps: 7,
    runner_admission_only: false,
    provider_kind: 'epoll',
    worker_pool_blocking_fallback: false,
    per_operation_blocking_thread: false,
    busy_polling: false,
    claims: {
      provider_parity: false,
      cross_backend_parity: false
    },
    cases: passingCases(contract.providerRequiredCases)
  };
}

function failClosedReceipt(contract) {
  return {
    schema: 'oreslang.async-io.receipt/1',
    backend: 'wasm',
    mode: 'fail-closed',
    source_commit_sha: '3'.repeat(40),
    source_tree_sha: '4'.repeat(40),
    exact_tree_verified: true,
    executed_steps: 3,
    runner_admission_only: false,
    provider_kind: 'none',
    worker_pool_blocking_fallback: false,
    per_operation_blocking_thread: false,
    busy_polling: false,
    claims: {
      provider_parity: false,
      cross_backend_parity: false
    },
    cases: passingCases(contract.failClosedRequiredCases)
  };
}

test('policy flags cannot be omitted, null, or truthy strings', async () => {
  const contract = await loadAsyncIoContract();
  for (const flag of ['runner_admission_only', 'worker_pool_blocking_fallback',
    'per_operation_blocking_thread', 'busy_polling']) {
    for (const invalid of [undefined, null, 'false', 'true', 0, 1, true]) {
      const receipt = providerReceipt(contract);
      if (invalid === undefined) delete receipt[flag];
      else receipt[flag] = invalid;
      assert.throws(() => verifyAsyncIoReceipt(receipt, contract), flag);
    }
  }
  for (const flag of ['provider_parity', 'cross_backend_parity']) {
    for (const invalid of [undefined, null, 'false', 'true', 0, 1]) {
      const receipt = providerReceipt(contract);
      if (invalid === undefined) delete receipt.claims[flag];
      else receipt.claims[flag] = invalid;
      assert.throws(() => verifyAsyncIoReceipt(receipt, contract), /explicit boolean/);
    }
  }
});

test('offline consistency is never authenticated conformance', async () => {
  const contract = await loadAsyncIoContract();
  assert.equal(verifyAsyncIoReceipt(providerReceipt(contract), contract).classification,
    'ASYNC_IO_RECORD_CONSISTENT_UNATTESTED');
});

test('provider receipt requires the complete nonblocking lifecycle matrix', async () => {
  const contract = await loadAsyncIoContract();
  const receipt = providerReceipt(contract);
  assert.doesNotThrow(() => verifyAsyncIoReceipt(receipt, contract));

  delete receipt.cases['physical-retirement-before-actor-done'];
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /physical-retirement-before-actor-done/
  );
});

test('fail-closed backend is valid evidence but cannot claim provider parity', async () => {
  const contract = await loadAsyncIoContract();
  const receipt = failClosedReceipt(contract);
  assert.doesNotThrow(() => verifyAsyncIoReceipt(receipt, contract));

  receipt.claims.provider_parity = true;
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /cannot claim provider parity/
  );
});

test('zero-step and runner-admission-only workflows are never conformance evidence', async () => {
  const contract = await loadAsyncIoContract();
  const receipt = providerReceipt(contract);
  receipt.executed_steps = 0;
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /at least one real CI\/test step/
  );

  receipt.executed_steps = 1;
  receipt.runner_admission_only = true;
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /runner-admission-only/
  );
});

test('worker-backed blocking I/O cannot be relabeled as async', async () => {
  const contract = await loadAsyncIoContract();
  const receipt = providerReceipt(contract);
  receipt.provider_kind = 'worker-pool-blocking';
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /approved nonblocking provider/
  );

  receipt.provider_kind = 'epoll';
  receipt.worker_pool_blocking_fallback = true;
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /worker-pool blocking fallback/
  );
});

test('receipt requires exact source commit and tree provenance', async () => {
  const contract = await loadAsyncIoContract();
  const receipt = providerReceipt(contract);
  receipt.exact_tree_verified = false;
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /exact-tree verification/
  );

  receipt.exact_tree_verified = true;
  receipt.source_tree_sha = 'not-a-sha';
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /source_tree_sha/
  );
});

test('single-backend receipt cannot promote cross-backend parity', async () => {
  const contract = await loadAsyncIoContract();
  const receipt = providerReceipt(contract);
  receipt.claims.cross_backend_parity = true;
  assert.throws(
    () => verifyAsyncIoReceipt(receipt, contract),
    /cannot claim cross-backend parity/
  );
});
