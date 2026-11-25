import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
  assert.equal(manifest.fixtures.length, 8);
  assert.deepEqual(Object.keys(manifest.backend_status).sort(), ['forge', 'java', 'llvm', 'net', 'wasm']);
  for (const fixture of manifest.fixtures) {
    assert.match(fixture.file, /^analysis-[a-z-]+\.atto$/);
    assert.equal(typeof readFileSync(join(fixtureRoot, fixture.file), 'utf8'), 'string');
    assert.ok(fixture.expected_record && fixture.scope);
  }
  assert.ok(manifest.provenance.required.includes('compiler commit SHA'));
  assert.notEqual(manifest.backend_status.llvm, 'verified');
});


const strictEvidence = process.env.ATTO_ANALYZE_REQUIRE_EXECUTABLE === '1';
test('strict parity gate requires exact pinned real compiler and formatter binaries', () => {
  if (!strictEvidence) return;
  for (const [role, pathEnv, digestEnv] of [
    ['LLVM', 'ATTO_ANALYZE_LLVM_COMPILER', 'ATTO_ANALYZE_LLVM_SHA256'],
    ['Java/GraalVM', 'ATTO_ANALYZE_JAVA_COMPILER', 'ATTO_ANALYZE_JAVA_SHA256'],
    ['formatter', 'ATTO_ANALYZE_FORMATTER_BIN', 'ATTO_ANALYZE_FORMATTER_SHA256']
  ]) {
    const executable = process.env[pathEnv];
    const expectedSha256 = process.env[digestEnv];
    assert.ok(executable && isAbsolute(executable), role + ' requires an absolute binary path');
    assert.match(expectedSha256 ?? '', /^[a-fA-F0-9]{64}$/,
      role + ' requires a pinned sha256');
    const actual = createHash('sha256').update(readFileSync(executable)).digest('hex');
    assert.equal(actual, expectedSha256.toLowerCase(), role + ' binary digest mismatch');
  }
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

const formatter = process.env.ATTO_ANALYZE_FORMATTER_BIN;
test('optional real LLVM-to-formatter analyzer exit and report parity', {
  skip: !compiler || !formatter
    ? 'both pinned LLVM compiler and formatter binaries required: no integration proof'
    : false
}, () => {
  assert.ok(isAbsolute(compiler), 'compiler executable path must be absolute');
  assert.ok(isAbsolute(formatter), 'formatter executable path must be absolute');
  for (const fixture of manifest.fixtures) {
    const temp = mkdtempSync(join(tmpdir(), 'atto-analysis-interop-'));
    try {
      const sourcePath = join(temp, fixture.file);
      const original = readFileSync(join(fixtureRoot, fixture.file));
      writeFileSync(sourcePath, original);
      const options = {
        cwd: temp, input: '', encoding: 'utf8',
        timeout: 20000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '', HOME: temp }
      };
      const direct = spawnSync(compiler, ['--analyze', sourcePath], options);
      const delegated = spawnSync(formatter, ['--analyze', sourcePath], {
        ...options,
        env: { ...options.env, ORESLANG_BIN: compiler }
      });
      assert.equal(direct.error, undefined, String(direct.error));
      assert.equal(delegated.error, undefined, String(delegated.error));
      assert.equal(delegated.status, direct.status,
        fixture.file + ': formatter must preserve compiler status');
      assert.equal(delegated.stdout, direct.stdout,
        fixture.file + ': formatter must preserve diagnostic report');
      assert.deepEqual(readFileSync(sourcePath), original, fixture.file);
      assert.deepEqual(readdirSync(temp), [fixture.file],
        'compiler and formatter must not generate files');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});

const javaCompiler = process.env.ATTO_ANALYZE_JAVA_COMPILER;
test('optional real Java/GraalVM to LLVM source-admitted scalar diagnostics parity', {
  skip: !compiler || !javaCompiler
    ? 'both pinned real Java and LLVM compiler binaries required'
    : false
}, () => {
  assert.ok(isAbsolute(javaCompiler), 'Java compiler executable path must be absolute');
  assert.ok(isAbsolute(compiler), 'LLVM compiler executable path must be absolute');
  for (const fixture of manifest.fixtures) {
    // Only stable, admitted v0 scalar semantics can be compared byte-for-byte.
    // Recursive programs and malformed sources may be rejected at different
    // frontend stages; that is fail-closed, not yet semantic parity.
    if (typeof fixture.expected_exit !== 'number') continue;
    const temp = mkdtempSync(join(tmpdir(), 'atto-llvm-java-analyze-'));
    try {
      const sourcePath = join(temp, fixture.file);
      const source = readFileSync(join(fixtureRoot, fixture.file));
      writeFileSync(sourcePath, source);
      const options = {
        cwd: temp, input: '', encoding: 'utf8', timeout: 20000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '', HOME: temp }
      };
      const llvm = spawnSync(compiler, ['--analyze', sourcePath], options);
      const java = spawnSync(javaCompiler, ['--analyze', sourcePath], options);
      assert.equal(llvm.error, undefined, String(llvm.error));
      assert.equal(java.error, undefined, String(java.error));
      assert.equal(llvm.status, fixture.expected_exit,
        fixture.file + ': LLVM did not meet contract');
      assert.equal(java.status, fixture.expected_exit,
        fixture.file + ': Java did not meet contract');
      assert.equal(java.stdout, llvm.stdout,
        fixture.file + ': real compiler analysis result differs');
      assert.deepEqual(readFileSync(sourcePath), source, 'source mutated');
      assert.deepEqual(readdirSync(temp), [fixture.file], 'compiler wrote artifacts');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
