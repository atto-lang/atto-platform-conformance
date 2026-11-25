// Explicit REAL guest-runner, never auto-promoted from source-only checks.
// ATTOC_BIN=/absolute/path/attoc ATTO_SOURCE_SHA=<exact compiler SHA> \
//   node tests/match-on-result-guest.mjs
// Attestation of compiler tree and source identity belongs to independent CI.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

const contract = JSON.parse(readFileSync(new URL('../contracts/match-on-result-arms-v1.json', import.meta.url), 'utf8'));
const compiler = process.env.ATTOC_BIN;
const compilerSha = process.env.ATTO_SOURCE_SHA;
assert.ok(compiler && isAbsolute(compiler), 'ATTOC_BIN must be the absolute path of a verified native compiler');
assert.match(compilerSha || '', /^[a-f0-9]{40}$/, 'exact ATTO_SOURCE_SHA is required');
assert.equal(contract.cases.length, 6, 'unexpected contract corpus change');
const build = mkdtempSync(join(tmpdir(), 'atto-match-on-result-'));
const results = [];
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');

try {
  for (const c of contract.cases) {
    const inputUrl = new URL('../' + c.path, import.meta.url);
    const bytes = readFileSync(inputUrl);
    assert.equal(gitBlob(bytes), c.blob_sha, 'fixture changed: ' + c.id);
    const output = join(build, c.id + '.wasm');
    const run = spawnSync(compiler, [inputUrl.pathname, '-o', output],
      { encoding: 'utf8', timeout: 30000 });
    if (run.error) throw run.error;
    const code = /E_[A-Z_]+/.exec(run.stderr || '')?.[0] || null;
    let status = 'failed', wasmExecuted = false, reason = null;
    if (c.expect === 'reject') {
      if (run.status !== 0 && code === c.diagnostic && !existsSync(output)) {
        status = 'passed';
        reason = 'expected_compiler_rejection_no_artifact';
      } else {
        reason = 'wrong_diagnostic_or_artifact:' + String(run.status) + ':' + code;
      }
    } else if (run.status !== 0) {
      status = code === 'E_UNSUPPORTED' || code === 'E_UNSUPPORTED_TYPE' ? 'unsupported' : 'failed';
      reason = 'compiler_diagnostic:' + code;
    } else {
      try {
        const wasm = readFileSync(output);
        assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d');
        const { instance } = await WebAssembly.instantiate(wasm, {
          atto: { print_i64() {}, print_bool() {}, print_newline() {}, print_str() {} },
        });
        assert.equal(Number(instance.exports.main()), c.exit);
        wasmExecuted = true;
        status = 'passed';
        reason = 'compiled_and_executed_wasm_guest';
      } catch (e) {
        reason = 'guest_execution_failure:' + String(e.message || e).slice(0, 160);
      }
    }
    results.push({ id: c.id, expect: c.expect, status, wasm_executed: wasmExecuted,
      diagnostic: code, reason, compiler_exit: run.status });
  }
} finally {
  rmSync(build, { recursive: true, force: true });
}
const receipt = {
  schema_version: 1, contract: contract.contract,
  compiler_sha_claim: compilerSha,
  compiler: 'explicit_external_native_compiler',
  backend: 'configured_compiler_to_node_wasm_guest',
  attestation: 'not_independently_verified_by_this_script',
  cases: results,
};
if (process.env.ATTO_RECEIPT_PATH)
  writeFileSync(process.env.ATTO_RECEIPT_PATH, JSON.stringify(receipt, null, 2) + '\n');
console.log('ATTO_MATCH_ON_RESULT_GUEST_RECEIPT=' + JSON.stringify(receipt));
if (results.some(r => r.status === 'failed')) process.exitCode = 1;
