// SOURCE ONLY. Does not run an Atto compiler or guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const m = JSON.parse(readFileSync(root + 'contracts/trap-result-guest-v1.json', 'utf8'));
test('all eleven backends remain uncertified for these new fixtures', () => {
  assert.equal(m.claim, 'TARGET_ONLY_NOT_GUEST_VERIFIED');
  assert.equal(Object.keys(m.backends).length, 11);
  for (const [name, row] of Object.entries(m.backends)) {
    assert.ok(name.startsWith('atto-source.'));
    assert.equal(row.status, 'NOT_EXECUTED');
    assert.equal(row.compiler_head, null);
    assert.equal(row.guest_receipt, null);
  }
});
test('source-only target registry is complete and has both outcomes', () => {
  const ids = new Set();
  assert.equal(m.cases.length, 21);
  let positive = 0, negative = 0;
  for (const c of m.cases) {
    assert.ok(!ids.has(c.id)); ids.add(c.id);
    assert.ok(c.source.startsWith('fixtures/trap-result-v1/'));
    assert.ok(c.source.endsWith('.atto'));
    assert.ok(existsSync(root + c.source));
    assert.ok(readFileSync(root + c.source, 'utf8').includes('fnc main(): int'));
    assert.equal(c.status, 'TARGET_ONLY');
    if (c.expect.kind === 'guest_exit') {
      assert.ok(Number.isInteger(c.expect.exit_code));
      positive++;
    } else {
      assert.equal(c.expect.kind, 'compile_reject');
      assert.ok(c.expect.diagnostic.startsWith('E_'));
      assert.equal(c.expect.no_artifact, true);
      negative++;
    }
  }
  assert.equal(positive, 14);
  assert.equal(negative, 7);
  assert.ok(ids.has('parse-id-ok'));
  assert.ok(ids.has('reject-impossible-join'));
  assert.ok(ids.has('reject-obsolete-option-trap-binding'));

});

test('obsolete Option-valued trap is an exact pinned negative, never a v1 positive', () => {
  const path = 'fixtures/trap-result-v1/reject-obsolete-option-trap-binding.atto';
  const data = readFileSync(root + path);
  const sha = createHash('sha1').update('blob ' + data.length + '\\0').update(data).digest('hex');
  assert.equal(sha, 'c0467b30232d2ecd5487eecb09fd86cedc79cbc0');
  assert.match(data.toString('utf8'), /Option<int> = trap \\(40 \\+ 2\\)/);
  const caseEntry = m.cases.find(c => c.id === 'reject-obsolete-option-trap-binding');
  assert.equal(caseEntry.source, path);
  assert.equal(caseEntry.expect.kind, 'compile_reject');
  assert.equal(caseEntry.expect.no_artifact, true);
});
