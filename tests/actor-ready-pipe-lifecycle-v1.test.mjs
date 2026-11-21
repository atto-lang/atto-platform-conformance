import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ActorReadyPipeOracle } from '../src/actor-ready-pipe-oracle-v1.mjs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const data=JSON.parse(read('contracts/actor-ready-pipe-lifecycle-v1.json'));
const sha = s => { const b=Buffer.from(s); return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'); };
const pair = () => { const v=new ActorReadyPipeOracle(); const p=v.spawn({emits:'int'}); const c=v.spawn({receives:'int'}); return {v,p,c}; };
test('versioned source fixtures cannot masquerade as backend guest proof',() => {
 assert.equal(data.schema_version,1); assert.equal(data.status,'SOURCE_ONLY_NOT_EXECUTED');
 assert.equal(data.no_claim_of_cross_backend_parity,true);
 assert.equal(data.cases.length,7);
 assert.equal(data.backend_evidence.length,11);
 for(const b of data.backend_evidence) { assert.equal(b.guest_result,'NOT_EXECUTED'); assert.equal(b.artifact_identity,null); assert.equal(b.runner_receipt,null); }
 for(const f of data.cases) {
  assert.match(f.source_git_blob_sha,/^[a-f0-9]{40}$/);
  assert.equal(sha(read(f.path)),f.source_git_blob_sha,f.id);
  assert.equal(f.evidence,'NOT_EXECUTED');
 }
 const byId = Object.fromEntries(data.cases.map(c=>[c.id,read(c.path)]));
 assert.doesNotMatch(byId['connect-before-ready'],/await\s+(?:producer|consumer)\.get_ready\(/);
 assert.match(byId['explicit-get-ready'],/await producer\.get_ready\(\)/);
 assert.match(byId['await-spawn'],/await spawn Producer\(\)/);
 assert.match(byId['property-ready-reject'],/await producer\.ready;/);
 assert.match(byId['property-done-reject'],/await actor\.done;/);
 assert.match(byId['duplicate-direction-reject'],/consumer rpipe! producer/);
 assert.match(byId['stop-then-get-done'],/await producer\.get_done\(\)/);
});
test('connect immediately after spawn; DATA cannot enter STARTING receiver',() => {
 const {v,p,c}=pair(); const out=v.connect(p,c); assert.equal(out.ok,true); assert.equal(v.get_ready(p),null);
 assert.equal(v.emit(out.link,1).ok,false);
 v.ready(p); assert.equal(v.emit(out.link,7).ok,true);
 assert.deepEqual(out.link.queue,[7]); assert.deepEqual(out.link.delivered,[]);
 v.ready(c); assert.deepEqual(out.link.delivered,[7]); assert.deepEqual(out.link.queue,[]);
});
test('pre-READY queue is bounded, not silently unbounded',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c,{capacity:1}); v.ready(p);
 assert.equal(v.emit(r.link,10).ok,true); assert.equal(v.emit(r.link,11).error,'BACKPRESSURE');
 assert.equal(r.link.queue.length,1); v.ready(c); assert.deepEqual(r.link.delivered,[10]);
});
test('reverse-written duplicate edge rolls back with no second publication',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c);
 assert.equal(v.connect(p,c).error,'DUPLICATE_EDGE');
 assert.equal(v.links.length,1); assert.strictEqual(v.links[0],r.link);
});
test('deny direct cross-tenant, wrong type, closed ports and stale refs',() => {
 const v=new ActorReadyPipeOracle(),p=v.spawn({emits:'int',tenant:'a'}),c=v.spawn({receives:'int',tenant:'b'});
 assert.equal(v.connect(p,c).error,'TENANT_DENIED'); c.tenant='a'; c.receives='bool';
 assert.equal(v.connect(p,c).error,'TYPE'); c.receives='int'; v.stop(c);
 assert.equal(v.connect(p,c).error,'STOPPED');
 assert.equal(v.connect({...p},c).error,'STALE');
 assert.equal(v.links.length,0);
});
test('startup failure reports failed READY and terminal graph error, never success',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c); v.ready(p); v.emit(r.link,12);
 assert.equal(v.fail_start(c,'INIT_FAIL').ok,false);
 assert.equal(v.get_ready(c).error,'INIT_FAIL');
 assert.equal(r.link.done.error,'INIT_FAIL'); assert.deepEqual(r.link.queue,[]);
 assert.equal(v.ready(c).ok,false);
 assert.equal(v.retire(c).error,'INIT_FAIL');
 assert.strictEqual(v.get_done(c),c.done);
});
test('graceful stop preserves accepted DATA until receiver READY',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c,{capacity:1}); v.ready(p); v.emit(r.link,88);
 assert.equal(v.stop(p).ok,true); assert.equal(r.link.done,null);
 assert.equal(v.emit(r.link,99).error,'STOPPED_OR_NOT_READY');
 assert.equal(v.retire(p).error,'PENDING_PIPE'); v.ready(c);
 assert.deepEqual(r.link.delivered,[88]); assert.equal(r.link.done.ok,true);
 assert.equal(v.retire(p).ok,true);
});
test('DONE cannot publish with an outstanding actor resource loan',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c);
 v.ready(p); v.ready(c); p.loans=1; v.stop(p);
 assert.equal(r.link.done.ok,true); assert.equal(v.retire(p).error,'PINNED_LOANS');
 assert.equal(v.get_done(p),null); p.loans=0; assert.equal(v.retire(p).ok,true);
 assert.strictEqual(v.get_done(p),p.done);
});
test('STOP before READY never invents initialization success',() => {
 const {v,p}=pair(); v.stop(p);
 assert.equal(v.get_ready(p).error,'STOPPED_BEFORE_READY'); assert.equal(v.ready(p).ok,false);
 assert.equal(v.retire(p).error,'STOPPED_BEFORE_READY');
 assert.strictEqual(v.get_ready(p),p.ready);
});


