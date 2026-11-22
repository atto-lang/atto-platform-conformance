// Source-only backend parity registry contract; NOT compiled guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read = path => readFileSync(new URL('../'+path, import.meta.url));
const manifest = JSON.parse(read('contracts/task-compiler-parity-admission-v1.json'));
const targets = JSON.parse(read('contracts/task-payload-sync-v1.json'));
const blobSha = b => createHash('sha1').update(
  Buffer.from('blob ' + b.length + '\0')).update(b).digest('hex');

test('task compiler parity registry is source-only and fixes exact source hashes', () => {
  assert.equal(manifest.schema,'atto.task-compiler-parity-admission.v1');
  assert.equal(manifest.evidence_grade,'SOURCE_ONLY');
  assert.equal(Object.keys(manifest.source_profiles).length,11);
  assert.equal(new Set(manifest.source_cases.map(x=>x.id)).size,manifest.source_cases.length);
  const cases = new Map(targets.cases.map(x=>[x.id,x]));
  for (const c of manifest.source_cases) {
    const pinned = cases.get(c.id);
    assert.ok(pinned,'missing canonical target case '+c.id);
    assert.equal(c.source_path,pinned.source_path,c.id);
    assert.equal(c.source_git_blob,pinned.source_git_blob,c.id);
    assert.equal(blobSha(read(c.source_path)),c.source_git_blob,c.id);
  }
});

test('Java ready-Future int is not mistaken for general task support', () => {
  const java = manifest.source_profiles.java;
  assert.equal(java.profile,'CLOSED_WORLD_COMPLETED_FUTURE_INT_SOURCE_PROFILE');
  assert.equal(java.task_cancellation,'NOT_EXECUTED');
  assert.equal(java.guard_cleanup,'NOT_EXECUTED');
  assert.equal(java.compiled_guest,'NOT_EXECUTED');
  assert.match(java.source_blob_sha,/^[0-9a-f]{40}$/);
  assert.match(java.head_sha,/^[0-9a-f]{40}$/);
});

test('unsupported backends remain unverified until real compiled-guest receipts', () => {
  for (const [name,item] of Object.entries(manifest.source_profiles)) {
    assert.equal(item.release_qualified,false,name);
    assert.equal(item.task_cancellation,'NOT_EXECUTED',name);
    assert.equal(item.guard_cleanup,'NOT_EXECUTED',name);
    assert.equal(item.compiled_guest,'NOT_EXECUTED',name);
    if (item.head_sha) {
      assert.match(item.head_sha,/^[0-9a-f]{40}$/,name);
      assert.match(item.source_blob_sha,/^[0-9a-f]{40}$/,name);
    }
  }
  assert.ok(manifest.source_cases.some(x=>x.id==='cancel_lock_nested_lifo'));
  assert.ok(manifest.source_cases.some(x=>x.id==='cancel_lock_await_inside_guard'));
  assert.ok(manifest.source_cases.some(x=>x.id==='discard_do_sync_task'));
});

test('all eleven new type-directed task cases are represented across backend profiles', () => {
  const ids = [
    'await_sync_scalar_rejected', 'await_sync_future_valid',
    'const_async_task_rejected', 'const_sync_task_rejected',
    'empty_async_nonvoid_rejected', 'empty_sync_nonvoid_rejected',
    'do_async_void_empty', 'await_sync_void_rejected',
    'inferred_empty_task_future_void', 'inferred_int_task_future',
    'do_inferred_void_task'
  ];
  assert.equal(manifest.source_cases.length, 42);
  const included = new Set(manifest.source_cases.map(c => c.id));
  const canonical = new Map(targets.cases.map(c => [c.id, c]));
  for (const id of ids) {
    assert.ok(included.has(id), id);
    assert.ok(canonical.has(id), id);
    assert.equal(manifest.source_cases.find(c=>c.id===id).source_git_blob,
      canonical.get(id).source_git_blob,id);
  }
  assert.equal(manifest.evidence_grade, 'SOURCE_ONLY');
  for (const [name,p] of Object.entries(manifest.source_profiles)) {
    assert.equal(p.release_qualified,false,name);
    assert.equal(p.compiled_guest,'NOT_EXECUTED',name);
  }
});

test('all TaskFuture handle, ready and cooperative-control cases remain source-only for eleven backends', () => {
  const ids = [
    'taskfuture_await_ready', 'taskfuture_await_direct',
    'taskfuture_receipt_split_control', 'taskfuture_cooperate_request',
    'taskfuture_cancel_scope', 'taskfuture_legacy_future_projection',
    'taskfuture_legacy_cancel_alias','taskfuture_inferred_empty_void',
    'taskfuture_inferred_valued','taskfuture_duplicate_ready_rejected',
    'taskfuture_duplicate_await_rejected','taskfuture_cooperate_on_future_rejected',
    'taskfuture_cancel_task_on_future_rejected','taskfuture_get_ready_on_future_rejected',
    'taskfuture_await_cooperate_rejected','taskfuture_await_cancel_task_rejected',
    'taskfuture_const_handle_rejected','taskfuture_sync_handle_rejected',
    'taskfuture_ready_as_int_rejected','taskfuture_control_void_as_int_rejected',
    'taskfuture_wrong_payload_rejected'
  ];
  const byId = new Map(manifest.source_cases.map(c=>[c.id,c]));
  const pinned = new Map(targets.cases.map(c=>[c.id,c]));
  assert.equal(byId.size,42);
  assert.equal(ids.length,21);
  for (const id of ids) {
    assert.ok(byId.has(id),'missing parity case '+id);
    assert.equal(byId.get(id).source_git_blob,pinned.get(id).source_git_blob,id);
    assert.equal(blobSha(read(byId.get(id).source_path)),byId.get(id).source_git_blob,id);
  }
  assert.equal(manifest.evidence_grade,'SOURCE_ONLY');
  assert.equal(Object.keys(manifest.source_profiles).length,11);
  for (const [name,profile] of Object.entries(manifest.source_profiles)) {
    assert.equal(profile.compiled_guest,'NOT_EXECUTED',name);
    assert.equal(profile.release_qualified,false,name);
  }
});
