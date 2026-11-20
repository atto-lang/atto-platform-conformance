import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const c = JSON.parse(fs.readFileSync(new URL('../contracts/proxy-actor-api-parity-v1.json', import.meta.url), 'utf8'));
test('proxy actor API registry remains canonical and cross-backend complete', () => {
  assert.equal(c.schema, 'atto.proxy_actor_api_parity.v1');
  assert.equal(c.authority, 'https://github.com/atto-lang/atto-spec/pull/40');
  assert.equal(new Set(c.api).size, c.api.length);
  assert.ok(c.api.every(name => /^[a-z][a-z0-9_]*$/.test(name)));
  for (const name of ['send_ack', 'send_received', 'send_result', 'send_durable',
                       'request', 'ask', 'connect_async', 'resolve_async', 'get_done'])
    assert.ok(c.api.includes(name), name);
  assert.equal(new Set(c.mandatory_guest_gates).size, c.mandatory_guest_gates.length);
  for (const name of ['two_real_os_processes','compiled_atto_sender',
      'compiled_atto_receiver','actual_destination_admission',
      'no_intermediary_ack','stale_ack_rejected','supervisor_control_separate',
      'exact_head_ci_steps',
      'exact_message_ticket_minted_at_mailbox_admission',
      'processed_requires_own_message_commit',
      'concurrent_unrelated_turn_must_not_ack',
      'panic_abandons_queued_mail'])
    assert.ok(c.mandatory_guest_gates.includes(name), name);
  assert.deepEqual(c.backends.map(b => b.id).sort(),
    ['cranelift','forge','java','js','llvm','net','rs','wasm']);
  for (const b of c.backends) {
    assert.ok(['REAL_MAILBOX','HOST_MODEL'].includes(b.host_ticket_scope));
    assert.ok(['SOURCE_EXACT_HOST_TESTED','CURRENT_HEAD_NOT_EXECUTED']
      .includes(b.host_ticket_status));
    assert.match(b.host_ticket_pr_head_sha, /^[0-9a-f]{40}$/);
    assert.match(b.host_gate_pr, new RegExp('^https://github\\.com/atto-lang/atto-source\\.' + b.id + '/pull/[0-9]+$'));
    assert.ok(['DRAFT_UNVERIFIED','SOURCE_ONLY_PASSED'].includes(b.host_gate_status));
    for (const status of ['compiled_guest_ipc_status','authenticated_transport_status','native_aot_status'])
      assert.ok(['NOT_EXECUTED','UNSUPPORTED','PASSED','FAILED'].includes(b[status]));
    if (b.host_ticket_status === 'SOURCE_EXACT_HOST_TESTED') {
      assert.ok(b.host_ticket_ci, b.id + ': missing executable host ticket receipt');
      assert.equal(b.host_ticket_ci.source_head_sha, b.host_ticket_pr_head_sha);
      assert.ok(['SCOPED_GIT_BLOBS_MATCHED','EXACT_FULL_GIT_TREE']
        .includes(b.host_ticket_ci.source_proof));
      assert.ok(Number.isInteger(b.host_ticket_ci.verified_blob_count) &&
        b.host_ticket_ci.verified_blob_count > 0);
      assert.ok(Number.isInteger(b.host_ticket_ci.executed_ci_steps) &&
        b.host_ticket_ci.executed_ci_steps > 0);
      assert.match(b.host_ticket_ci.ci_url, /^https:\/\/github\.com\//);
    } else {
      assert.equal(b.host_ticket_ci, null,
        b.id + ': unexecuted ticket code cannot carry PASS evidence');
    }
    if (b.compiled_guest_ipc_status === 'PASSED') {
      assert.ok(b.guest_evidence && /^[0-9a-f]{40}$/.test(b.guest_evidence.source_sha),
        b.id + ': PASS without immutable exact SHA');
      assert.ok(b.guest_evidence.sender_trace && b.guest_evidence.receiver_trace,
        b.id + ': PASS without real compiled sender/receiver traces');
      assert.ok(b.guest_evidence.executed_ci_steps > 0);
      assert.ok(b.guest_evidence.gates.every(g => g.passed));
      assert.deepEqual(b.guest_evidence.gates.map(g => g.name).sort(),
        [...c.mandatory_guest_gates].sort());
    } else {
      assert.equal(b.guest_evidence, null,
        b.id + ': guest evidence not certified by PASS');
    }
    if (b.authenticated_transport_status === 'PASSED')
      assert.equal(b.compiled_guest_ipc_status, 'PASSED');
  }
});
