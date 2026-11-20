#!/usr/bin/env node
// Validates self-reported evidence shape/consistency. DOES NOT authenticate runs.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractFile = path.join(root, 'contracts/orm-backend-parity-v1.json');
const hex40 = /^[0-9a-f]{40}$/;
const hex64 = /^[0-9a-f]{64}$/;
const names = ['java','llvm','wasm','cranelift','forge','net'];
const expectedCaseCount = 14;
const canonicalOracle = Object.freeze({
  catalog_valid_two_columns:'accept',
  catalog_duplicate_table_stable_id:'reject',
  catalog_duplicate_column_physical_name:'reject',
  catalog_trailing_linebreak_id:'reject',
  catalog_empty_no_drift:'accept',
  catalog_rename_preserves_stable_id:'accept',
  catalog_reordered_snapshot_no_phantom_drift:'accept',
  catalog_observed_drift_blocks_plan:'reject',
  review_duplicate_operation:'reject',
  review_conflicting_create_drop:'reject',
  review_forged_execution_approval:'reject',
  pg17_stale_attnum_ledger:'reject',
  pg17_rls_enabled:'reject',
  pg17_default_or_generated_column:'reject'
});
const canonicalModes = Object.freeze({
  java:['jit','native-aot'], llvm:['native-aot'], wasm:['wasm'],
  cranelift:['cranelift-jit','cranelift-aot'],
  forge:['forge-jit','forge-aot'], net:['native-aot']
});

export function verifyOrmReceipt(receipt, contract, contractBytes) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!contract || contract.contract !== 'oreslang.orm-backend-parity/1' ||
      Object.keys(contract.backends || {}).sort().join(',') !== [...names].sort().join(',') ||
      !Array.isArray(contract.cases) || contract.cases.length !== expectedCaseCount ||
      new Set(contract.cases.map(c => c.id)).size !== expectedCaseCount ||
      contract.cases.some(c => !c || !Object.hasOwn(canonicalOracle,c.id) ||
        c.expect !== canonicalOracle[c.id])) {
    return {ok:false,errors:['invalid or incomplete canonical ORM parity contract']};
  }
  for (const name of names) {
    if (contract.backends[name]?.repository !== `ores-truffle-oreslang/oreslang-source.${name}` ||
        JSON.stringify(contract.backends[name].modes) !== JSON.stringify(canonicalModes[name])) {
      return {ok:false,errors:['canonical backend registry mismatch: '+name]};
    }
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    return {ok:false,errors:['receipt must be an object']};
  const backend = typeof receipt.backend === 'string' && Object.hasOwn(contract.backends, receipt.backend)
    ? contract.backends[receipt.backend] : undefined;
  if (!backend) fail('unknown backend');
  if (receipt.schema !== 'oreslang.orm-backend-parity-receipt/1') fail('wrong receipt schema');
  if (backend && receipt.repository !== backend.repository) fail('repository substitution');
  if (!hex40.test(receipt.sourceCommit ?? '')) fail('invalid source SHA');
  const actualFixtureHash = createHash('sha256').update(contractBytes).digest('hex');
  if (receipt.fixtureSha256 !== actualFixtureHash) fail('fixture digest mismatch');
  const run = receipt.run;
  if (!run || run.headCommit !== receipt.sourceCommit || run.exactHead !== true)
    fail('not an exact-source-head run');
  if (!run || !Number.isSafeInteger(run.executedSteps) || run.executedSteps < 1)
    fail('zero-step or unverified workflow');
  if (!run || run.conclusion !== 'success') fail('workflow not successful');
  if (!receipt.compiler || receipt.compiler.produced !== true || receipt.compiler.hostOnly !== false ||
      !hex64.test(receipt.compiler.binarySha256 ?? '')) fail('compiler-produced guest evidence missing');
  if (!receipt.target || receipt.target.executed !== true || !hex64.test(receipt.target.artifactSha256 ?? '') ||
      !backend?.modes.includes(receipt.target.mode)) fail('target-execution evidence missing');
  const cases = contract.cases;
  if (!Array.isArray(receipt.results) || receipt.results.length !== cases.length) {
    fail('incomplete case coverage');
  } else {
    const expected = new Map(cases.map(c => [c.id,c.expect]));
    const seen = new Set();
    for (const result of receipt.results) {
      const id = result?.id;
      if (typeof id !== 'string' || seen.has(id) || !expected.has(id) || result.observed !== expected.get(id) ||
          result.executedByGuest !== true) fail('duplicate, unknown, host-only or mismatching case: '+String(id));
      seen.add(id);
    }
    if (seen.size !== cases.length) fail('incomplete unique case coverage');
  }
  return {ok:errors.length===0, errors};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('usage: verify-orm-backend-receipt.mjs <receipt.json>');
    const bytes = fs.readFileSync(contractFile);
    const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const result = verifyOrmReceipt(receipt, JSON.parse(bytes.toString('utf8')), bytes);
    if (!result.ok) {
      console.error('ORM_BACKEND_RECEIPT_REJECTED:',result.errors.join('; '));
      process.exitCode = 2;
    } else {
      console.log('ORM_BACKEND_RECEIPT_CONSISTENT_NOT_AUTHENTICATED');
    }
  } catch (_) {
    console.error('ORM_BACKEND_RECEIPT_REJECTED: invalid or unreadable input');
    process.exitCode = 2;
  }
}
