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
  const required = ['profile', 'attoc', 'source-repo', 'checkout-head', 'source-head', 'source-tree', 'receipt'];
  const valid = new Set([...required, 'source-original-tree', 'source-blob-lock']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || !valid.has(key.slice(2)) ||
        argv[i + 1] === undefined || argv[i + 1].startsWith('--') ||
        Object.hasOwn(args, key.slice(2))) {
      throw new Error('invalid or duplicate CLI argument ' + String(key));
    }
    args[key.slice(2)] = argv[i + 1];
  }
  if (required.some(key => !Object.hasOwn(args, key))) {
    throw new Error('explicit profile, compiler, checkout, source SHA/tree and receipt are all required');
  }
  if (Boolean(args['source-original-tree']) !== Boolean(args['source-blob-lock'])) {
    throw new Error('subset mode requires both original source tree and exact source-blob lock');
  }
  for (const name of ['checkout-head', 'source-head', 'source-tree', 'source-original-tree']) {
    if (args[name] !== undefined && !HEX40.test(args[name])) {
      throw new Error('invalid expected SHA for ' + name);
    }
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
  const checkoutTree = git(repo, ['rev-parse', 'HEAD^{tree}']);
  assert.equal(checkoutTree, params['source-tree'], 'exact checkout tree mismatch');
  // In a full-tree mirror, checkoutTree must equal the original source tree.
  // A source-blob-locked build subset is a deliberately weaker proof mode:
  // verify every compiler input blob and keep both original and checkout trees.
  let originalTree = checkoutTree;
  let provenanceMode = 'full_tree_sha_equivalent';
  let lockFileSha256 = null;
  let verifiedSourceBlobCount = null;
  if (params['source-original-tree']) {
    originalTree = params['source-original-tree'];
    provenanceMode = 'source_blob_pinned_subset_not_full_tree';
    const lockPath = realpathSync(resolve(params['source-blob-lock']));
    assert.ok(lockPath.startsWith(repo + sep), 'blob lock must belong to local checkout');
    const lockData = readFileSync(lockPath);
    lockFileSha256 = sha256(lockData);
    const lines = lockData.toString('utf8').split('\n');
    assert.ok(lines.some(line => line.startsWith('# Source ') &&
      line.endsWith('head: ' + params['source-head'])), 'blob lock is for a different source PR');
    assert.ok(lines.includes('# Original complete source tree: ' + originalTree),
      'blob lock is for a different original Git tree');
    const seenPaths = new Set();
    let count = 0;
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const columns = line.split('\t');
      assert.equal(columns.length, 2, 'malformed source blob lock entry');
      const [expectedSha, relative] = columns;
      assert.ok(HEX40.test(expectedSha) && relative && !relative.includes('..') &&
        !relative.includes('\\'), 'untrusted source lock path/SHA');
      assert.ok(!seenPaths.has(relative), 'duplicate source lock path');
      seenPaths.add(relative);
      const path = resolve(repo, relative);
      assert.ok(path.startsWith(repo + sep), 'source lock path escaped checkout');
      assert.equal(gitBlobSha(readFileSync(path)), expectedSha,
        'source blob does not match original source: ' + relative);
      count++;
    }
    assert.ok(count >= 35, 'source-blob-pinned subset missing compiler inputs');
    verifiedSourceBlobCount = count;
  }
  // Original source PR head is a separate provenance input.
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
      compiler_source_tree_sha: originalTree,
      compiler_checkout_tree_sha: checkoutTree,
      compiler_provenance_mode: provenanceMode,
      verified_source_blob_count: verifiedSourceBlobCount,
      source_blob_lock_sha256: lockFileSha256,
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
