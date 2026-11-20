// Source-only SHA, alias and matrix integrity. NOT a compiled .atto guest proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const registry = JSON.parse(readFileSync(new URL('../contracts/task-payload-sync-v1.json', import.meta.url), 'utf8'));
const getSource = item => readFileSync(new URL('../' + item.source_path, import.meta.url));
const gitSha = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.byteLength + '\0')).update(bytes).digest('hex');
const cases = Object.fromEntries(registry.cases.map(c => [c.id,c]));
test('versioned typed task fixtures are pinned to exact Git blob identity', () => {
  assert.equal(registry.schema, 'atto.task-payload-sync.v1');
  assert.equal(registry.status, 'TARGET_NOT_GUEST_VERIFIED');
  assert.equal(registry.cases.length, 17);
  assert.equal(new Set(registry.cases.map(x=>x.id)).size,17);
  for (const c of registry.cases) {
    assert.match(c.source_path,/^fixtures\/task-payload-sync-v1\/[a-z0-9_]+\.atto$/);
    assert.equal(gitSha(getSource(c)),c.source_git_blob,c.id);
    assert.ok(['positive','negative'].includes(c.kind));
    if (c.kind==='positive') assert.equal(c.expected.guest_exit,42);
    else {
      assert.equal(c.expected.no_artifact,true);
      assert.match(c.expected.diagnostic,/^E_[A-Z_]+$/);
    }
  }
});
test('await and sync typed task fixtures differ only in spelling', () => {
  assert.equal(getSource(cases.sync_payload).toString('utf8').replace('sync task<int>','await task<int>'),
    getSource(cases.await_payload).toString('utf8'));
});
test('do sync task canonicalizes to do task without losing body or type', () => {
  assert.equal(getSource(cases.discard_do_sync_task).toString('utf8').replace('do sync task<int>','do task<int>'),
    getSource(cases.discard_do_task).toString('utf8'));
});
test('all compiler backends remain not-executed until real guest receipts', () => {
  assert.equal(Object.keys(registry.backends).length,10);
  for (const [backend,entry] of Object.entries(registry.backends)) {
    assert.equal(entry.status,'NOT_EXECUTED',backend);
    assert.equal(entry.release_qualified,false,backend);
    assert.equal(entry.compiler_sha,null,backend);
    assert.equal(entry.guest_receipt,null,backend);
  }
});

test('separate logical task frames and safe physical coallocation are the target model', () => {
  assert.match(registry.execution_frame_model,/independent logical continuations/);
  assert.match(registry.execution_frame_model,/proven lifetime and alias safety/);
  const dual = getSource(cases.two_live_task_frames).toString('utf8');
  const local = getSource(cases.parent_child_frame_isolation).toString('utf8');
  const nested = getSource(cases.nested_task_frames).toString('utf8');
  assert.equal((dual.match(/task<int> \{/g) ?? []).length,2);
  assert.equal((dual.match(/val int local =/g) ?? []).length,2);
  assert.match(dual,/await left;/);
  assert.match(dual,/await right;/);
  assert.equal((local.match(/val int local =/g) ?? []).length,2);
  assert.match(local,/return local \+ child_result;/);
  assert.equal((nested.match(/task<int> \{/g) ?? []).length,2);
  assert.match(nested,/await nested;/);
});
