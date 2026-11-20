// SOURCE-INTEGRITY TEST ONLY. This does not compile or execute an Atto guest.
// Exact fixture byte pinning prevents backends from reporting receipts for
// a different program than the conformance contract actually names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const contract = JSON.parse(readFileSync(new URL('contracts/pipe-rpipe-directed-endpoints-v1.json', root), 'utf8'));

function gitBlobSha(content) {
  const data = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex');
}

test('pipe/rpipe contract explicitly declares source-only evidence, not guest parity', ()=>{
  assert.equal(contract.schema_version, 1);
  assert.equal(contract.evidence_status, 'NOT_EXECUTED');
  assert.equal(contract.fixture_sha_lock_version, 1);
  assert.ok(contract.backend_evidence.length >= 9);
  const repos = new Set();
  for (const backend of contract.backend_evidence) {
    assert.match(backend.repo, /^atto-lang\/atto-source\.[a-z]+$/);
    assert.equal(backend.status, 'NOT_EXECUTED');
    assert.ok(!repos.has(backend.repo), 'duplicate backend receipt');
    repos.add(backend.repo);
  }
  assert.match(contract.gating, /not passing conformance/i);
  // Exact-source compiler mirrors are source evidence ONLY. A backend that
  // intentionally rejects continuous guest transport is still NOT_EXECUTED
  // in the guest parity ledger, even when its host/compiler tests pass.
  assert.equal(contract.exact_source_compiler_mirrors.length,5);
  const caseIds=new Set(contract.cases.map(x=>x.id));
  const mirrors=new Set();
  for(const mirror of contract.exact_source_compiler_mirrors){
    assert.ok(!mirrors.has(mirror.repo),'duplicate compiler mirror');
    mirrors.add(mirror.repo);
    assert.ok(repos.has(mirror.repo),'mirror not listed as a tracked backend');
    assert.ok(mirror.pr.startsWith('https://github.com/'+mirror.repo+'/pull/'));
    assert.equal(mirror.guest_execution,'NOT_EXECUTED');
    assert.ok(mirror.limitation?.length>30,'missing capability/semantics gap');
    assert.equal(new Set(mirror.case_ids).size,mirror.case_ids.length);
    assert.ok(mirror.case_ids.every(x=>caseIds.has(x)), 'mirror references unknown .atto fixture');
    if(mirror.repo==='atto-lang/atto-source.rs') {
      assert.equal(mirror.case_ids.length,6);
      assert.match(mirror.limitation,/PipeSetupError/);
    } else {
      assert.equal(mirror.case_ids.length,12);
      assert.equal(mirror.admission,'exact_shared_source_explicit_unsupported_guest_diagnostic');
    }
  }

  // A PR link or typed host planner is NOT an executable guest receipt.
  assert.equal(contract.compiler_workstreams.length, 8);
  const workstreamRepos=new Set();
  for (const item of contract.compiler_workstreams) {
    assert.match(item.repo,/^atto-lang\/atto-source\.[a-z]+$/);
    assert.ok(!workstreamRepos.has(item.repo),'duplicate compiler workstream');
    workstreamRepos.add(item.repo);
    assert.ok(item.pr.startsWith('https://github.com/'+item.repo+'/pull/'));
    assert.equal(item.guest_pipe_execution,'NOT_EXECUTED');
    assert.ok(item.phase.length>5);
    assert.ok(repos.has(item.repo),'workstream must be in full backend evidence roster');
  }

});

test('fixture paths and expected diagnostics are unique, bounded and pinned to git blobs', ()=>{
  const ids = new Set(), paths = new Set();
  assert.equal(contract.cases.length, 12);
  for (const entry of contract.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(entry.id), 'duplicate test ID');
    ids.add(entry.id);
    assert.ok(!paths.has(entry.path), 'duplicate fixture path');
    paths.add(entry.path);
    assert.equal(entry.path, 'fixtures/pipe-rpipe-v1/' + entry.id + '.atto');
    assert.match(entry.source_git_blob_sha, /^[0-9a-f]{40}$/);
    const text = readFileSync(new URL(entry.path, root), 'utf8');
    assert.ok(Buffer.byteLength(text, 'utf8') <= 64 * 1024, 'fixture exceeds source limit');
    assert.equal(gitBlobSha(text), entry.source_git_blob_sha, 'fixture git blob mismatch: ' + entry.id);
    assert.match(text, /define actor Producer receives int/);
    assert.match(text, /define actor Consumer receives int/);
    assert.match(text, /pub susp fnc main\(\): int/);
    assert.match(text, /return 0;/);
    if (entry.expect.startsWith('reject')) assert.ok(entry.error_family || entry.phase === 'runtime_admission');
  }
});

