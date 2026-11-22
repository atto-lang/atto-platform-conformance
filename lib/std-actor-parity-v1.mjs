// Source-level std.actor parity contract. Never a compiler/runtime conformance claim.
import { readFileSync } from 'node:fs';
const expectedNames = ["atto","cranelift","forge","hdl","java","js","llvm","net","realtime","rs","wasm"];
const expectedPolicies = ["actor_mailbox_admissible","actor_future_transition_valid","actor_lifecycle_transition_valid","actor_should_restart","actor_restart_first","actor_restart_end_exclusive","actor_restart_budget_allows","actor_next_generation","actor_failure_notifies_supervisor","actor_cancel_request_admissible","actor_stop_request_admissible","actor_stop_completion_admissible","actor_restart_generation_admissible","actor_supervisor_notice_admissible","actor_reply_admissible"];
const expectedPRs = {"atto":null,"cranelift":99,"forge":234,"hdl":68,"java":1782,"js":139,"llvm":880,"net":225,"realtime":null,"rs":543,"wasm":288};
const requireTrue=(test,msg)=>{if(!test)throw Error(msg)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const forbiddenPromotion=new Set(["PASS","FAIL","UNSUPPORTED"]);
export function readStdActorParity(path=new URL('../contracts/std-actor-parity-v1.json',import.meta.url)){
  return JSON.parse(readFileSync(path,'utf8'));
}
export function validateStdActorParity(m) {
  requireTrue(m && typeof m==='object' && !Array.isArray(m),'contract object required');
  requireTrue(m.schema==='atto.std-actor-parity/1' && m.status==='SOURCE_CONTRACT_ONLY','version or fake certification');
  requireTrue(m.sourceNamespace==='std.actor' && m.optionalRuntimeProfile==='atto.runtime.actor'
    && m.namespaceRelationship==='separate-source-namespace-and-optional-runtime-capability-not-implicit-alias','actor namespace/runtime-profile confusion');
  requireTrue(m.sourceFormat==='.atto' && m.sourceOwnership==='independent-per-compiler'
    && m.noRuntimeFallback===true,'source ownership or fallback widened');
  requireTrue(same(m.layers,{coreActorDependency:false,allocActorDependency:false,stdActorDependency:false,actorCapabilityExplicit:true}),
    'Core/Alloc/Std cannot import actors implicitly');
  requireTrue(same(m.api?.policy,expectedPolicies),'actor API accidentally changed');
  requireTrue(same(m.api?.futures,[
    {name:"await_reply",formal:"take! ActorFuture<T>",returns:"T",settlement:"one-shot-owned-result"},
    {name:"await_reply_result",formal:"take! ActorFuture<Result<T,E>>",returns:"Result<T,E>",settlement:"one-shot-preserve-result"}
  ]),'affine Future ownership weakened');
  requireTrue(same(m.api?.lifecycleStates,{created:0,starting:1,running:2,stopping:3,stopped:4,failed:5}),'lifecycle identity changed');
  requireTrue(same(m.api?.futureStates,{pending:0,success:1,cancelled:2,failed:3,panicked:4}),'future terminal statuses changed');
  requireTrue(same(m.api?.restartPolicy,{permanent:1,transient:2,temporary:3}) &&
    same(m.api?.restartStrategy,{one_for_one:1,one_for_all:2,rest_for_one:3}) &&
    same(m.api?.failureKinds,{throw:1,raise:2,panic:3}),'restart or CONTROL classification changed');
  requireTrue(same(m.api?.mailboxCapacityBounds,[1,65536]) && m.api.restartMaximumChildren===4096
    && same(m.api.restartGenerationRange,[1,2147483647]),'bounded actor capacity changed');
  const guarded=["guestBooleansNeverCreateCapabilities","priorityControlAuthenticatedByHost","staleActorGenerationDenied",
    "restartRequiresPhysicalOldTurnRetirement","noActorResurrectionWithinGeneration","terminalFutureCannotResettle",
    "borrowedOrDoubleAwaitRejectedBeforeArtifact","actorReplyMaySettleBeforeActorRetirement",
    "actorDoneRequiresPhysicalQuiescence","actorStreamIsNotUnaryFuture","resultNotImplicitlyUnwrapped",
    "noImplicitRuntimeInCoreAllocStd","unsupportedMustEmitExplicitDiagnostic"];
  requireTrue(same(Object.keys(m.invariants||{}),guarded) && guarded.every(k=>m.invariants[k]===true),
    'unreviewed privilege or physical completion downgrade');
  requireTrue(same(m.guestTests,{
    smoke:{path:"stdlib/actor/guest_smoke.atto",assertions:34,expectedMain:42},
    boundaries:{path:"stdlib/actor/guest_edges.atto",assertions:133,expectedMain:42},
    futurePositive:"contracts/std-actor-v1/future-owned.accept.atto",
    futureNegative:["contracts/std-actor-v1/future-borrowed.reject.atto","contracts/std-actor-v1/future-double-await.reject.atto"],
    runtimeTarget:"tests/fixtures/std-actor-v1/lifecycle_guest.atto",
    namespacePositive:{path:"stdlib/actor/guest_namespace_only.atto",expectedMain:42,noImplicitImports:true},
    namespaceNegative:[{"file":"contracts/std-actor-v1/namespace-implicit-import.reject.atto","expectedDiagnostic":"E_UNBOUND","requires":"explicit-policy-import"},{"file":"contracts/std-actor-v1/namespace-duplicate.reject.atto","expectedDiagnostic":"E_DUPLICATE","requires":"single-file-namespace"},{"file":"contracts/std-actor-v1/namespace-after-declaration.reject.atto","expectedDiagnostic":"E_SYNTAX","requires":"namespace-first"}]
  }), 'guest corpus counts or boundaries changed');
  requireTrue(same(m.statuses,["PASS","FAIL","UNSUPPORTED","NOT_IMPLEMENTED","NOT_EXECUTED"]),
    'missing unsupported/not-executed distinction');
  requireTrue(same(m.verificationRequired,["source_head_sha","root_tree_sha","policy_blob_sha","guest_blob_sha","compiler_identity","target_identity","positive_guest_execution","negative_no_artifact","runtime_control_authentication","physical_quiescence","executed_job_steps","independent_receipt_review"]),
    'actual guest proof requirements weakened');
  requireTrue(same(Object.keys(m.backends||{}),expectedNames),'all eleven backend slots required, in canonical order');
  for(const [name,pr] of Object.entries(expectedPRs)){
    const b=m.backends[name],bootstrap=pr===null;
    requireTrue(b && Object.keys(b).length===4 && b.repo==='atto-lang/atto-source.'+name
      && b.pr===pr && b.contractStatus===(bootstrap?'NOT_IMPLEMENTED':'NOT_EXECUTED')
      && b.reason===(bootstrap?'bootstrap_repository_no_compiler':'source_candidate_unverified'),
      'unverified actor evidence promoted or backend identity changed: '+name);
    requireTrue(!forbiddenPromotion.has(b.contractStatus),'forged PASS/FAIL/UNSUPPORTED');
  }
  return true;
}
