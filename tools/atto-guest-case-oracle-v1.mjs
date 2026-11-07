// Draft-source, source-free, fail-closed case-level AttoLang guest oracle inventory.
// Neither validated structure nor attacker-supplied receipts confer execution authority.
const B=['java','llvm','wasm','forge','net'];
const SOURCES={
 'actor-channel-v1':{pr:457,head:'7d1841d0ab85765ca779674e034cd61a0d70cb26',
   manifest:'68401237c65beb48b2e3d680e01830d0afe79f51',
   cases:['actor-channel-roundtrip','channel-select-roundtrip','cancel-scoped-wait',
     'reject-critical-suspends','reject-borrowed-thread-capture','reject-function-message']},
 'portable-task-v1':{pr:465,head:'908fd95d8ad4238f539b37a63fc2840a7c495624',
   manifest:'5a53b01ad864805809d06c4747fb8a18430de77e',
   cases:['eager-before-await','fire-and-continue','typed-int','typed-string',
     'generic-hasfuture-once','actorref-readiness','cancel-before-start',
     'cancel-while-suspended','cancel-owned-descendants','physical-cleanup-before-done',
     'reject-duck-hasfuture','reject-actor-self-capture',
     'reject-mut-borrow-capture','reject-await-in-critical']}
};
const SHA=/^[0-9a-f]{40}$/;
const ID=/^[a-z][a-z0-9-]{1,79}$/;
const CAT=/^[A-Z][A-Z0-9_]{4,127}$/;
const R=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const distinct=x=>Array.isArray(x)&&new Set(x).size===x.length;
function fail(m){throw new TypeError(m)}
function names(a,allowed){return distinct(a)&&a.length===allowed.length&&
  allowed.every(s=>a.includes(s))}
function observations(a){
 return Array.isArray(a)&&a.length<=64&&distinct(a)&&a.every(x=>
   typeof x==='string'&&x.length>0&&x.length<=128&&
   /^[a-z][a-z0-9_=.-]*$/.test(x));
}
function inspectCase(c,suite){
 if(!R(c)||!ID.test(c.id)||typeof c.fixture_path!=='string'||
   !c.fixture_path.endsWith('/'+c.id+'.atto')||
   !(suite==='actor-channel-v1'?
     c.fixture_path.startsWith('verification/fixtures/five-backend-actor-channel-v1/'):
     c.fixture_path.startsWith('fixtures/portable-task-v1/'))||
   !SHA.test(c.fixture_blob_sha||'')||!R(c.expect))fail('invalid case fixture provenance');
 const e=c.expect;
 if(e.kind==='positive'){
   if(e.expected_stdout_hex!==null)fail('positive byte oracle cannot be promoted from draft');
   if(suite==='actor-channel-v1'){
     if(e.oracle_state!=='PENDING_EXACT_EXIT_STDOUT_BYTES'||
       e.expected_exit_code!==null||typeof e.expected_stdout_text!=='string'||
       e.expected_stdout_text.length>128||!e.expected_stdout_text.length)
       fail('actor stdout/exit expectation must remain pending');
   }else{
     if(e.oracle_state!=='PENDING_CANONICAL_EVENT_OUTPUT'||e.expected_exit_code!==42||
       !observations(e.required_observations)||!observations(e.forbidden_observations)||
       e.required_observations.some(x=>e.forbidden_observations.includes(x)))
       fail('Task event contract incomplete');
   }
 }else if(e.kind==='negative'){
   if(suite==='actor-channel-v1'){
     if(e.oracle_state!=='PENDING_EXACT_DIAGNOSTIC'||
       e.expected_diagnostic_category!==null||e.expected_phase!==null||
       typeof e.expected_diagnostic_pattern!=='string'||
       !e.expected_diagnostic_pattern.length||e.expected_diagnostic_pattern.length>512)
       fail('actor regex is not a targeted compiler diagnostic');
   }else{
     if(e.oracle_state!=='PENDING_EXACT_DIAGNOSTIC_PHASE'||
       !CAT.test(e.expected_diagnostic_category||'')||e.expected_phase!==null)
       fail('Task rejection phase must remain pending');
   }
 }else fail('unknown case kind');
}
export function validateGuestCaseInventory(s){
 if(!R(s)||s.schema_version!==1||s.scope!=='untrusted_draft_case_normalization'||
   typeof s.as_of!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s.as_of)||
   !Number.isFinite(Date.parse(s.as_of))||Date.parse(s.as_of)>Date.now()+300000||
   !names(s.required_backends,B)||!Array.isArray(s.suites)||s.suites.length!==2||
   !names(s.suites.map(q=>q?.id),Object.keys(SOURCES))||
   !Array.isArray(s.evidence)||s.evidence.length!==0)
   fail('invalid draft-only guest inventory');
 for(const suite of s.suites){
   const expected=SOURCES[suite.id];
   if(!R(suite.source)||suite.source.pr!==expected.pr||
     suite.source.pr_head!==expected.head||
     suite.source.manifest_blob_sha!==expected.manifest||
     !Array.isArray(suite.source.original_backends)||
     !distinct(suite.source.original_backends)||
     suite.source.original_backends.length!==5||
     !suite.source.original_backends.every(x=>typeof x==='string'&&ID.test(x))||
     !Array.isArray(suite.cases)||!names(suite.cases.map(c=>c?.id),expected.cases))
     fail('source suite identity/coverage mismatch');
   for(const c of suite.cases)inspectCase(c,suite.id);
 }
 return true;
}
export function evaluateGuestCaseInventory(s){
 validateGuestCaseInventory(s);
 const suites=s.suites.map(q=>{
   const missing=B.filter(id=>!q.source.original_backends.includes(id));
   const extra=q.source.original_backends.filter(id=>!B.includes(id));
   const cases=q.cases.map(c=>({id:c.id,fixture_sha:c.fixture_blob_sha,
     kind:c.expect.kind,oracle_state:c.expect.oracle_state,
     backend_results:Object.fromEntries(B.map(id=>[id,'NOT_EXECUTED']))}));
   return{id:q.id,source_pr:q.source.pr,source_head:q.source.pr_head,
     manifest_blob_sha:q.source.manifest_blob_sha,case_count:cases.length,
     original_roster:q.source.original_backends,missing_required_backends:missing,
     unexpected_original_backends:extra,
     positive_count:cases.filter(c=>c.kind==='positive').length,
     negative_count:cases.filter(c=>c.kind==='negative').length,
     cases};
 });
 const holds=['ALL_CASE_GUEST_RUNS_NOT_EXECUTED',
   'EXACT_POSITIVE_BYTES_NOT_ADMITTED','NEGATIVE_DIAGNOSTIC_PROVENANCE_INCOMPLETE'];
 if(suites.some(q=>q.missing_required_backends.length||q.unexpected_original_backends.length))
   holds.push('SOURCE_BACKEND_ROSTER_MISMATCH');
 return{schema_version:1,scope:'offline_advisory_not_guest_execution',
   status:'BLOCKED',release_authorized:false,required_backends:[...B],
   suite_count:suites.length,case_count:suites.reduce((n,x)=>n+x.case_count,0),
   backend_case_cells:suites.reduce((n,x)=>n+x.case_count,0)*B.length,
   executed_guest_cells:0,holds,suites,
   note:'The fixture inventory was checked for structure and pinned draft Git blobs only. This module does not compile .atto, inspect live GitHub jobs, authenticate receipts or grant guest/conformance/release PASS.'};
}
