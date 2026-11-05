#!/usr/bin/env node
// Source-only Atto core/std ledger and untrusted receipt *shape* gate.
// No success here attests compiler provenance, backend execution, or parity.
import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CONTRACT = fileURLToPath(new URL('../contracts/atto-core-stdlib-evidence-v1.json', import.meta.url));
export const PINNED = Object.freeze({
  numeric: '5ced991f1d49b3c2a60fdd72b9003c0a4d18cd72',
  core: 'd2cd9b8e0cd3e3bb3ee6a5f9cebf9ab3312c44f4',
  assert: 'dd5e64e09e9a4b2606e4a685a60ad0bc00f45aea',
  compute: 'b8e11db5f8701fbceb1e2afd39cad06662d0e8be',
  trace: 'f4ff35b10683880e42e3151b34fc140d52704dba',
  db_pool: '95396a3cee45a18d7d2707224ef2f23957ba8e46',
  http_wire: '21169e5c262cd79997637c97d448e05a835e2e44',
  actor_persistence: 'fec71c8ae3e9c0e8828b712a1a9d78a26948e0ea',
});
export const BACKENDS = Object.freeze(['java','llvm','wasm','forge','net']);
const SHA40 = /^[0-9a-f]{40}$/;
const HEX_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[1-9][0-9]*$/;

export function inspectContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw Error('contract object required');
  if (contract.schema !== 'attolang.core-stdlib-evidence.v1' ||
      contract.status !== 'SOURCE_ONLY_NOT_EXECUTED') throw Error('source-only contract identity required');
  if (JSON.stringify(contract.required_backends) !== JSON.stringify(BACKENDS)) throw Error('backend inventory changed');
  if (!Array.isArray(contract.modules) || contract.modules.length !== 8) throw Error('module count changed');
  const seen = new Set();
  for (const row of contract.modules) {
    if (!row || typeof row !== 'object' || !Object.hasOwn(PINNED, row.name) ||
        seen.has(row.name) || row.git_blob_sha !== PINNED[row.name] ||
        row.tier !== (row.name === 'numeric' ? 'core' : 'std'))
      throw Error('invalid, duplicated, or unpinned library module');
    seen.add(row.name);
  }
  if (seen.size !== 8) throw Error('missing module');
  if (!contract.policy || !Object.values(contract.policy).every(v => v === true) ||
      Object.keys(contract.policy).length !== 4) throw Error('non-fail-closed policy');
  return { modules: 8, backends: BACKENDS.length, status: 'SOURCE_ONLY_NOT_EXECUTED' };
}

export function inspectReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      receipt.schema !== 'attolang.core-stdlib-receipt.v1' ||
      receipt.parity_verified !== false ||
      !Array.isArray(receipt.evaluations)) throw Error('untrusted candidate receipt required');
  const pairs = new Set();
  for (const row of receipt.evaluations) {
    if (!row || typeof row !== 'object' || !Object.hasOwn(PINNED, row.module) ||
        !BACKENDS.includes(row.backend) || row.git_blob_sha !== PINNED[row.module])
      throw Error('unknown backend, module, or source identity');
    const key = row.module + '/' + row.backend;
    if (pairs.has(key)) throw Error('duplicate backend/module evidence');
    pairs.add(key);
    if (!['NOT_EXECUTED', 'EXECUTED_CANDIDATE'].includes(row.status))
      throw Error('unsupported evidence status');
    if (!Number.isSafeInteger(row.steps) || row.steps < 0 ||
        !Number.isSafeInteger(row.guest_executions) || row.guest_executions < 0 ||
        !Number.isSafeInteger(row.negative_cases) || row.negative_cases < 0)
      throw Error('invalid execution counters');
    if (row.status === 'NOT_EXECUTED') {
      if (row.steps !== 0 || row.guest_executions !== 0 || row.negative_cases !== 0 ||
          row.run_url !== null || row.compiler_head !== null)
        throw Error('fabricated execution in NOT_EXECUTED record');
    } else if (row.steps < 2 || row.guest_executions < 1 || row.negative_cases < 1 ||
               typeof row.compiler_head !== 'string' || !SHA40.test(row.compiler_head) ||
               typeof row.run_url !== 'string' || !HEX_URL.test(row.run_url)) {
      throw Error('incomplete candidate compiler evidence; cannot promote');
    }
  }
  if (pairs.size !== 8 * BACKENDS.length) throw Error('incomplete five-backend coverage');
  // A structurally valid receipt cannot authenticate GitHub job evidence, code
  // identity, compiler binary attestation, or the *truth* of execution claims.
  return { status: 'CANDIDATE_SCHEMA_ONLY_NOT_VERIFIED', count: pairs.size };
}

function readBoundedJson(file) {
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 ||
      stats.size > 2 * 1024 * 1024) throw Error('unsafe receipt or contract file');
  return JSON.parse(readFileSync(file, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const contract = inspectContract(readBoundedJson(CONTRACT));
    if (process.argv.length > 3) throw Error('usage: node bin/verify-atto-stdlib-evidence.mjs [receipt.json]');
    const report = process.argv[2] ? inspectReceipt(readBoundedJson(path.resolve(process.argv[2]))) : contract;
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error('FAIL ATTO_STDLIB_EVIDENCE:', error.message);
    process.exitCode = 1;
  }
}