test('all eleven compiler frontends have independent recognition gates and tracking', () => {
  const contract=data.compiler_frontend_contract;
  assert.equal(contract.runnable_preview_status,'NOT_EXECUTED');
  assert.match(contract.public_preview,/atto-lang\.github\.io\/pull\/196$/);
  assert.ok(contract.grammar.includes('actor_ref.get_ready()'));
  assert.ok(contract.grammar.includes('actor_ref.get_done()'));
  assert.ok(contract.grammar.includes('source pipe! sink'));
  assert.ok(contract.grammar.includes('sink rpipe! source'));
  assert.ok(contract.type_rules.includes('get_ready_get_done_are_methods_not_fields'));
  assert.match(contract.unsupported_policy,/before any guest artifact/);
  const expected=['java','llvm','rs','wasm','net','forge','cranelift','js','atto','hdl','realtime'];
  assert.deepEqual(data.backend_evidence.map(b=>b.repo),
    expected.map(s=>'atto-lang/atto-source.'+s));
  for (const backend of data.backend_evidence) {
    assert.equal(backend.frontend_contract_status,'NOT_VERIFIED',backend.repo);
    assert.equal(backend.lifecycle_runtime_status,'NOT_EXECUTED',backend.repo);
    assert.match(backend.tracking_url,
      /^https:\/\/github\.com\/atto-lang\/atto-source\.[a-z]+\/(?:issues|pull)\/\d+$/);
    assert.ok(backend.tracking_url.includes('/'+backend.repo.split('/').at(-1)+'/'),
      backend.repo+': wrong tracking repository');
  }
});


test('Rust terminal READY candidate does not silently promote any backend to PASS', () => {
  assert.equal(data.candidate_subsets.length,2);
  const candidate=data.candidate_subsets.find(x=>x.repository==='atto-lang/atto-source.rs');
  assert.ok(candidate);
  assert.equal(candidate.repository,'atto-lang/atto-source.rs');
  assert.match(candidate.source_head_sha,/^[a-f0-9]{40}$/);
  assert.equal(candidate.status,'STAGED_UNVERIFIED');
  assert.match(candidate.scope,/terminal-only await actor\.get_ready\(\)/);
  assert.ok(candidate.excludes.includes('typed pipe!/rpipe! transport'));
  assert.ok(candidate.tests.includes('tests/actor_ready_source_gate.rs'));
  assert.ok(candidate.tests.includes('tests/browser/actor-worker.mjs'));
  assert.equal(candidate.private_mirror.source_blob_matches,18);
  assert.equal(candidate.private_mirror.source_blob_mismatches,0);
  assert.equal(candidate.private_mirror.runner_allocated,false);
  assert.equal(candidate.private_mirror.steps_executed,0);
  assert.equal(candidate.private_mirror.test_status,'NOT_EXECUTED');
  assert.match(candidate.private_mirror.github_actions_run,/\/actions\/runs\/44857759549$/);
  for (const backend of data.backend_evidence) {
    assert.equal(backend.guest_result,'NOT_EXECUTED',backend.repo);
    assert.equal(backend.frontend_contract_status,'NOT_VERIFIED',backend.repo);
  }
});

