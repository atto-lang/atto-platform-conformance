#!/usr/bin/env node
// Portable first executor for the Rust -> Wasm full-AOT *source lowering* subset.
// Does not certify LLVM/Graal/.NET/Forge/native-Wasmtime AOT, or disabled engine JIT.
// Usage:
// node bin/run-full-aot-executable-gates.mjs \
//   --profile rust-source-wasm --attoc /repo/target/release/attoc \
//   --source-repo /repo --checkout-head <git SHA> \
//   --source-head <original PR git SHA> --source-tree <exact git tree SHA> \
//   --receipt /tmp/atto-aot-guest-receipt.json
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha, validateContract } from './full-aot-execution-model.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'contracts/full-aot-executable-gates-v1.json'), 'utf8'));
const HEX40 = /^[0-9a-f]{40}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  const valid = new Set(['profile', 'attoc', 'source-repo', 'checkout-head', 'source-head', 'source-tree', 'receipt']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || !valid.has(key.slice(2)) ||
        argv[i + 1] === undefined || argv[i + 1].startsWith('--') ||
        Object.hasOwn(args, key.slice(2))) {
      throw new Error('invalid or duplicate CLI argument ' + String(key));
    }
    args[key.slice(2)] = argv[i + 1];
  }
  if (Object.keys(args).length !== valid.size ||
      [...valid].some(key => !Object.hasOwn(args, key))) {
    throw new Error('explicit profile, compiler, checkout, source SHA/tree and receipt are all required');
  }
  for (const name of ['checkout-head', 'source-head', 'source-tree']) {
    if (!HEX40.test(args[name])) throw new Error('invalid expected SHA for ' + name);
  }
  if (args.profile !== 'rust-source-wasm') {
    throw new Error('AOT backend has no executable adapter yet: ' + args.profile);
  }
  return args;
}

function run(binary, argv, opts = {}) {
  const p = spawnSync(binary, argv, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 2 << 20, ...opts,
  });
  if (p.error || p.status === null) throw new Error('could not execute ' + binary + ': ' + (p.error || p.signal));
  return p;
}

function git(dir, args) {
  const p = run('git', ['-C', dir, ...args]);
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim();
}

function requireExactFixture(c) {
  const path = resolve(root, c.fixture);
  assert.ok(path.startsWith(root + sep), 'fixture path escaped checked-in repo');
  const contents = readFileSync(path);
  assert.equal(gitBlobSha(contents), c.git_blob_sha, c.id + ': fixture Git blob does not match plan');
  return path;
}

function compiledWasmCase(attoc, c, source, temp) {
  const first = join(temp, c.id + '.wasm');
  const second = join(temp, c.id + '-again.wasm');
  const r = run(attoc, [source, '-o', first]);
  assert.equal(r.status, 0, c.id + ': real compiler failed: ' + r.stderr);
  assert.equal(r.stdout, '', c.id + ': -o must not emit stdout');
  assert.ok(existsSync(first), c.id + ': missing compiled artifact');
  const code = readFileSync(first);
  assert.ok(WebAssembly.validate(code), c.id + ': artifact is not executable Wasm');
  const mod = new WebAssembly.Module(code);
  assert.deepEqual(WebAssembly.Module.imports(mod), [], c.id + ': forbidden guest import');
  const exports = WebAssembly.Module.exports(mod).map(e => e.name);
  assert.ok(exports.includes('main') && exports.includes('panic_code'), c.id + ': invalid guest ABI');
  const instance = new WebAssembly.Instance(mod, {});
  assert.equal(instance.exports.main(), BigInt(c.expected_main_i64), c.id + ': executed guest result mismatch');
  assert.equal(instance.exports.panic_code.value, 0, c.id + ': guest panicked');
  const repeat = run(attoc, [source, '-o', second]);
  assert.equal(repeat.status, 0, c.id + ': repeat compiler failure: ' + repeat.stderr);
  assert.deepEqual(readFileSync(second), code, c.id + ': codegen differs for same source');
  return { id: c.id, result: 'passed', guest_executed: true,
    source_blob_sha: c.git_blob_sha, artifact_sha256: sha256(code),
    main_i64: c.expected_main_i64, import_count: 0, deterministic: true };
}

function rejectedCase(attoc, c, source, temp) {
  let firstCode;
  for (let attempt = 0; attempt < 2; attempt++) {
    const artifact = join(temp, c.id + '-attempt-' + attempt + '.wasm');
    const result = run(attoc, [source, '-o', artifact]);
    assert.equal(result.status, 1, c.id + ': unsupported source unexpectedly admitted');
    assert.equal(result.stdout, '', c.id + ': rejected compilation emitted bytes to stdout');
    assert.ok(!existsSync(artifact), c.id + ': compiler left an artifact after rejection');
    const match = result.stderr.match(/\bE_[A-Z0-9_]+\b/);
    assert.ok(match, c.id + ': no stable diagnostic code: ' + result.stderr);
    if (firstCode) assert.equal(match[0], firstCode, c.id + ': nondeterministic rejection');
    firstCode = match[0];
  }
  return { id: c.id, result: 'passed', guest_executed: false,
    source_blob_sha: c.git_blob_sha, no_artifact: true, diagnostic_code: firstCode };
}

function main() {
  const cases = validateContract(manifest);
  const params = parseArgs(process.argv.slice(2));
  const repo = realpathSync(resolve(params['source-repo']));
  const attoc = realpathSync(resolve(params.attoc));
  const receipt = resolve(params.receipt);
  assert.ok(attoc.startsWith(repo + sep), 'compiler executable must be inside exact checkout');
  assert.ok(!existsSync(receipt), 'refuse to overwrite an existing evidence receipt');
  assert.equal(git(repo, ['rev-parse', 'HEAD']), params['checkout-head'], 'checkout SHA mismatch');
  assert.equal(git(repo, ['rev-parse', 'HEAD^{tree}']), params['source-tree'], 'exact source tree mismatch');
  // Original source PR head is provenance input, separately verified via GitHub.
  // It need not equal the temporary carrier's commit SHA when trees match.
  const compilerHash = sha256(readFileSync(attoc));
  const temp = mkdtempSync(join(tmpdir(), 'atto-full-aot-exec-'));
  const results = [];
  try {
    for (const c of cases) {
      const src = requireExactFixture(c);
      results.push(c.kind === 'compiled_guest'
        ? compiledWasmCase(attoc, c, src, temp)
        : rejectedCase(attoc, c, src, temp));
    }
    const output = {
      schema: 'atto.full-aot-execution-receipt.v1',
      profile: params.profile,
      status: 'executed_guest_smokes_not_native_aot_certified',
      compiler_source_head_sha: params['source-head'],
      compiler_checkout_head_sha: params['checkout-head'],
      compiler_source_tree_sha: params['source-tree'],
      compiler_executable_sha256: compilerHash,
      actual_invocation: 'native attoc -o <guest.wasm>; WebAssembly.Instance(...).exports.main()',
      runtime_engine_jit_policy: 'engine-dependent',
      native_aot_proven: false,
      independent_provenance_check_required: true,
      guest_executed: true,
      cases: results,
    };
    writeFileSync(receipt, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ status: output.status, cases: results.length, receipt }) + '\n');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
try {
  main();
} catch (e) {
  console.error('AOT executable gate FAILED (no pass receipt): ' + (e.stack || e));
  process.exitCode = 1;
}
