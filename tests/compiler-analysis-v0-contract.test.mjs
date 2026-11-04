import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'contracts/v1/compiler-analysis-v0.json')));
const fixtureRoot = join(root, 'fixtures/compiler-analysis-v0');

test('analysis v0 declares unknown separately from positive compiler proof', () => {
  assert.equal(manifest.schema, 'atto-compiler-analysis/v0');
  assert.equal(manifest.mode, '--analyze');
  assert.equal(manifest.source_extension, '.atto');
  assert.equal(manifest.semantics.no_codegen, true);
  assert.equal(manifest.semantics.no_guest_execution, true);
  assert.equal(manifest.semantics.effect_unknown_not_pure, true);
  assert.equal(manifest.semantics.exception_grammar_proven, false);
  assert.deepEqual(Object.keys(manifest.semantics.outcome_codes).sort(), ['0', '1', '2']);
  assert.equal(manifest.fixtures.length, 3);
  assert.deepEqual(Object.keys(manifest.backend_status).sort(), ['forge', 'java', 'llvm', 'net', 'wasm']);
  for (const fixture of manifest.fixtures) {
    assert.match(fixture.file, /^analysis-[a-z-]+\.atto$/);
    assert.equal(typeof readFileSync(join(fixtureRoot, fixture.file), 'utf8'), 'string');
    assert.ok(fixture.expected_record && fixture.scope);
  }
  assert.ok(manifest.provenance.required.includes('compiler commit SHA'));
  assert.notEqual(manifest.backend_status.llvm, 'verified');
});

const compiler = process.env.ATTO_ANALYZE_LLVM_COMPILER;
test('optional real LLVM --analyze guest-source and no-codegen matrix', {
  skip: !compiler ? 'no real LLVM compiler binary pinned by CI: no execution claim' : false
}, () => {
  assert.ok(isAbsolute(compiler), 'compiler executable must be an absolute path');
  for (const fixture of manifest.fixtures) {
    const temp = mkdtempSync(join(tmpdir(), 'atto-compiler-v0-'));
    try {
      const sourcePath = join(temp, fixture.file);
      const original = readFileSync(join(fixtureRoot, fixture.file));
      writeFileSync(sourcePath, original);
      const result = spawnSync(compiler, ['--analyze', sourcePath], {
        cwd: temp, input: '', encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '', HOME: temp }
      });
      assert.equal(result.error, undefined, String(result.error));
      if (fixture.expected_exit === 'nonzero') {
        assert.notEqual(result.status, 0, fixture.file);
      } else {
        assert.equal(result.status, fixture.expected_exit, fixture.file + ': ' + result.stderr);
      }
      if (fixture.expected_record === 'must-not-report-known') {
        assert.doesNotMatch(result.stdout, /status=known/);
      } else {
        assert.ok(result.stdout.includes(fixture.expected_record),
          fixture.file + ': ' + result.stdout);
      }
      assert.deepEqual(readFileSync(sourcePath), original, fixture.file);
      assert.deepEqual(readdirSync(temp), [fixture.file], 'analysis must not write codegen files');
      assert.doesNotMatch(result.stdout, /target triple|define i64/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
