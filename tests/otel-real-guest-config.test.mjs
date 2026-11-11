import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConfiguration, captureReal } from '../bin/run-otel-guest-execution.mjs';
import { PROFILES } from '../bin/verify-otel-guest-parity.mjs';

function configuration(profile = 'java-graalvm-jit') {
  return {
    schema: 'oreslang-otel-real-guest-execution/v1', profile,
    backend_source_root: '/nonexistent-real-compiler-source',
    backend_source_sha: 'a'.repeat(40),
    otel_source_root: '/nonexistent-native-otel-source',
    otel_source_sha: 'b'.repeat(40),
    compiler_executable: '/nonexistent/compiler',
    compiler_binary_sha256: 'c'.repeat(64),
    dependency_pins: [],
    compile_argv: ['/nonexistent/compiler', '--check', '{fixture}'],
    run_argv: ['/nonexistent/compiler', '{fixture}'],
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
