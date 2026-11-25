import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This is a bounded *reference model*, not an Atto lexer, compiler, linker,
// or runtime. It proves contract coherence only. Compiler receipts must be
// recorded independently with exact source tree and executable steps.
const contract = JSON.parse(readFileSync(new URL('../contracts/v1/package-namespace-import-v1.json', import.meta.url), 'utf8'));
const reserved = new Set(['import', 'from', 'as', 'module', 'pkg', 'class', 'actor', 'type', 'fnc', 'pub', 'self', 'use', 'namespace']);
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

function model(source, occupiedBindings = []) {
  const existing = new Set(occupiedBindings);
  const declared = [];
  for (const line of source.split('\n')) {
    const match = /^import\s+pkg\s+(['"])([^'"\r\n]*)\1(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;$/.exec(line.trim());
    if (!match) return { expected: 'REJECT', diagnostic: 'E_INVALID_IMPORT_SYNTAX' };
    const packageId = match[2];
    if (!packageId || packageId.includes('..') || packageId.endsWith('.') ||
        packageId.includes('\\') || /[\x00-\x1f\x7f]/.test(packageId)) {
      return { expected: 'REJECT', diagnostic: 'E_INVALID_PACKAGE_ID' };
    }
    const components = packageId.split('.');
    if (components.some(c => c.length === 0)) {
      return { expected: 'REJECT', diagnostic: 'E_INVALID_PACKAGE_ID' };
    }
    const candidate = components.at(-1);
    const explicit = match[3];
    if (explicit && reserved.has(explicit)) {
      return { expected: 'REJECT', diagnostic: 'E_RESERVED_ALIAS' };
    }
    if (!explicit && (!identifier.test(candidate) || reserved.has(candidate))) {
      return { expected: 'REJECT', diagnostic: 'E_ALIAS_REQUIRED' };
    }
    const binding = explicit ?? candidate;
    if (existing.has(binding)) {
      return { expected: 'REJECT', diagnostic: 'E_DUPLICATE_LOCAL_BINDING' };
    }
    existing.add(binding);
    declared.push(binding);
  }
  return { expected: 'ACCEPT', bindings: declared };
}

test('conformance manifest is a reference model and never claims guest execution', () => {
  assert.equal(contract.schema, 'atto.package-namespace-import.v1');
  assert.equal(contract.status, 'REFERENCE_MODEL_ONLY_NOT_COMPILER_EXECUTION');
  assert.ok(contract.cases.length >= 20);
  for (const evidence of Object.values(contract.backendEvidence)) {
    assert.equal(evidence, 'NOT_EXECUTED');
  }
  assert.equal(new Set(contract.cases.map(c => c.id)).size, contract.cases.length);
  assert.ok(contract.resolverChecks.includes('public-export-table-only'));
  assert.ok(contract.resolverChecks.includes('no-runtime-capabilities-from-import'));
});

for (const c of contract.cases) {
  test('namespace-import reference: ' + c.id, () => {
    const got = model(c.source, c.occupiedBindings ?? []);
    const expected = c.expected === 'ACCEPT'
      ? {expected: 'ACCEPT', bindings: c.bindings}
      : {expected: 'REJECT', diagnostic: c.diagnostic};
    assert.deepEqual(got, expected);
  });
}

test('model is fail-closed for malformed source and incompatible namespace bindings', () => {
  for (const source of ["import pkg 'z'; trailing", 'import pkg z;', "import pkg 'z' as ;"]) {
    assert.equal(model(source).expected, 'REJECT');
  }
});
