#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
  return value;
}

export async function loadAsyncIoContract() {
  const url = new URL('../contracts/async-io-v1.json', import.meta.url);
  const raw = await readFile(url, 'utf8');
  const contract = JSON.parse(raw);
  if (contract.schema !== 'oreslang.async-io/1') {
    throw new Error('unsupported async-I/O contract schema');
  }
  return contract;
}

export function verifyAsyncIoReceipt(receipt, contract) {
  requireObject(receipt, 'receipt');
  requireObject(contract, 'contract');

  if (receipt.schema !== contract.receipt.schema) {
    throw new Error('receipt schema mismatch');
  }
  if (!contract.backends.includes(receipt.backend)) {
    throw new Error('unknown backend ' + String(receipt.backend));
  }
  if (!contract.receipt.modes.includes(receipt.mode)) {
    throw new Error('invalid conformance mode');
  }
  if (!SHA40.test(receipt.source_commit_sha ?? '')) {
    throw new Error('source_commit_sha must be 40 lowercase hex digits');
  }
  if (!SHA40.test(receipt.source_tree_sha ?? '')) {
    throw new Error('source_tree_sha must be 40 lowercase hex digits');
  }
  if (receipt.exact_tree_verified !== true) {
    throw new Error('exact-tree verification is required');
  }
  if (!Number.isSafeInteger(receipt.executed_steps) || receipt.executed_steps < 1) {
    throw new Error('at least one real CI/test step must execute');
  }
  if (receipt.runner_admission_only !== false) {
    throw new Error('runner-admission-only evidence is not executable conformance evidence');
  }

  const claims = requireObject(receipt.claims, 'claims');
  for (const flag of ['provider_parity', 'cross_backend_parity']) {
    if (typeof claims[flag] !== 'boolean') {
      throw new Error('claims.' + flag + ' must be an explicit boolean');
    }
  }
  if (claims.cross_backend_parity === true) {
    throw new Error('a single-backend receipt cannot claim cross-backend parity');
  }

  const cases = requireObject(receipt.cases, 'cases');
  const required = receipt.mode === 'provider'
    ? contract.providerRequiredCases
    : contract.failClosedRequiredCases;

  for (const id of required) {
    const result = requireObject(cases[id], 'case ' + id);
    if (result.status !== 'pass') {
      throw new Error('required case did not pass: ' + id);
    }
  }

  if (receipt.mode === 'provider') {
    if (!contract.allowedProviderKinds.includes(receipt.provider_kind)) {
      throw new Error('provider_kind is not an approved nonblocking provider');
    }
    if (contract.forbiddenProviderKinds.includes(receipt.provider_kind)) {
      throw new Error('blocking provider kind is forbidden');
    }
  } else {
    if (receipt.provider_kind !== undefined
        && receipt.provider_kind !== null
        && receipt.provider_kind !== 'none') {
      throw new Error('fail-closed receipt must not present an active provider');
    }
    if (claims.provider_parity === true) {
      throw new Error('fail-closed backend cannot claim provider parity');
    }
  }

  if (receipt.worker_pool_blocking_fallback !== false) {
    throw new Error('worker-pool blocking fallback is forbidden');
  }
  if (receipt.per_operation_blocking_thread !== false) {
    throw new Error('per-operation blocking thread is forbidden');
  }
  if (receipt.busy_polling !== false) {
    throw new Error('busy polling is forbidden');
  }

  return {
    classification: 'ASYNC_IO_RECORD_CONSISTENT_UNATTESTED',
    backend: receipt.backend,
    mode: receipt.mode,
    source_commit_sha: receipt.source_commit_sha,
    source_tree_sha: receipt.source_tree_sha,
    executed_steps: receipt.executed_steps
  };
}

async function main() {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) {
    throw new Error('usage: verify-async-io-receipt.mjs RECEIPT.json');
  }
  const [contract, raw] = await Promise.all([
    loadAsyncIoContract(),
    readFile(input, 'utf8')
  ]);
  if (raw.length > 1024 * 1024) throw new Error('receipt exceeds 1 MiB');
  const verified = verifyAsyncIoReceipt(JSON.parse(raw), contract);
  process.stdout.write(
    verified.classification + ' '
      + verified.backend + ' '
      + verified.mode + ' '
      + verified.source_tree_sha + '\n'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('async-I/O receipt rejected: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
