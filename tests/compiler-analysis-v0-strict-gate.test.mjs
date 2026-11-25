import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const target = join(directory, 'compiler-analysis-v0-contract.test.mjs');

// This checks that strict evidence mode actually fails before it can
// be misinterpreted as a source-only green result. It does NOT run compilers.
function runGate(overrides) {
  const env = { ...process.env,
    ATTO_ANALYZE_REQUIRE_EXECUTABLE: '1',
    ATTO_ANALYZE_LLVM_COMPILER: '',
    ATTO_ANALYZE_LLVM_SHA256: '',
    ATTO_ANALYZE_JAVA_COMPILER: '',
    ATTO_ANALYZE_JAVA_SHA256: '',
    ATTO_ANALYZE_FORMATTER_BIN: '',
    ATTO_ANALYZE_FORMATTER_SHA256: '',
    ...overrides
  };
  // An inherited runner context makes the nested `node --test` exit 0 even when
  // its test fails, which would hide the exit status this file exists to check.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [
    '--test', '--test-name-pattern=strict parity gate requires', target
  ], {
    env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024
  });
}

test('strict gate cannot pass when all real binaries are absent', () => {
  const result = runGate({});
  assert.equal(result.error, undefined, String(result.error));
  assert.notEqual(result.status, 0, 'missing compilers must not pass');
  assert.match(result.stdout + result.stderr, /requires an absolute binary path/);
});

test('strict gate cannot pass an unpinned binary path', () => {
  const result = runGate({ ATTO_ANALYZE_LLVM_COMPILER: '/does-not-exist/llvmc' });
  assert.equal(result.error, undefined, String(result.error));
  assert.notEqual(result.status, 0, 'missing sha256 must not pass');
  assert.match(result.stdout + result.stderr, /requires a pinned sha256/);
});

test('strict gate cannot pass a purportedly pinned nonexistent binary', () => {
  const result = runGate({
    ATTO_ANALYZE_LLVM_COMPILER: '/does-not-exist/llvmc',
    ATTO_ANALYZE_LLVM_SHA256: '0'.repeat(64)
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.notEqual(result.status, 0, 'missing binary must not pass');
  assert.match(result.stdout + result.stderr, /ENOENT|no such file/i);
});