test('closed or stopped DATA endpoints reject before graph publication', ()=>{
  const ids = ['stopped-source','closed-channel','stopped-consumer','stopped-actor-sink'];
  const byId = new Map(contract.cases.map(v => [v.id, v]));
  for (const id of ids) {
    const entry = byId.get(id);
    assert.ok(entry, 'missing stopped/closed port fixture ' + id);
    assert.equal(entry.expect, 'reject_closed_or_stopped_port');
    assert.equal(entry.phase, 'runtime_admission');
    assert.equal(entry.error_family, 'PipeSetupError');
    assert.equal(entry.expected_data_publication, 'NONE');
    assert.equal(entry.expected_delivery_count, 0);
    const source = readFileSync(new URL(entry.path, root), 'utf8');
    assert.match(source, /\.stop\(\)|\.close\(\)/);
    assert.match(source, /\bpipe\b/);
  }
  assert.ok(contract.security_invariants.some(v => /closed or stopped/.test(v)));
  assert.ok(contract.required_receipts.includes('closed_or_stopped_port_denial'));
});

test('operator boundaries and receipt obligations reject inferred duplex or silent backend success', ()=>{
  assert.equal(contract.operator_edges.pipe, 'left_to_right');
  assert.equal(contract.operator_edges.rpipe, 'right_to_left');
  assert.equal(contract.operator_edges.functional_forward, '|>');
  assert.equal(contract.operator_edges.functional_reverse, '<|');
  const byId = new Map(contract.cases.map(v => [v.id, v]));
  // Derive DATA edges from written stage indices. This checks the contract,
  // not a compiler result or a running guest.
  for (const entry of contract.cases.filter(v=>v.expect==='accept_typechecked_graph')) {
    assert.ok(entry.lexical_stages?.length >= 2);
    assert.ok(['pipe','rpipe'].includes(entry.operator));
    const order = entry.operator === 'rpipe'
      ? [...entry.lexical_stages].reverse()
      : [...entry.lexical_stages];
    const edges = order.slice(0,-1).map((source,i)=>({
      source, sink:order[i+1], payload:'int',
    }));
    assert.deepEqual(edges, entry.expected_data_edges,
      entry.id + ': lexical normalization must preserve DATA edges');
  }
  // A reverse-written chain must not be reported as backwards DATA flow.
  assert.deepEqual(
    byId.get('actor-forward').expected_data_edges,
    byId.get('actor-reverse').expected_data_edges,
  );
  assert.deepEqual(
    byId.get('mixed-channel-stream-forward').expected_data_edges,
    byId.get('mixed-channel-stream-reverse').expected_data_edges,
  );
  for (const c of contract.cases.filter(v=>v.expect==='accept_typechecked_graph')) {
    assert.ok(c.expected_data_edges?.length>=1);
    assert.ok(c.expected_data_edges.every(e=>
      e.source && e.sink && e.payload && e.source!==e.sink));
  }
  const unicast=contract.unicast_port_ownership;
  assert.equal(unicast.source_output,'at_most_one_unicast_DATA_attachment');
  assert.equal(unicast.sink_input,'at_most_one_unicast_DATA_attachment');
  assert.equal(unicast.duplicate_directed_edge,'E_PIPE_DUPLICATE_EDGE');
  assert.equal(unicast.occupied_source_output,'E_PIPE_OUTPUT_OCCUPIED');
  assert.equal(unicast.occupied_sink_input,'E_PIPE_INPUT_OCCUPIED');
  assert.match(unicast.fan_in_requires,/merge_or_join/);
  assert.match(unicast.fan_out_requires,/tee_or_broadcast/);
  assert.match(unicast.admission,/runtime_must_atomically_reserve_and_rollback/);
  assert.equal(contract.normalization_contract.preserve_lexical_constructor_order,true);
  assert.equal(contract.normalization_contract.evaluate_each_stage_once,true);
  assert.equal(contract.normalization_contract.directed_edges_never_supervisor_control,true);
  assert.equal(contract.normalization_contract.reverse_operator_does_not_imply_duplex,true);
  assert.equal(byId.get('actor-forward').required_direction, 'Producer->Consumer');
  assert.equal(byId.get('actor-reverse').required_direction, 'Producer->Consumer');
  assert.match(byId.get('actor-duplicate-direction').required_direction, /NEVER duplex/);
  assert.equal(byId.get('actor-mixed-directions').error_family, 'E_PIPE_DIRECTION');
  assert.equal(byId.get('actor-missing-emits').error_family, 'E_TYPE');
  assert.ok(contract.security_invariants.some(v => /cross-tenant/.test(v)));
  assert.ok(contract.security_invariants.some(v => /CONTROL/.test(v)));
  for (const required of ['backend_commit_sha','fixture_blob_sha','guest_executed','executed_steps_nonzero','observed_edge_direction']) {
    assert.ok(contract.required_receipts.includes(required), 'missing receipt requirement ' + required);
  }
});


