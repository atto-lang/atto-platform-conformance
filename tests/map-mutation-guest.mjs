// Real compiled-guest conformance runner. This DOES NOT use host Maps as an oracle.
// Usage: ATTOC_BIN=/absolute/path/attoc ATTO_SOURCE_SHA=<40-hex> node tests/map-mutation-guest.mjs
// No action without an explicit compiler; no unrun case can be called PASS.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const registry = JSON.parse(readFileSync(join(root, 'contracts/map-mutation-lookup-v1.json'), 'utf8'));
assert.equal(registry.cases.length, 29, 'review runner against updated registry');
const compiler = process.env.ATTOC_BIN;
const sourceSha = process.env.ATTO_SOURCE_SHA;
assert.ok(compiler && compiler.startsWith('/'), 'ATTOC_BIN must be an absolute native compiler path');
assert.match(sourceSha || '', /^[a-f0-9]{40}$/, 'ATTO_SOURCE_SHA must identify the exact compiled source commit');
const temp = mkdtempSync(join(tmpdir(), 'atto-map-guest-'));
const results = [];
try {
  for (const c of registry.cases) {
    const input = join(temp, c.id + '.atto');
    const output = join(temp, c.id + '.wasm');
    writeFileSync(input, c.source, 'utf8');
    const run = spawnSync(compiler, [input, '-o', output], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 1 << 20,
    });
    const diagnostic = /E_[A-Z0-9_]+/.exec((run.stderr || '') + '\n' + (run.stdout || ''))?.[0] || null;
    const result = {id:c.id, expect:c.expect, status:'failed', diagnostic, wasm_executed:false, reason:null};
    if (run.error) {
      result.reason = 'compiler_error:' + String(run.error.message).slice(0, 200);
    } else if (run.status === 0 && c.expect === 'reject') {
      result.reason = 'unexpected_compilation';
    } else if (run.status === 0 && c.expect === 'accept') {
      try {
        assert.ok(existsSync(output), 'success without guest artifact');
        const bytes = readFileSync(output);
        assert.ok(WebAssembly.validate(bytes), 'emitted bytes are not a valid Wasm module');
        const mod = new WebAssembly.Module(bytes);
        const imports = WebAssembly.Module.imports(mod);
        assert.ok(imports.every(i => i.module === 'atto' && i.name === 'print_i64'),
          'unexpected guest host imports');
        const instance = new WebAssembly.Instance(mod, {atto:{print_i64(){}}});
        assert.equal(typeof instance.exports.main, 'function', 'missing main export');
        assert.equal(BigInt(instance.exports.main()), BigInt(c.expected_exit), 'wrong exit value');
        if (instance.exports.panic_code) {
          assert.equal(Number(instance.exports.panic_code.value), 0, 'guest reported panic');
        }
        result.status = 'passed';
        result.reason = 'compiled_and_executed_guest';
        result.wasm_executed = true;
      } catch (error) {
        result.reason = 'guest_failure:' + String(error.message || error).slice(0, 200);
      }
    } else if (run.status !== 0 && c.expect === 'reject') {
      if (existsSync(output)) {
        result.reason = 'rejected_source_emitted_artifact';
      } else if (diagnostic === c.expected_error) {
        result.status = 'passed';
        result.reason = 'expected_diagnostic_no_guest_artifact';
      } else if (diagnostic === 'E_UNSUPPORTED' || diagnostic === 'E_UNSUPPORTED_TYPE') {
        result.status = 'unsupported';
        result.reason = 'compiler_subset_not_implemented';
      } else {
        result.reason = 'unexpected_diagnostic:' + (diagnostic || 'none');
      }
    } else if (diagnostic === 'E_UNSUPPORTED' || diagnostic === 'E_UNSUPPORTED_TYPE') {
      result.status = 'unsupported';
      result.reason = 'compiler_subset_not_implemented';
    } else {
      result.reason = 'compiler_exit:' + String(run.status) + ':' +
        String(run.stderr || '').slice(0, 160);
    }
    results.push(result);
  }
} finally {
  rmSync(temp, {recursive:true, force:true});
}
const summary = results.reduce((sum, r) => (sum[r.status] = (sum[r.status] || 0) + 1, sum), {});
const receipt = {
  schema_version:1, contract: registry.contract, backend:'rust_browser_wasm',
  source_commit: sourceSha, compiler:'attoc', guest:'node_webassembly',
  summary, cases:results,
};
if (process.env.ATTO_RECEIPT_PATH) writeFileSync(process.env.ATTO_RECEIPT_PATH,
  JSON.stringify(receipt, null, 2) + '\n');
console.log('ATTO_MAP_15_RESULTS=' + JSON.stringify(receipt));
if (results.some(r => r.status !== 'passed')) process.exitCode = 1;
