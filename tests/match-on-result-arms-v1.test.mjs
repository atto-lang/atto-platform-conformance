// Source-only regression: these assertions do not compile or execute .atto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const registry = JSON.parse(readFileSync(new URL('../contracts/match-on-result-arms-v1.json', import.meta.url), 'utf8'));
const backends = ['java', 'rust', 'llvm_native', 'llvm_browser_wasm',
  'independent_wasm', 'net', 'forge', 'cranelift'];
function blobSha(bytes) {
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

test('canonical match-on-Result registry pins all six Git input blobs', () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.contract, 'atto-match-on-result-arms-v1');
  assert.equal(registry.status, 'not_executed');
  assert.equal(registry.cases.length, 6);
  assert.equal(new Set(registry.cases.map(c => c.id)).size, 6);
  for (const backend of backends)
    assert.equal(registry.backend_evidence[backend], 'not_executed', backend);
  for (const c of registry.cases) {
    assert.match(c.path, /^fixtures\/match-on-result\/v1\/[a-z0-9-]+\.atto$/);
    const bytes = readFileSync(new URL('../' + c.path, import.meta.url));
    const src = bytes.toString('utf8');
    assert.equal(blobSha(bytes), c.blob_sha, c.id + ' Git blob changed');
    assert.match(src, /pub fnc main\(\): int/);
    assert.match(src, /match admission\(\) over/);
    if (c.expect === 'accept') {
      assert.equal(c.exit, 42);
      assert.match(src, /on Ok\(ack\) -> \{/);
      assert.match(src, /on (?:Err\(err\)|_)\s*-> \{/);
      assert.doesNotMatch(src, /^\s*(?:Ok\(|Err\(|default\s*->)/m);
      if (c.id === 'wildcard-on') {
        assert.match(src, /do match admission\(\) over/);
        assert.match(src, /on _ -> \{ score = 41; return void; \}/);
        assert.match(src, /end\s+return score \+ 1;/);
      } else {
        assert.match(src, /return match admission\(\) over/);
        assert.match(src, /end;/);
      }
    } else {
      assert.equal(c.expect, 'reject');
      assert.equal(c.diagnostic, 'E_SYNTAX');
      assert.match(src, /\/\/ expect-error: E_SYNTAX/);
      assert.match(src, /^\s*(?:Ok\(|Err\(|default\s*->)/m);
    }
  }
});

test('source integrity is never misreported as executed backend guest evidence', () => {
  assert.equal(registry.status, 'not_executed');
  for (const state of Object.values(registry.backend_evidence)) assert.equal(state, 'not_executed');
});