test('experimental Rust checked PipeHandle preview cannot masquerade as backend conformance', ()=>{
  const preview=contract.rust_v2_checked_guest_preview;
  assert.equal(preview.repo,'atto-lang/atto-source.rs');
  assert.equal(preview.type,'Result<PipeHandle, PipeSetupError>');
  assert.equal(preview.opt_in,'explicit_result_binding_annotation_only');
  assert.equal(preview.endpoint_scope,'single_tenant_bounded_actor_channel_actor_triple');
  assert.match(preview.error_semantics,/without trap or DATA publication/);
  assert.equal(preview.checked_setup_compiler,'NOT_EXECUTED');
  assert.equal(preview.checked_setup_guest,'NOT_EXECUTED');
  assert.equal(preview.pipe_handle_methods,'NOT_IMPLEMENTED_FAIL_CLOSED');
  assert.equal(preview.cancellation_and_guards,'NOT_IMPLEMENTED');
  assert.equal(preview.tenant_generation_proof,'NOT_EXECUTED');
  assert.equal(preview.binding_spec_status,'NON_NORMATIVE_EXPERIMENTAL');
  assert.equal(preview.error_code_accessor,'PipeSetupError.code()');
  assert.deepEqual(preview.error_codes_v2_preview,{
    invalid_alias:1,invalid_capacity:2,closed_or_stopped:3,
    source_occupied:4,sink_occupied:5,channel_occupied:6,sink_has_downstream:7,
  });
  assert.equal(preview.allocation_rule,
    'success_result_and_guest_bridge_allocated_before_atomic_DATA_publication');
  assert.equal(new Set(preview.new_guest_fixture_ids).size,6);
  for (const id of preview.new_guest_fixture_ids) {
    assert.match(id,/^2(?:19|20|21|22|23)-v2-checked-/);
  }
  const cases=preview.rollback_recovery_cases;
  assert.equal(cases.source_output_conflict.error_code,4);
  assert.equal(cases.sink_input_conflict.error_code,5);
  for(const entry of Object.values(cases)){
    assert.equal(entry.status,'NOT_EXECUTED');
    assert.equal(entry.rejected_publications,0);
    assert.equal(entry.unclaimed_source_channel_sink_reusable,true);
    assert.equal(entry.expected_stdout,'40\\n2\\n'.replaceAll('\\n','\n'));
    assert.ok(entry.guest_fixture.startsWith('tests/fixtures/pass/'));
    assert.match(entry.guest_fixture,/2(?:22|23)-v2-checked-[a-z-]+[.]atto$/);
  }
  const row=contract.backend_evidence.find(x=>x.repo===preview.repo);
  assert.ok(row);
  assert.equal(row.status,'NOT_EXECUTED');
});
