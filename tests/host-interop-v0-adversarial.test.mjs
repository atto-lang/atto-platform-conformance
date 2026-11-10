import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const contract = resolve(root, 'contracts/host-interop-v0');
const manifest = JSON.parse(readFileSync(resolve(contract, 'manifest.json'), 'utf8'));

// These are contract/source integrity checks only, NEVER evidence of
// compiled AttoLang guest execution, host-policy rejection or NativeAOT.
const negativeOracles = Object.freeze([
  { id: 'java-deny-sensitive-system', file: 'negative-jvm-sensitive-system.atto',
    backend: 'java', phase: 'runtime-admission',
    authority: 'JAVA_INTEROP,allowlist:java.lang.System',
    importLine: 'import jvm "java.lang.System" as JSystem;' },
  { id: 'java-reject-missing-alias', file: 'negative-jvm-missing-alias.atto',
    backend: 'java', phase: 'source-check',
    authority: 'JAVA_INTEROP',
    importLine: 'import jvm "java.util.ArrayList";' },
  { id: 'net-reject-missing-alias', file: 'negative-dotnet-missing-alias.atto',
    backend: 'net', phase: 'source-check',
    authority: 'interop.dotnet.math-i64',
    importLine: 'import dotnet "System.Math";' },
  { id: 'net-deny-reflection', file: 'negative-dotnet-reflection.atto',
    backend: 'net', phase: 'source-check',
    authority: 'interop.dotnet.math-i64',
    importLine: 'import dotnet "System.Reflection.Assembly" as Reflect;' },
]);

test('four added adversarial import oracles retain precise rejection phases', () => {
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, manifest.cases.length);
  for (const expected of negativeOracles) {
    const actual = manifest.cases.find(c => c.id === expected.id);
    assert.ok(actual, 'missing oracle: ' + expected.id);
    for (const name of ['file', 'backend', 'phase', 'authority']) {
      assert.equal(actual[name], expected[name], expected.id + ': ' + name);
    }
    assert.equal(actual.expected, 'reject');
    assert.equal(actual.expected_output, null);
    assert.equal(actual.status, 'NOT_EXECUTED');
    assert.equal(actual.source_head, null);
    assert.equal(actual.compiled_binary_sha256, null);
    assert.equal(actual.executed_steps, 0);
    const source = readFileSync(resolve(contract, expected.file), 'utf8');
    assert.equal(source.split('\n')[0], expected.importLine);
    assert.equal(source.match(/^import\s+/gm)?.length, 1,
      'fixture must contain exactly one real import header');
    assert.ok(source.includes('return 42;'), 'fixture must have an inert entry body');
  }
});
