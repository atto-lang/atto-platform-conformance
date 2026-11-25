import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('../tests/', import.meta.url));

test('lambda strict AOT harness unit tests (not compiler execution)', () => {
  const run = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', testsDir, '-p', 'test_run_lambda_v1.py', '-v'], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 256 * 1024,
  });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 0, 'Python unit tests failed:\n' + run.stderr + '\n' + run.stdout);
  assert.match(run.stderr, /Ran 6 tests/);
});