test('JS actor compiler is explicit fail-closed, and incarnation tests do not count as guest parity',()=>{
  assert.ok(data.requirements.includes('worker_ready_reply_done_fenced_by_incarnation'));
  const js=data.candidate_subsets.find(x=>x.repository==='atto-lang/atto-source.js');
  assert.ok(js);
  assert.equal(js.status,'STAGED_UNVERIFIED');
  assert.equal(js.evidence,'ISOLATED_V8_SOURCE_TEST_6_OF_6_NOT_NODE_CI');
  assert.equal(js.steps_executed,0);
  assert.equal(js.runner_allocated,false);
  assert.ok(js.tests.includes('tests/actor-lifecycle-source-gate.test.mjs'));
  assert.ok(js.excludes.includes('continuous pipe!/rpipe! transport'));
  assert.match(js.source_head_sha,/^[a-f0-9]{40}$/);
  const [host]=data.host_protocol_candidates;
  assert.equal(data.host_protocol_candidates.length,1);
  assert.equal(host.status,'HOST_PROTOCOL_TESTED_NOT_COMPILER_GUEST_PROVEN');
  assert.equal(host.session_tests.passed,15);
  assert.equal(host.worker_protocol_tests.passed,6);
  assert.equal(host.session_tests.guest_execution,false);
  assert.equal(host.worker_protocol_tests.guest_execution,false);
  assert.equal(host.steps_executed,0);
  assert.match(host.source_head_sha,/^[a-f0-9]{40}$/);
  for(const b of data.backend_evidence)
    assert.equal(b.guest_result,'NOT_EXECUTED',b.repo);
});

test('stale worker acknowledgments cannot resolve another incarnation',()=>{
  const cases=data.adversarial_incarnation_cases;
  assert.equal(cases.length,5);
  assert.deepEqual(cases.map(x=>x.id),[
    'stale-ready','stale-data-reply','stale-done',
    'invalid-incarnation-init','cross-tenant-replayed-ack'
  ]);
  for(const c of cases){
    assert.ok(c.expected.startsWith('E_'));
    assert.ok(c.forbid);
    if(c.id==='cross-tenant-replayed-ack')assert.equal(c.execution,'NOT_EXECUTED');
    else assert.equal(c.execution,'HOST_V8_ONLY');
  }
  const candidate=data.candidate_subsets.find(x=>x.repository==='atto-lang/atto-source.rs');
  assert.match(candidate.source_head_sha,/^[a-f0-9]{40}$/);
  assert.equal(candidate.private_mirror.source_blob_matches,18);
  assert.equal(candidate.private_mirror.steps_executed,0);
  assert.equal(candidate.private_mirror.test_status,'NOT_EXECUTED');
  assert.ok(data.requirements.includes('worker_ready_reply_done_fenced_by_incarnation'));
});


test('experimental v2 guest checked-bang source never counts as proved backend parity', () => {
  const c=data.v2_guest_candidate;
  assert.equal(c.repository,'atto-lang/atto-source.rs');
  assert.match(c.pull_request,/\/pull\/262$/);
  assert.match(c.source_head_sha,/^[0-9a-f]{40}$/);
  assert.equal(c.mergeability,'CONFLICTING_WITH_MAIN');
  assert.equal(c.profile,'EXPERIMENTAL_SINGLE_GUEST_MEMORY_V2');
  assert.equal(c.status,'STAGED_GUEST_EXECUTION_NOT_VERIFIED');
  assert.equal(c.test_execution,'NOT_EXECUTED');
  assert.equal(c.guest_fixtures.length,5);
  for(const id of [230,231,232,233,234])
    assert.ok(c.guest_fixtures.some(f=>f.includes('/'+id+'-v2-')));
  assert.equal(c.compiler_tests.length,2);
  assert.equal(c.guest_runner,'tests/node-v2-pipe-guest.mjs');
  assert.equal(c.browser_runner,'tests/browser-e2e.mjs');
  assert.equal(c.verified_browser_guest_execution,false);
  assert.equal(c.verified_native_compiler_execution,false);
  assert.equal(c.external_private_source_mirror_authorized,false);
  assert.ok(c.source_policy.endsWith('/private-ci-approved-repositories.txt'));
  assert.ok(c.known_gaps.includes('source_private_ci_allowlist_empty_no_cross_org_export'));
  assert.ok(c.known_gaps.includes('current_draft_PR_has_unmerged_conflicts'));
  assert.equal(c.expected_guest_result,42);
  assert.equal(c.expected_guest_stdout,'40\n2\n');
  assert.ok(c.implementation.includes('pipe_bang_direct_two_actor_checked_Result'));
  assert.ok(c.implementation.includes('stop_bang_graceful_input_close_not_physical_completion'));
  assert.ok(c.implementation.includes('nonterminal_await_continuation_by_v2_scheduler'));
  assert.ok(c.known_gaps.includes('no_authenticated_cross_TenantVM_capabilities'));
  for(const b of data.backend_evidence) {
    assert.equal(b.guest_result,'NOT_EXECUTED',b.repo);
    assert.equal(b.frontend_contract_status,'NOT_VERIFIED',b.repo);
  }
});
