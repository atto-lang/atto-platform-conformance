import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const proposal = JSON.parse(readFileSync(new URL(
  '../contracts/std-metrics-json-zorde-private-carrier-proposal-v1.json',
  import.meta.url), 'utf8'));
test('private source export remains explicitly denied without independent authorization', () => {
  assert.equal(proposal.schema, 'atto.stdlib.metrics-json-zorde.private-carrier-proposal-v1');
  assert.equal(proposal.status, 'NOT_AUTHORIZED');
  assert.equal(proposal.allows_source_export, false);
  assert.equal(proposal.requires_independent_authentication, true);
  assert.equal(proposal.candidate.approved_for_atto_source, false);
  assert.equal(proposal.source_pins.length, 9);
  assert.equal(new Set(proposal.source_pins.map(p=>p.repository)).size, 9);
  for (const p of proposal.source_pins) {
    assert.match(p.source_commit_sha,/^[0-9a-f]{40}$/);
    assert.match(p.source_root_tree_sha,/^[0-9a-f]{40}$/);
    assert.match(p.repository,/^atto-lang\/atto-source\.(java|llvm|net|wasm|forge|rs|cranelift|js|hdl)$/);
    assert.ok(Number.isInteger(p.pr) && p.pr>0);
  }
  for (const [k,v] of Object.entries(proposal.missing_approvals)) {
    assert.equal(v,null, 'review gate unexpectedly populated: '+k);
  }
  for (const p of ['copy_full_git_tree','create_private_mirror_branch','claim_external_native_CI_PASS']) {
    assert.ok(proposal.prohibited_actions.includes(p));
  }
});
