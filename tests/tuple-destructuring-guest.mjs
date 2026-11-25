// Execute all tuple target cases against a real native Atto compiler and Wasm guest.
// Usage: ATTOC_BIN=/absolute/path/attoc ATTO_SOURCE_SHA=<40-char SHA> node tests/tuple-destructuring-guest.mjs
// No cross-organization token, network access or inferred backend results.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const dirHere = resolve(fileURLToPath(new URL('.', import.meta.url)));
const registry = JSON.parse(readFileSync(resolve(dirHere, '../contracts/tuple-destructuring-v1.json'), 'utf8'));
const compiler = process.env.ATTOC_BIN;
const sourceSha = process.env.ATTO_SOURCE_SHA;
assert.ok(compiler && compiler.startsWith('/'), 'ATTOC_BIN must be an absolute executable path');
assert.match(sourceSha || '', /^[a-f0-9]{40}$/, 'exact ATTO_SOURCE_SHA is required');
assert.equal(registry.cases.length, 33, 'conformance corpus changed without runner review');
const expectedCode = new Map([
  ['tuple-const-from-runtime', 'E_CONST'],
  ['tuple-const-mut-scalar', 'E_CONST_MUT_TARGET'],
  ['tuple-arity-mismatch', 'E_ARITY'],
  ['tuple-name-duplicate', 'E_DUPLICATE'],
  ['tuple-root-name-collision', 'E_DUPLICATE'],
  ['tuple-without-binding-mode', 'E_SYNTAX'],
  ['tuple-val-reassign', 'E_IMMUTABLE'],
  ['tuple-nested-unsupported', 'E_SYNTAX'],
  ['tuple-singleton-without-comma', 'E_SYNTAX'],
  ['tuple-runtime-const-and-scalar-const-mut', 'E_CONST_MUT_TARGET'],
  ['tuple-runtime-as-const-reject', 'E_CONST'],
  ['tuple-as-val-rebind-reject', 'E_IMMUTABLE'],
  ['tuple-as-const-rebind-reject', 'E_IMMUTABLE'],
  ['tuple-explicit-unqualified-alias-reject', 'E_SYNTAX'],
]);
// Rejected object-graph cases cannot be called PASS merely because the
// scalar-only compiler rejected Tuple<Cell>; that proves no loan semantics.
const blockedObjectCases = new Set([
  'tuple-readonly-referent', 'tuple-alias-overlap',
  'tuple-let-root-active-mut-loan-rebind-reject',
]);
const temp = mkdtempSync(join(tmpdir(), 'atto-tuple-conformance-'));
const cases = [];
try {
  for (const c of registry.cases) {
    const src = join(temp, c.id + '.atto');
    const out = join(temp, c.id + '.wasm');
    writeFileSync(src, c.source);
    const result = spawnSync(compiler, [src, '-o', out], {encoding:'utf8', timeout: 30000});
    if (result.error) throw result.error;
    const code = /E_[A-Z0-9_]+/.exec(result.stderr || '')?.[0] || null;
    let status, reason, executedWasm = false;
    if (result.status === 0) {
      if (c.expect !== 'accept') {
        status = 'failed';
        reason = 'unexpected_accept';
      } else {
        try {
          const bytes = readFileSync(out);
          assert.equal(bytes.subarray(0,4).toString('hex'), '0061736d');
          const { instance } = await WebAssembly.instantiate(bytes, {
            atto: { print_i64(){} },
          });
          assert.equal(instance.exports.main(), 0n);
          executedWasm = true;
          status = 'passed';
          reason = 'compiled_and_executed_guest';
        } catch (error) {
          status = 'failed';
          reason = 'guest_failure:' + String(error.message || error).slice(0,160);
        }
      }
    } else if (result.status === 1) {
      if (blockedObjectCases.has(c.id) && (code === 'E_UNSUPPORTED_TYPE' || code === 'E_UNSUPPORTED')) {
        status = 'unsupported';
        reason = 'object_tuple_loan_model_not_implemented';
      } else if (c.expect === 'reject' && code && expectedCode.get(c.id) === code) {
        status = 'passed';
        reason = 'expected_diagnostic';
      } else if (code === 'E_UNSUPPORTED' || code === 'E_UNSUPPORTED_TYPE') {
        status = 'unsupported';
        reason = 'compiler_subset_unavailable';
      } else {
        status = 'failed';
        reason = 'unexpected_diagnostic:' + (code || String(result.stderr).slice(0,180));
      }
    } else {
      status = 'failed';
      reason = 'compiler_status:' + String(result.status) + ':' + String(result.stderr).slice(0,150);
    }
    cases.push({id:c.id, expect:c.expect, status, diagnostic:code, wasm_executed:executedWasm, reason});
  }
} finally {
  rmSync(temp, {recursive:true, force:true});
}
const counts = cases.reduce((acc, c) => (acc[c.status] = (acc[c.status]||0)+1, acc), {});
const receipt = {
  schema_version: 1,
  contract: registry.contract,
  backend: 'rust_browser_wasm',
  source_commit: sourceSha,
  compiler: 'atto-compiler-browser/attoc',
  guest: 'node_webassembly',
  summary: counts,
  cases,
};
if (process.env.ATTO_RECEIPT_PATH) {
  writeFileSync(process.env.ATTO_RECEIPT_PATH, JSON.stringify(receipt, null, 2) + '\n');
}
console.log('ATTO_TUPLE_33_RESULTS=' + JSON.stringify(receipt));
console.log('ATTO_TUPLE_33_SUMMARY=' + JSON.stringify(counts));
if (cases.some(c=>c.status === 'failed')) process.exitCode = 1;
