// This verifier checks a design-evidence manifest, never actual CI/guest origins.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const SHA = /^[0-9a-f]{40}$/;
const read = path => readFileSync(new URL('../../'+path, import.meta.url));
function blobSha(contents) {return createHash('sha1').update('blob '+contents.length+'\0').update(contents).digest('hex');}
const keys = (o) => Object.keys(o).sort();
const exact = (o, expected, reason) => {
 assert(o !== null && typeof o === 'object' && !Array.isArray(o), reason);
 assert.deepEqual(keys(o), [...expected].sort(), reason);
};
export function assertDesignManifest(m, programContents) {
 exact(m,['schemaVersion','contract','evidenceLevel','verifiedCompilerGuestBackends',
  'traceVerifier','guestFixture','relatedFormalPullRequests','scenarios','backends',
  'requiredAuthentication','notEstablishedByReplay','mergeEligible'], 'manifest field shape');
 assert.equal(m.schemaVersion,1);
 assert.equal(m.contract,'attolang.formal-actor-runtime-refinement.v1');
 assert.equal(m.evidenceLevel,'design-trace-shape-only');
 assert.deepEqual(m.verifiedCompilerGuestBackends,[]);
 assert.equal(m.traceVerifier,'formal/refinement-v1/replay.mjs');
 exact(m.guestFixture,['path','gitBlobSha1','status','dialect','expectedStdout',
  'candidateOrigin','priorDialectConflict'], 'guest fixture shape');
 assert.equal(m.guestFixture.path,'formal/refinement-v1/reliable-join-receive.atto');
 assert.equal(m.guestFixture.status,'CANDIDATE_NOT_COMPILED');
 assert.equal(m.guestFixture.dialect,'suspends');
 assert.equal(m.guestFixture.expectedStdout,'subscribed|p-1');
 assert.equal(m.guestFixture.candidateOrigin,'contracts/v1/message-data-310/fixtures/P03-topic-string.atto');
 assert.equal(m.guestFixture.priorDialectConflict,
  'earlier candidate uses retired pub async routine; this file proposes pub suspends fnc, compiler admission unverified');
 assert(SHA.test(m.guestFixture.gitBlobSha1));
 assert.equal(m.guestFixture.gitBlobSha1, blobSha(programContents),'fixture blob drift');
 assert(programContents.toString('utf8').includes('pub suspends fnc main()'), 'missing candidate entrypoint');
 assert(!programContents.toString('utf8').includes('pub async routine'), 'legacy async admitted');
 const knownHeads={
  actorCriticalGeneration:[458,'36756f78d0b1a07c0733f32e8e45507ddb9b1582'],
  panicControl:[459,'c31a04e1d6c3ee70b4df2486cc2ee375e047b887'],
  reliablePubsub:[460,'1c18689718d6648b533685fcf3aa0886c33f619f'],
  pubsubGeneration:[461,'677344370305f1d90fbc987536d008de0af8c794']
 };
 exact(m.relatedFormalPullRequests,Object.keys(knownHeads),'formal model identity list');
 for (const [name, [number, head]] of Object.entries(knownHeads)) {
  exact(m.relatedFormalPullRequests[name],['number','head'], 'model identity shape: '+name);
  assert.equal(m.relatedFormalPullRequests[name].number,number,'model number binding: '+name);
  assert.equal(m.relatedFormalPullRequests[name].head,head,'model head binding: '+name);
 }
 assert.deepEqual(m.scenarios,['critical-generation','panic-control','reliable-pubsub']);
 exact(m.backends,['java','llvm','net','wasm','forge'], 'backend roster');
 for (const [name,status] of Object.entries(m.backends)) {
  exact(status,['status','guestCompiled','guestExecuted','executedSteps'],'backend receipt shape: '+name);
  assert.deepEqual(status, {status:'NOT_EXECUTED',guestCompiled:false,
    guestExecuted:false,executedSteps:0}, 'backend NOT_EXECUTED contract: '+name);
 }
 assert.deepEqual(m.requiredAuthentication,[
  'source_org_job_steps_with_positive_runner_id_and_matching_run_attempt',
  'compiler_and_runtime_artifact_digests_read_back_from_authoritative_provider',
  'exact_backend_source_head_and_git_tree_identity',
  'guest_fixture_blob_identity_and_actual_compiler_exit_status',
  'runtime_trace_or_diagnostic_bound_to_real_compiled_guest',
  'reviewed_nonzero_step_receipt_with_negative_cases',
  'untrusted_guest_trace_shape_is_never_self_authenticating'
 ],'authentication requirements cannot be silently weakened');
 assert.deepEqual(m.notEstablishedByReplay,[
  'real_AttoLang_guest_compilation',
  'actual_backend_actor_scheduling',
  'actor_memory_and_physical_stack_isolation',
  'nonblocking_carrier_threads_under_RELIABLE_backpressure',
  'unbounded_model_checking_or_cross_backend_parity',
  'merge_readiness_or_independent_approval'
 ],'non-proof limitations cannot be silently weakened');
 assert.equal(m.mergeEligible,false);
 return {classification:'DESIGN_TRACE_SHAPE_ONLY',verifiedGuestBackends:0,cases:m.scenarios.length};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const m=JSON.parse(read('formal/refinement-v1/manifest.json'));
 console.log(JSON.stringify(assertDesignManifest(m,read(m.guestFixture.path))));
}
