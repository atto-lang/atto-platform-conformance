#!/usr/bin/env node
/**
 * Compiler-backed Future v2 gate for the Java native CLI. No mock or synthetic
 * acceptance, and no modification of the still-PENDING conformance manifest.
 * Operator-provided provenance is NOT an independent build attestation.
 *
 * node tools/run-future-chaining-v2-guests.mjs --compiler /abs/oreslang-compiler --provenance /abs/build-provenance.json
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants, openSync, fstatSync, readSync, closeSync, mkdtempSync,
         writeFileSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../fixtures/future-chaining/v2/', import.meta.url));
const expected = new Map([
  ['flat-map-one-layer', ['positive', '42', 'db7006ae3b564c8ebcb80680ac113a72c065f507']],
  ['flat-map-preserves-deeper-nesting', ['positive', '84', '2cf2bff1a2f516fde2b8f85272bacf52de180d55']],
  ['map-preserves-nested', ['positive', '42', 'c62fbae210bc2c501cb1b30a6887219086f78391']],
  ['flatten-one-layer', ['positive', '42', 'ce032c78f574d0d61f0496a719d881af63dc580c']],
  ['reject-flat-map-scalar', ['compile_reject', 'FUTURE_CALLBACK_NOT_FUTURE', '5f9f51d91f32bb1a7154f7bc1d1a4ece1015d94c']],
  ['reject-flat-map-deeper-nesting', ['compile_reject', 'WRAPPER_LAYER_MISMATCH', '979ea56ccb11c8e90ca2dcc7029ff081364eb8e4']],
  ['reject-implicit-map-flatten', ['compile_reject', 'WRAPPER_LAYER_MISMATCH', '8a2f07c2453763ed585462556cf1c4c5330774fd']],
  ['reject-one-await-flatten', ['compile_reject', 'WRAPPER_LAYER_MISMATCH', 'e99a49f2b30964cbdbba4cb6250859fbc1180fd6']]
]);
const hash = (algo, data) => createHash(algo).update(data).digest('hex');
const blobSha1 = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const SHA1 = /^[0-9a-f]{40}$/, SHA256 = /^[0-9a-f]{64}$/;

function readRegular(p, cap) {
  assert.ok(Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK));
  const fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.size > 0 && stat.size <= cap, `invalid regular file: ${p}`);
    const buf = Buffer.alloc(stat.size);
    for (let n = 0; n < buf.length;) {
      const k = readSync(fd, buf, n, buf.length - n, n);
      assert.ok(k > 0, `truncated during read: ${p}`);
      n += k;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, buf.length), 0,
      `file grew during read: ${p}`);
    return buf;
  } finally { closeSync(fd); }
}
function provenanceAt(p, digest) {
  const d = JSON.parse(readRegular(p, 16384).toString('utf8'));
  assert.equal(d.schemaVersion, 1);
  assert.equal(d.backend, 'java-graalvm');
  assert.equal(d.compilerRepository, 'ores-truffle-oreslang/oreslang-source.java');
  assert.match(d.compilerSourceCommit, SHA1);
  assert.match(d.compilerSourceTree, SHA1);
  assert.match(d.compilerSha256, SHA256);
  assert.equal(d.compilerSha256, digest, 'compiler SHA-256 does not match declared pin');
  for (const k of ['buildCommand', 'builderIdentity', 'toolchain', 'buildRunUrl'])
    assert.ok(typeof d[k] === 'string' && d[k].length > 3 && d[k].length < 4096,
      `missing build provenance: ${k}`);
  assert.match(d.buildRunUrl, /^https:\/\/github\.com\//);
  return d;
}
function pinNativeExecutable(bytes, p, digest) {
  const magic = bytes.subarray(0, 4).toString('hex');
  assert.ok(magic === '7f454c46' || bytes.subarray(0, 2).toString('ascii') === 'MZ'
    // 0xCAFEBABE is ambiguous with JVM .class files; reject it.
    || new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe']).has(magic),
    'requires native executable, not a script/JAR launcher with unpinned dependencies');
  assert.equal(hash('sha256', bytes), digest);
  writeFileSync(p, bytes, { mode: 0o500, flag: 'wx' });
  chmodSync(p, 0o500);
}
function diagnosticMatches(kind, stderr) {
  if (kind === 'FUTURE_CALLBACK_NOT_FUTURE')
    return /Future\.flat_map callback must return Future<T>/.test(stderr)
      || /\bFUTURE_CALLBACK_NOT_FUTURE\b/.test(stderr);
  if (kind === 'WRAPPER_LAYER_MISMATCH')
    return /\bWRAPPER_LAYER_MISMATCH\b/.test(stderr)
      || /has type Future<[^\n]+ but expected (?:Future<|int\b)/.test(stderr)
      // Java Types.Named is a record; raw checker diagnostics use Named[name=Future,...].
      || /has type Named\[name=Future, arguments=\[Named\[name=Future,[^\n]+ but expected Named\[name=Future/.test(stderr)
      || /has type Named\[name=Future,[^\n]+ but expected INT\b/.test(stderr);
  return false;
}
function invoke(compiler, dir, source, check) {
  const run = spawnSync(compiler, check
    ? ['--no-prompt', '--check', source] : source == null ? ['--build-info'] : ['--no-prompt', source], {
    cwd: dir, encoding: 'utf8', timeout: 30000, maxBuffer: 262144,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
      HOME: dir, TMPDIR: dir, CI: 'true', NO_COLOR: '1' }
  });
  return { exit: run.status, signal: run.signal, error: run.error?.code ?? null,
    stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}
function main(argv) {
  assert.equal(argv.length, 4, 'required: --compiler /abs/binary --provenance /abs/provenance.json');
  assert.equal(argv[0], '--compiler');
  assert.equal(argv[2], '--provenance');
  assert.ok(path.isAbsolute(argv[1]) && path.isAbsolute(argv[3]));
  const manifestBytes = readRegular(path.join(root, 'manifest.json'), 65536);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.contract, 'future-chaining-explicit-layers-v2');
  assert.equal(manifest.status, 'proposal-not-executable');
  assert.equal(manifest.sourceExecutionVerified, false);
  assert.equal(manifest.runtimeVerified, false);
  assert.equal(manifest.cases.length, 8);
  assert.deepEqual(new Set(manifest.cases.map(v => v.id)), new Set(expected.keys()));
  for (const c of manifest.cases) {
    const e = expected.get(c.id);
    assert.ok(e && c.kind === e[0] && c.sourceGitBlobSha1 === e[2]
      && c.source === `${c.id}.ores` && c.status === 'pending' && c.verified === false,
      `manifest source or case drift: ${c.id}`);
    assert.equal(c.kind === 'positive' ? c.expected.stdout : c.expected.diagnosticCategory,
      e[1], `manifest expectation drift: ${c.id}`);
  }

  const bytes = readRegular(argv[1], 1024 * 1024 * 1024);
  const digest = hash('sha256', bytes);
  const provenance = provenanceAt(argv[3], digest);
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-guest-v2-'));
  const report = { contract: manifest.contract, status: 'NOT_EXECUTED',
    trust: 'operator-declared provenance; independent build attestation NOT verified',
    backend: provenance.backend, compilerSha256: digest,
    compilerSourceCommit: provenance.compilerSourceCommit,
    compilerSourceTree: provenance.compilerSourceTree,
    manifestSha256: hash('sha256', manifestBytes), cases: [] };
  try {
    const compiler = path.join(dir, 'pinned-oreslang-compiler');
    pinNativeExecutable(bytes, compiler, digest);
    // Native byte signatures and operator-provided hashes cannot establish
    // compiler identity. Require the production OresMain NativeBuildMode
    // handshake before accepting any Oreslang-language test result.
    const probe = invoke(compiler, dir, null, false);
    assert.equal(probe.exit, 0, 'compiler --build-info did not exit successfully');
    assert.equal(probe.signal, null, 'compiler --build-info was terminated by a signal');
    assert.equal(probe.error, null, 'compiler --build-info failed to execute');
    assert.equal(probe.stderr, '', 'compiler --build-info must not write stderr');
    assert.ok(probe.stdout.length < 1024, 'compiler --build-info unexpectedly large');
    const info = JSON.parse(probe.stdout);
    assert.deepEqual(Object.keys(info).sort(), [
      'build_mode', 'default_execution_mode',
      'guest_execution', 'managed_reference_mode'
    ].sort(), 'compiler --build-info field mismatch');
    assert.equal(info.build_mode, 'aot', 'compiler must be an AOT native image');
    assert.equal(info.default_execution_mode, 'aot',
      'compiler must default to AOT execution');
    assert.equal(info.guest_execution, 'interpreter-no-jit',
      'compiler must not claim JIT guest execution in AOT mode');
    assert.ok(['compressed32', 'native64'].includes(info.managed_reference_mode),
      'unexpected native reference mode');
    report.compilerBuildInfo = info;
    for (const c of manifest.cases) {
      assert.match(c.source, /^[a-z0-9-]+\.ores$/);
      const sourceBytes = readRegular(path.join(root, c.source), 4096);
      assert.equal(blobSha1(sourceBytes), c.sourceGitBlobSha1, `fixture drift: ${c.id}`);
      const source = path.join(dir, c.source);
      writeFileSync(source, sourceBytes, { mode: 0o400, flag: 'wx' });
      const check = invoke(compiler, dir, source, true);
      const result = { id: c.id, sourceGitBlobSha1: c.sourceGitBlobSha1,
        checkExit: check.exit, checkSignal: check.signal, checkError: check.error,
        checkStderr: check.stderr.slice(0, 4096), passed: false };
      if (c.kind === 'compile_reject') {
        result.passed = check.exit !== null && check.exit !== 0 && !check.error
          && !check.signal && diagnosticMatches(c.expected.diagnosticCategory, check.stderr);
      } else if (c.kind === 'positive') {
        if (check.exit === 0 && check.stdout === '' && !check.error && !check.signal) {
          const run = invoke(compiler, dir, source, false);
          result.runExit = run.exit;
          result.runSignal = run.signal;
          result.runError = run.error;
          result.observedStdout = run.stdout.slice(0, 4096);
          result.runStderr = run.stderr.slice(0, 4096);
          result.passed = run.exit === 0 && !run.error && !run.signal
            && run.stdout === c.expected.stdout;
        }
      } else throw new Error(`unsupported case kind: ${c.id}`);
      report.cases.push(result);
    }
    report.status = report.cases.length === 8 && report.cases.every(v => v.passed)
      ? 'COMPILER_EXECUTION_OBSERVED_PROVENANCE_UNATTESTED' : 'FAILED';
  } finally { rmSync(dir, { recursive: true, force: true }); }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'FAILED') process.exitCode = 1;
}
try { main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`FAIL_CLOSED: ${error.message}\n`); process.exitCode = 1; }
