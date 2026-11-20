// Host-only evidence-ledger integrity, NOT guest execution or parser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ledger = JSON.parse(await readFile(
  new URL('../contracts/functional-pipelines-v1/ledger.json', import.meta.url), 'utf8'));
const sha = /^[a-f0-9]{40}$/;
const statuses = new Set(['not_executed', 'passed', 'failed', 'unsupported']);

test('source identity and nonvacuous dual-direction fixtures', () => {
  assert.equal(ledger.schema, 'atto.functional-pipelines.evidence.v1');
  assert.equal(ledger.authority.repo, 'atto-lang/atto-spec');
  assert.match(ledger.authority.head_sha, sha);
  assert.match(ledger.authority.contract_blob_sha, sha);
  assert.equal(ledger.cases.length, 8);
  const names = ledger.cases.map(c => c.file);
  assert.equal(new Set(names).size, names.length);
  for (const c of ledger.cases) {
    assert.ok(c.file.startsWith('conformance/functional-pipelines-v1/'));
    assert.match(c.blob_sha, sha);
  }
  const positives = ledger.cases.filter(c => c.kind === 'positive');
  assert.deepEqual(positives.map(c => c.expected_exit), [83, 83, 42, 42]);
  assert.ok(positives.every(c => c.expected_stdout === ''));
  const negatives = ledger.cases.filter(c => c.kind === 'negative');
  assert.equal(negatives.length, 4);
  assert.ok(negatives.every(c => ['type','syntax'].includes(c.expected_rejection)
      && c.no_guest_artifact === true));
});

test('every backend must carry independent genuine execution evidence', () => {
  const targets = Object.entries(ledger.backend_states);
  assert.ok(targets.length >= 12);
  for (const [name, row] of targets) {
    assert.match(name, /^[a-z0-9-]+$/);
    assert.match(row.repo, /^atto-lang\/atto-source\.[a-z]+$|^atto-lang\/atto-lang\.github\.io$/);
    assert.ok(statuses.has(row.execution_status), name);
    if (row.proposed_head_sha != null) assert.match(row.proposed_head_sha, sha, name);
    if (row.implementation === 'code_authored') assert.ok(row.implementation_pr, name);
    if (row.execution_status === 'passed') {
      const receipt = row.receipt;
      assert.ok(receipt && typeof receipt === 'object', name);
      assert.ok(receipt.executed_step_count >= 1, name);
      assert.equal(receipt.real_guest, true, name);
      assert.match(receipt.compiler_head_sha, sha);
      assert.match(receipt.compiler_tree_sha, sha);
      assert.match(receipt.source_fixture_blob_sha, sha);
      assert.match(receipt.ci_run_url, /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+$/);
      assert.ok(receipt.command && typeof receipt.command === 'string', name);
      assert.ok(receipt.exit_status === 83 || receipt.exit_status === 42, name);
      assert.equal(receipt.stdout, '');
      assert.equal(receipt.negative_has_no_artifact, true);
    } else {
      assert.equal(row.receipt, null, 'unexecuted/failed/unsupported status may not carry pass evidence: ' + name);
    }
  }
  assert.equal(ledger.formatter.verification_status, 'not_executed');
  assert.equal(ledger.formatter.receipt, null);
  assert.ok(ledger.exclusions.includes('zero-step Actions runs'));
});
