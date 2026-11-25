// SOURCE-ONLY registry validation. Not compiler guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const registry = JSON.parse(readFileSync(
  new URL('../contracts/task-cancel-lock-lifecycle-v1.json', import.meta.url), 'utf8'));
const load = c => readFileSync(new URL('../' + c.source_path, import.meta.url));
const gitBlob = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const cases = Object.fromEntries(registry.cases.map(c => [c.id,c]));

test('exact Git source blobs and expected runtime receipts are enumerated', () => {
  assert.equal(registry.schema,'atto.task-cancel-lock-lifecycle.v1');
  assert.equal(registry.status,'TARGET_NOT_GUEST_VERIFIED');
  assert.equal(registry.cases.length,4);
  assert.equal(new Set(registry.cases.map(c=>c.id)).size,4);
  for (const c of registry.cases) {
    assert.match(c.source_path,/^fixtures\/task-cancel-lock-lifecycle-v1\/[a-z0-9_]+\.atto$/);
    assert.equal(gitBlob(load(c)),c.source_git_blob,c.id);
    if (c.kind==='positive') {
      assert.equal(c.expected.guest_exit,42);
      assert.ok(c.expected.runtime_witnesses.length>=3,c.id);
    } else {
      assert.equal(c.expected.no_artifact,true);
      assert.match(c.expected.diagnostic,/^E_[A-Z_]+$/);
    }
  }
});

test('active lock cancellation preserves lexical release and nonjoining parent',()=>{
  const s=load(cases.cancel_active_lock_scope).toString('utf8');
  assert.match(s,/task<void>\s*\{/);
  assert.match(s,/using await counter\.lock_async\(\) as lease/);
  assert.match(s,/worker\.cancel\(\);/);
  assert.match(s,/return 42;/);
  assert.ok(cases.cancel_active_lock_scope.expected.runtime_witnesses
    .some(x=>x.includes('before_child_retired')));
});
test('nested immediate guards have no suspension and require reverse unwind',()=>{
  const s=load(cases.cancel_two_locks_reverse).toString('utf8');
  assert.match(s,/using first\.lock\(\) as left/);
  assert.match(s,/using second\.lock\(\) as right/);
  assert.doesNotMatch(s,/await/);
  assert.ok(cases.cancel_two_locks_reverse.expected.runtime_witnesses
    .some(x=>x.includes('release(second)')));
});
test('guard await and child capture are source-level negative targets',()=>{
  const a=load(cases.cancel_no_await_under_guard).toString('utf8');
  const b=load(cases.cancel_no_guard_capture).toString('utf8');
  assert.match(a,/using counter\.lock\(\) as lease/);
  assert.match(a,/sync task<int>/);
  assert.equal(cases.cancel_no_await_under_guard.expected.diagnostic,'E_GUARD_SUSPEND');
  assert.match(b,/do task<void>\s*\{\s*lease\.value/);
  assert.equal(cases.cancel_no_guard_capture.expected.diagnostic,'E_GUARD_ESCAPE');
});
test('all 10 backends must remain unverified until exact-head compiled guest traces',()=>{
  assert.equal(Object.keys(registry.backends).length,10);
  for (const [backend,state] of Object.entries(registry.backends)) {
    assert.equal(state.status,'NOT_EXECUTED',backend);
    assert.equal(state.release_qualified,false,backend);
    assert.equal(state.compiler_sha,null,backend);
    assert.equal(state.guest_receipt,null,backend);
  }
  assert.ok(registry.causal_requirements.some(x=>/must not force unlock active lease/i.test(x)));
});

test('terminal host-kernel shutdown and affine non-Send leases remain unverified guest gates',()=>{
  const targets=registry.host_reference_invariants;
  assert.equal(targets.exact_guest_verification,'NOT_EXECUTED');
  assert.equal(targets.source_pr,'atto-lang/atto-source.rs#416');
  assert.equal(targets.checks.length,2);
  assert.equal(targets.checks[0].id,'terminal_shutdown_admission');
  assert.match(targets.checks[0].expect,/new_root_task_denied_and_new_mutex_denied_after_stop/);
  assert.match(targets.checks[0].expect,/claimed_lease_unwinds_only_at_safe_point/);
  assert.equal(targets.checks[1].id,'lease_non_sendable_typestate');
  assert.match(targets.checks[1].expect,/!Send and !Sync/);
  assert.ok(registry.causal_requirements.some(x=>/STOP.*permanently denied/.test(x)));
  assert.ok(registry.causal_requirements.some(x=>/must not be Sendable\/Serializable/.test(x)));
  // These target conditions do not qualify as compiled guest/runtime passes.
  for(const evidence of Object.values(registry.backends))
    assert.equal(evidence.status,'NOT_EXECUTED');
});
