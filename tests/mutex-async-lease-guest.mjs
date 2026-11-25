// Real Atto compiler -> WebAssembly guest conformance runner.
// Usage:
//   ATTOC_BIN=/absolute/path/attoc ATTO_SOURCE_SHA=<40-hex> \
//     node tests/mutex-async-lease-guest.mjs
//
// This runner NEVER counts source-only data or host mock models as a guest PASS.
// It tests compilation and ordinary guest outputs, not nonparking contention.
// Browser/scheduler/tenant runtime probes are separate and remain NOT_EXECUTED.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/mutex-async-lease-v1.json'), 'utf8'));
const compiler = process.env.ATTOC_BIN;
const sha = process.env.ATTO_SOURCE_SHA;
assert.ok(compiler && isAbsolute(compiler) && existsSync(compiler), 'ATTOC_BIN must be an existing absolute executable');
assert.match(sha || '', /^[a-f0-9]{40}$/, 'ATTO_SOURCE_SHA must identify exact compiler commit');
assert.equal(contract.schema, 'atto.conformance.mutex-async-lease.v1');
assert.equal(contract.status, 'TARGET_SOURCE_ONLY_NOT_EXECUTED');
const cases = contract.cases.filter(x => x.source);
assert.equal(new Set(cases.map(x => x.id)).size, cases.length, 'fixture IDs must be unique');
assert.ok(cases.some(x => x.kind === 'compiled_guest_positive'));
assert.ok(cases.some(x => x.kind === 'compile_negative'));

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = mkdtempSync(join(tmpdir(), 'atto-mutex-guest-'));
const results = [];

function guest_run(wasm) {
  assert.ok(wasm.length >= 8 && wasm.length <= 16 * 1024 * 1024);
  assert.ok(WebAssembly.validate(wasm), 'compiler output is not valid WebAssembly');
  const module = new WebAssembly.Module(wasm);
  // This runner only evaluates fully synchronous guest exports. Any imported
  // scheduler, mutex or worker ABI must use the separate instrumented browser
  // continuation harness, never a stub that pretends acquisition succeeds.
  const allowed = new Set(['print_i64','print_bool','print_newline','print_str']);
  for (const i of WebAssembly.Module.imports(module)) {
    assert.equal(i.module, 'atto', 'guest imports unexpected module ' + i.module);
    assert.ok(allowed.has(i.name), 'guest needs real async/IO import: ' + i.name);
    assert.equal(i.kind, 'function');
  }
  let output = '';
  const decoder = new TextDecoder('utf-8',{fatal:true});
  // Wasm export memory is visible only after instantiation; the callback must
  // not read a guest pointer before that instance exists.
  let instance;
  const host = { atto: {
    print_i64(value) { output += value.toString(); },
    print_bool(value) { output += value ? 'true' : 'false'; },
    print_newline() { output += '\n'; },
    print_str(offset, length) {
      assert.ok(instance?.exports.memory instanceof WebAssembly.Memory);
      assert.ok(Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length >= 0);
      const mem = new Uint8Array(instance.exports.memory.buffer);
      assert.ok(offset <= mem.byteLength && length <= mem.byteLength - offset, 'invalid guest string span');
      output += decoder.decode(mem.subarray(offset, offset + length));
    }
  }};
  instance = new WebAssembly.Instance(module, host);
  assert.equal(typeof instance.exports.main, 'function', 'missing guest main()');
  const result = instance.exports.main();
  assert.equal(typeof result, 'bigint', 'guest main must return i64');
  if ('panic_code' in instance.exports) {
    assert.equal(instance.exports.panic_code.value, 0, 'guest panic was raised');
  }
  return { exit: Number(result), stdout: output };
}

try {
  for (const c of cases) {
    const src = resolve(root,contract.fixtures_dir,c.source);
    assert.ok(src.startsWith(resolve(root,contract.fixtures_dir) + '/'), 'fixture path traversal');
    const source = readFileSync(src);
    assert.ok(source.length > 0 && source.length < 65536);
    const out = join(temp, c.id + '.wasm');
    const path = join(temp, c.id + '.atto');
    writeFileSync(path, source);
    const ran = spawnSync(compiler, [path, '-o', out], {
      encoding:'utf8', timeout:45000, maxBuffer:256*1024
    });
    if (ran.error) throw ran.error;
    const error_code = /\bE_[A-Z0-9_]+\b/.exec(ran.stderr || '')?.[0] || null;
    const artifact_exists = existsSync(out) && statSync(out).size > 0;
    let status = 'FAIL', reason = '';
    let guest = null, artifact_sha256 = null;
    if (c.kind === 'compile_negative') {
      if (ran.status !== 0 && !artifact_exists && error_code === c.expected_diagnostic) {
        status = 'PASS';
        reason = 'compiler_rejected_with_exact_diagnostic_and_no_guest_artifact';
      } else {
        reason = 'negative_rejection_mismatch:' + JSON.stringify({status:ran.status,error_code,artifact_exists});
      }
    } else if (ran.status !== 0) {
      reason = 'positive_not_compiled:' + JSON.stringify({status:ran.status,error_code});
    } else if (!artifact_exists) {
      reason = 'compiler_succeeded_without_guest_artifact';
    } else {
      const bytes = readFileSync(out);
      artifact_sha256 = sha256(bytes);
      try {
        guest = guest_run(bytes);
        assert.equal(guest.exit, c.expected_exit, 'main result differs from exact fixture');
        if ('expected_stdout' in c) assert.equal(guest.stdout, c.expected_stdout);
        if ('expected_runtime_suspensions' in c) {
          // No synchronous Node guest runner can measure this with proof.
          status = 'UNVERIFIED_SCHEDULER';
          reason = 'guest_output_observed_but_required_scheduler_trace_absent';
        } else {
          status = 'PASS';
          reason = 'real_compiler_emitted_and_executed_guest';
        }
      } catch (e) {
        reason = 'guest_execution_failed:' + String(e.message || e).slice(0,160);
      }
    }
    results.push({id:c.id,source_sha256:sha256(source),status,reason,
      compiler_status:ran.status,error_code,artifact_exists,artifact_sha256,guest});
  }
} finally {
  rmSync(temp,{recursive:true,force:true});
}
const summary = results.reduce((s,r)=>(s[r.status]=(s[r.status]||0)+1,s),{});
const receipt = {
  schema:'atto.mutex-async-lease.compiled-guest-receipt.v1',
  contract:contract.schema,
  compiler:'attoc',
  compiler_commit:sha,
  runtime:'node_core_webassembly_sync_only',
  note:'Async scheduler, cancellation and TenantVM runtime probes never pass through this runner',
  results,summary,
};
if(process.env.ATTO_RECEIPT_PATH)writeFileSync(process.env.ATTO_RECEIPT_PATH,
  JSON.stringify(receipt,null,2) + '\n');
console.log('ATTO_MUTEX_GUEST_RESULTS=' + JSON.stringify(receipt));
if(results.some(x=>x.status!=='PASS'))process.exitCode=1;
