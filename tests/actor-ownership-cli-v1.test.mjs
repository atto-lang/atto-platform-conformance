import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'actor-ownership-source-v1.mjs');
function cliRun(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', timeout: 10000,
    maxBuffer: 256 * 1024,
    env: {LANG: 'C', LC_ALL:'C', TZ:'UTC'}
  });
}

test('CLI unconfigured returns exit 1 for Java and LLVM; never misreports certification', () => {
  for (const backend of ['java','llvm']) {
    const r = cliRun([`--backend=${backend}`]);
    assert.equal(r.status, 1, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.backend, backend);
    assert.equal(out.ok, false);
    assert.equal(out.provenanceVerified, false);
    assert.equal(out.certificationEligible, false);
    assert.equal(out.guestExecuted, false);
    assert.equal(out.verificationScope, 'NOT_EXECUTED');
    assert.ok(out.results.length > 0);
    assert.ok(out.results.every(c => c.status === 'UNCONFIGURED'));
  }
});

test('CLI rejects invalid backend, unrecognized options and ambiguous duplicates', () => {
  for(const argv of [
    [], ['--backend=wasm'], ['--backend=java', '--backend=llvm'],
    ['--backend=llvm', '--unexpected=yes'],
    ['--backend=llvm', '--argv={bad-json}']
  ]) {
    const r = cliRun(argv);
    assert.equal(r.status, 2, `${argv.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), '');
    assert.ok(r.stderr.length>0);
  }
});

test('CLI configured without a real executable fails closed before reporting source success', () => {
  const r = cliRun([
    '--backend=llvm', '--argv=["/missing/ores-compiler","{file}"]',
    `--source-sha=${'a'.repeat(40)}`
  ]);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout.trim(), '');
  assert.ok(!r.stderr.includes('SOURCE_ACCEPTED'));
});
