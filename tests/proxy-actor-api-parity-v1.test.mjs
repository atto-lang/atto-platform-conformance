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
      if (b.host_ticket_ci.source_proof === 'EXACT_FULL_GIT_TREE') {
        assert.match(b.host_ticket_ci.source_tree_sha, /^[0-9a-f]{40}$/);
        assert.equal(b.host_ticket_ci.source_tree_sha,
          b.host_ticket_ci.mirrored_tree_sha,
          b.id + ': a merely selected-blob copy cannot claim exact full-tree parity');
        assert.ok(b.host_ticket_ci.verified_blob_count >= 125,
          b.id + ': full-tree proof unexpectedly incomplete');
      }
    } else {
      assert.equal(b.host_ticket_ci, null,
        b.id + ': unexecuted ticket code cannot carry PASS evidence');
    }
    if (b.restricted_sender_local_evidence) {
      const sender = b.restricted_sender_local_evidence;
      assert.equal(sender.status, 'LOCAL_JDK21_EXACT_EIGHT_BLOBS_PASSED');
      const requiredBlobs = ['compiler_blob', 'host_interface_blob', 'test_blob',
          'fixture_blob', 'receiver_compiler_blob', 'receiver_test_blob',
          'receiver_fixture_blob', 'os_peer_test_blob'];
      assert.equal(sender.verified_blob_count, requiredBlobs.length);
      for (const field of requiredBlobs)
        assert.match(sender[field], /^[0-9a-f]{40}$/,
          b.id + ': missing exact local source/test Git blob identity');
      assert.equal(new Set(requiredBlobs.map(name => sender[name])).size, 8);
      for (const marker of ['M10_SOURCE_BOUNDED_FD_UTF8_FAIL_CLOSED=PASS',
          'M10_RECEIVER_SOURCE_FD_UTF8_AND_OUTPUT_NOFOLLOW=PASS',
          'M10_UDS_PEER_KERNEL_PRINCIPAL_NOT_USER_NAME_PROPERTY=PASS'])
        assert.ok(sender.local_test_markers.includes(marker));
      assert.match(sender.tested_toolchain, /^OpenJDK javac 21[.]/);
      assert.equal(sender.generated_class, 'M10GeneratedSender');
      assert.ok(sender.local_test_marker.includes('RESTRICTED_ATTO_SENDER'));
      // A local restricted compiler probe cannot unlock any full compiled
      // Atto guest or authenticated transport gate.
      assert.notEqual(b.compiled_guest_ipc_status, 'PASSED');
      assert.equal(b.guest_evidence, null);
    }
    if (b.gateway_integration) {
      const gateway = b.gateway_integration;
      assert.equal(gateway.source_head_sha, b.host_ticket_pr_head_sha,
        b.id + ': integrated runtime source SHA differs from declared PR head');
      assert.ok(['NOT_EXECUTED_CURRENT_HEAD','SOURCE_EXACT_TESTED']
        .includes(gateway.status), b.id + ': invalid gateway execution status');
      assert.ok(Array.isArray(gateway.blocked_attempts));
      if (gateway.status === 'NOT_EXECUTED_CURRENT_HEAD') {
        assert.equal(b.host_ticket_status, 'CURRENT_HEAD_NOT_EXECUTED');
        assert.equal(b.host_ticket_ci, null);
        assert.ok(gateway.blocked_attempts.every(url =>
          /^https:\/\/github\.com\//.test(url)));
      }
      if (gateway.status === 'SOURCE_EXACT_TESTED') {
        assert.equal(b.host_ticket_status, 'SOURCE_EXACT_HOST_TESTED');
        const e = gateway.executed_evidence;
        assert.ok(e, b.id + ': source exact gateway without executable evidence');
        assert.equal(e.source_head_sha, b.host_ticket_pr_head_sha);
        assert.equal(e.source_head_sha, b.host_ticket_ci.source_head_sha);
        assert.match(e.carrier_commit_sha, /^[0-9a-f]{40}$/);
        assert.equal(e.carrier_commit_sha, b.host_ticket_ci.carrier_commit_sha);
        assert.equal(e.ci_url, b.host_ticket_ci.ci_url);
        assert.ok(e.original_git_blob_count >= 16);
        assert.equal(e.original_git_blob_count, b.host_ticket_ci.verified_blob_count);
        if (b.host_ticket_ci.source_proof === 'EXACT_FULL_GIT_TREE') {
          assert.equal(e.original_tree_sha, b.host_ticket_ci.source_tree_sha);
          assert.equal(e.mirror_tree_sha, e.original_tree_sha);
          assert.ok(e.markers.includes('ATTO_M10_EXACT_FULL_126_BLOB_TREE_MATCH=PASS'),
            b.id + ': full-tree source evidence missing');
        } else {
          assert.ok(e.markers.includes('ATTO_SOURCE_SIXTEEN_ORIGINAL_GIT_BLOBS=PASS'),
            b.id + ': original scoped-source evidence missing');
        }
        assert.ok(e.executed_job_steps >= 4);
        assert.equal(e.executed_job_steps, b.host_ticket_ci.executed_ci_steps);
        assert.equal(new Set(e.markers).size, e.markers.length);
        for (const marker of [
          'M6_NIO_SCHEDULER_SUPERVISOR_NATIVE_HOST=PASS',
          'M6_TICKET_128_CONCURRENT_MAIL_EXACT_CORRELATION=PASS',
          'M10_RESTRICTED_COMPILED_ATTO_PROCESS_A_SENDER=PASS',
          'M10_RESTRICTED_COMPILED_ATTO_REMOTE_RECEIVE=PASS',
          'M10_12_CONCURRENT_PER_MAIL_SCOPED_RESULTS_OR_VERIFIED_FULL=PASS',
          'M10_SIGNED_REJECTED_FULL_ROUTE_CORRELATION=PASS'
        ]) assert.ok(e.markers.includes(marker),
          b.id + ': missing exact two-process host-only evidence ' + marker);
        assert.notEqual(b.compiled_guest_ipc_status, 'PASSED',
          b.id + ': restricted host bridge is not canonical .atto guest');
        assert.equal(b.guest_evidence, null);
      }
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

test('destination scope hardening tracks all eleven profiles without promoting host evidence', () => {
  const scope = c.destination_scope_hardening;
  assert.ok(scope);
  assert.deepEqual(scope.backends.map(b => b.id).sort(), c.backends.map(b => b.id).sort());
  assert.deepEqual(scope.other_profiles.map(b => b.id).sort(), ['atto','hdl','realtime']);
  assert.equal(new Set(scope.required_guest_gates).size, 4);
  for (const gate of ['tenant_bound_to_trusted_destination_before_mailbox_admission',
      'wrong_tenant_empty_mailbox_no_ticket_or_credit',
      'numeric_target_and_incarnation_match','valid_retry_after_rejection'])
    assert.ok(scope.required_guest_gates.includes(gate), gate);
  for (const b of scope.backends) {
    assert.match(b.head, /^[0-9a-f]{40}$/);
    assert.match(b.pr, new RegExp('^https://github\\.com/atto-lang/atto-source\\.' + b.id + '/pull/[0-9]+$'));
    assert.ok(['REAL_MAILBOX','HOST_MODEL'].includes(b.scope));
    if (b.local_evidence) {
      assert.ok(Number.isInteger(b.local_evidence.verified_blob_count) && b.local_evidence.verified_blob_count > 0);
      assert.ok(Number.isInteger(b.local_evidence.passing_tests_or_runs) && b.local_evidence.passing_tests_or_runs > 0);
      assert.equal(b.local_evidence.negative_control_reproduced, true);
    }
    assert.equal(b.guest_status, 'NOT_EXECUTED');
    assert.equal(b.full_tree_ci_status, 'NOT_EXECUTED');
    assert.notEqual(c.backends.find(x => x.id === b.id).compiled_guest_ipc_status, 'PASSED',
      'host candidate status cannot unlock compiled guest parity');
  }
  const hdl = scope.other_profiles.find(x => x.id === 'hdl');
  assert.equal(hdl.guest_status, 'UNSUPPORTED');
  assert.equal(hdl.rejection_test_status, 'SCOPED_V8_PASSED');
  assert.match(hdl.rejection_evidence.head, /^[0-9a-f]{40}$/);
  assert.equal(hdl.rejection_evidence.scope, 'V8_HARNESS_NOT_NODE_CLI_OR_SYNTHESIS');
  assert.ok(hdl.rejection_evidence.assertions > 0);
  const java = scope.backends.find(x => x.id === 'java');
  const receipt = java.scoped_ci_evidence;
  assert.equal(receipt.status, 'PASSED');
  assert.equal(receipt.source_head, java.head);
  assert.match(receipt.source_root_tree, /^[0-9a-f]{40}$/);
  assert.match(receipt.carrier_scoped_tree, /^[0-9a-f]{40}$/);
  assert.notEqual(receipt.carrier_scoped_tree, receipt.source_root_tree);
  assert.match(receipt.carrier_head, /^[0-9a-f]{40}$/);
  assert.equal(receipt.verified_original_blobs, 3);
  assert.ok(receipt.executed_job_steps >= 3);
  assert.equal(receipt.passing_probes, 2);
  assert.equal(receipt.scope, 'HOST_RUNTIME_SCOPED_EXACT_BLOBS_NOT_FULL_TREE');
  assert.equal(java.full_tree_ci_status, 'NOT_EXECUTED');
  assert.equal(java.guest_status, 'NOT_EXECUTED');
  for (const b of scope.other_profiles.filter(x => x.id !== 'hdl'))
    assert.equal(b.guest_status, 'NOT_EXECUTED');
});
