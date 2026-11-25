import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConfiguration, captureReal, args, checkGeneratedArtifact } from '../bin/run-otel-guest-execution.mjs';
import { PROFILES } from '../bin/verify-otel-guest-parity.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function configuration(profile = 'java-graalvm-jit') {
  return {
    schema: 'oreslang-otel-real-guest-execution/v1', profile,
    backend_source_root: '/nonexistent-real-compiler-source',
    backend_source_sha: 'a'.repeat(40),
    otel_source_root: '/nonexistent-native-otel-source',
    otel_source_sha: 'b'.repeat(40),
    compiler_executable: '/nonexistent/compiler',
    compiler_binary_sha256: 'c'.repeat(64),
    git_executable: '/trusted/git', git_binary_sha256: 'e'.repeat(64),
    dependency_pins: [],
    compile_argv: ['{compiler}', '--check', '{fixture}', '--out', '{artifact}'],
    run_argv: ['{compiler}', profile === 'java-graalvm-jit' ? '{fixture}' : '{artifact}'],
    artifact_kind: profile === 'java-graalvm-jit' ? 'source_fixture' : 'generated',
    timeout_ms: 5000,
  };
}
const denied = fn => assert.throws(fn, /OTEL_REAL_GUEST_DENIED|ENOENT|not found/i);

test('all six profiles can describe a real guest, without executing one', () => {
  for (const profile of Object.keys(PROFILES)) {
    const c = configuration(profile);
    assert.deepEqual(checkConfiguration(c), PROFILES[profile]);
    denied(() => captureReal(c)); // No source checkout and no mock fallback.
  }
});
test('wrong profiles and fake non-AOT modes cannot gain admission', () => {
  const c = configuration('net-native-aot');
  c.artifact_kind = 'source_fixture';
  denied(() => checkConfiguration(c));
  c.artifact_kind = 'generated';
  c.profile = 'managed-jit';
  denied(() => checkConfiguration(c));
});
test('unknown configuration keys, bad schema, and missing pins deny admission', () => {
  const c = configuration();
  c.verified = true;
  denied(() => checkConfiguration(c));
  delete c.verified;
  c.schema = 'otel-unchecked/v0';
  denied(() => checkConfiguration(c));
  c.schema = 'oreslang-otel-real-guest-execution/v1';
  c.dependency_pins = [{path:'/bin/clang'}];
  denied(() => checkConfiguration(c));
});
test('oversized, negative and noninteger timeout budgets deny', () => {
  const c = configuration();
  for (const ms of [0, -2, 180001, '5000', 1.5, NaN]) {
    c.timeout_ms = ms;
    denied(() => checkConfiguration(c));
  }
});
test('untrusted dependency pin paths and digests deny', () => {
  const c = configuration();
  c.dependency_pins = [{path:'relative/clang',sha256:'a'.repeat(64)}];
  denied(() => checkConfiguration(c));
  c.dependency_pins = [{path:'/usr/bin/clang',sha256:'0'.repeat(64)}];
  denied(() => checkConfiguration(c));
  c.dependency_pins = [];
  c.artifact_kind = 'unknown-kind';
  denied(() => checkConfiguration(c));
});

test('forged prototype-name profiles and missing source/run bindings are denied', () => {
  const c = configuration();
  for (const profile of ['toString', '__proto__', 'constructor', 'valueOf']) {
    c.profile = profile;
    denied(() => checkConfiguration(c));
  }
  c.profile = 'java-graalvm-jit';
  c.compile_argv[0] = '/tmp/other-compiler';
  denied(() => checkConfiguration(c));
  c.compile_argv[0] = '{compiler}';
  c.compile_argv = ['{compiler}', '--version'];
  denied(() => checkConfiguration(c));
  c.compile_argv = ['{compiler}', '--check', '{fixture}'];
  c.run_argv = ['{compiler}', '--version'];
  denied(() => checkConfiguration(c));
  const native = configuration('net-native-aot');
  native.compile_argv = ['{compiler}', '--check', '{fixture}'];
  denied(() => checkConfiguration(native));
  native.compile_argv = ['{compiler}', '--out', '{artifact}', '{fixture}'];
  native.run_argv = ['{compiler}', '--version'];
  denied(() => checkConfiguration(native));
});

test('inline interpreter evaluation and preloads cannot impersonate compiled guest', () => {
  const subs = { compiler: '/trusted/compiler', fixture: '/trusted/fixture',
    artifact: '/trusted/generated-artifact' };
  for (const option of ['-e', '--eval', '--eval=code', '-c',
    '-p', '--print', '--require', '--import', '--input-type=module']) {
    denied(() => args(['{compiler}', option, 'console.log(1)'], subs, 'guest'));
  }
  const cfg = configuration();
  cfg.run_argv = ['{compiler}', '-e', 'console.log(1)', '{fixture}'];
  denied(() => checkConfiguration(cfg));
});

test('native-AOT and wasm artifact header admission rejects scripts and mismatched code', t => {
  const dir = mkdtempSync(join(tmpdir(), 'otel-artifact-admission-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const artifact = join(dir, 'guest');
  const set = bytes => writeFileSync(artifact, bytes);
  set(Buffer.from('#!/bin/sh\necho forged telemetry\n'));
  for (const profile of ['llvm-native', 'java-graalvm-native-aot',
    'forge-native', 'net-native-aot', 'wasm-node-worker']) {
    denied(() => checkGeneratedArtifact(artifact, profile));
  }
  set(Buffer.from([0, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]));
  assert.equal(checkGeneratedArtifact(artifact, 'wasm-node-worker'), true);
  denied(() => checkGeneratedArtifact(artifact, 'llvm-native'));
  set(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]));
  assert.equal(checkGeneratedArtifact(artifact, 'llvm-native'), true);
  assert.equal(checkGeneratedArtifact(artifact, 'net-native-aot'), true);
  denied(() => checkGeneratedArtifact(artifact, 'wasm-node-worker'));
  set(Buffer.from([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0]));
  assert.equal(checkGeneratedArtifact(artifact, 'net-native-aot'), true);
  set(Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
  assert.equal(checkGeneratedArtifact(artifact, 'java-graalvm-native-aot'), true);
});

test('Git provenance binary must be an exact absolute pinned tool', () => {
  const c = configuration();
  c.git_executable = 'git';
  denied(() => checkConfiguration(c));
  c.git_executable = '/trusted/git';
  c.git_binary_sha256 = '0'.repeat(64);
  denied(() => checkConfiguration(c));
  c.git_binary_sha256 = 'e'.repeat(64);
  c.git_executable = null;
  denied(() => checkConfiguration(c));
});
