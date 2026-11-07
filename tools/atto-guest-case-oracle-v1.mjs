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
// Trusted constants transcribed from pinned draft source manifest and all 20 exact Git blobs.
const PINNED={"actor-channel-v1":{"roster":["java","llvm","net","wasm","cranelift"],"cases":{"actor-channel-roundtrip":{"sha":"bc5c42d269b3e7e6dc5f90aa648db4eab33e4870","kind":"positive","value":"42"},"channel-select-roundtrip":{"sha":"076a26cefbd816151c2a4f72ee22bce7b841561b","kind":"positive","value":"0:10"},"cancel-scoped-wait":{"sha":"5684868c9608d224545e92d39737d124af6b96d9","kind":"positive","value":"cancelled"},"reject-critical-suspends":{"sha":"06bdab0ecfc2bc1c403f143d738ce58ea614b475","kind":"negative","value":"critical.{0,100}suspends|suspends.{0,100}critical"},"reject-borrowed-thread-capture":{"sha":"d9fc34719fbc7a7b3622a67a2a9c54ca637cafd9","kind":"negative","value":"borrow|escape|owned|thread.{0,100}capture"},"reject-function-message":{"sha":"b322b46b3622f4d534cf65f9025398b8c2811396","kind":"negative","value":"sendable|serializ|closure|function.{0,100}channel"}}},"portable-task-v1":{"roster":["java","llvm","wasm","forge","net"],"cases":{"eager-before-await":{"sha":"3e1411fad3c9932b4c616a7f0d2f9b378aa3a3ad","kind":"positive","value":{"exit":42,"observe":["child_started"],"forbid":[]}},"fire-and-continue":{"sha":"3c7526ccabb1cdec84ce58e78d003700137a920a","kind":"positive","value":{"exit":42,"observe":["parent_continued","child_entered"],"forbid":[]}},"typed-int":{"sha":"3443577caabbc1acdb137dcfa3477f6dbca38096","kind":"positive","value":{"exit":42,"observe":[],"forbid":[]}},"typed-string":{"sha":"6152fc129d3b3955a2dc380153f345ec552b148c","kind":"positive","value":{"exit":42,"observe":[],"forbid":[]}},"generic-hasfuture-once":{"sha":"aa03c587c6b279cf2db312df2e32f5dc22db1552","kind":"positive","value":{"exit":42,"observe":["projection_count=1"],"forbid":[]}},"actorref-readiness":{"sha":"9eb4f6906e832a9ce57883d59a04c38f5f5e358a","kind":"positive","value":{"exit":42,"observe":["actor_ref_same=true"],"forbid":[]}},"cancel-before-start":{"sha":"c66e1777977a120de0fafa16d6137e7222dbd815","kind":"positive","value":{"exit":42,"observe":["physical_done=true"],"forbid":["should_not_start"]}},"cancel-while-suspended":{"sha":"8f200e44fb98dcf6b06bcf0bb468c27c94b512b6","kind":"positive","value":{"exit":42,"observe":["entered","physical_done=true"],"forbid":["post_cancel_forbidden"]}},"cancel-owned-descendants":{"sha":"5edd5b33ac8bcba544f0bd2ce7c56b98c4056e93","kind":"positive","value":{"exit":42,"observe":["descendants_retired=true","sibling_survived=true"],"forbid":[]}},"physical-cleanup-before-done":{"sha":"1f4087ba81b1ac696425aff6fd93bd7dbac26b15","kind":"positive","value":{"exit":42,"observe":["cleanup_once","physical_done=true"],"forbid":[]}},"reject-duck-hasfuture":{"sha":"0072db5d74cd72430b3116eef51cb7237faae901","kind":"negative","value":"ATTO_TASK_E_HASFUTURE_WITNESS"},"reject-actor-self-capture":{"sha":"297f6a5e908a36a181cd85b469031e9ac45fdcac","kind":"negative","value":"ATTO_TASK_E_ACTOR_SELF_CAPTURE"},"reject-mut-borrow-capture":{"sha":"51b5fa322b24d10a84b408b9d11e983a0beb9667","kind":"negative","value":"ATTO_TASK_E_MUT_BORROW_CAPTURE"},"reject-await-in-critical":{"sha":"5b7c4958a9e93274ed84f563da8dd8829d72ac1f","kind":"negative","value":"ATTO_TASK_E_CRITICAL_SUSPEND"}}}};
const SHA=/^[0-9a-f]{40}$/;
const ID=/^[a-z][a-z0-9-]{1,79}$/;
const CAT=/^[A-Z][A-Z0-9_]{4,127}$/;
const R=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const distinct=x=>Array.isArray(x)&&new Set(x).size===x.length;
const exactKeys=(o,keys)=>R(o)&&Object.keys(o).length===keys.length&&
  Object.keys(o).every(x=>keys.includes(x));
function fail(m){throw new TypeError(m)}
function names(a,allowed){return distinct(a)&&a.length===allowed.length&&
  allowed.every(s=>a.includes(s))}
function observations(a){
 return Array.isArray(a)&&a.length<=64&&distinct(a)&&a.every(x=>
   typeof x==='string'&&x.length>0&&x.length<=128&&
   /^[a-z][a-z0-9_=.-]*$/.test(x));
}
function inspectCase(c,suite){
 // A fixture Git blob SHA is not a substitute for an exact repository path.
 // Reject nested directories, dot segments and path aliases before orchestration.
 const fixtureDir=suite==='actor-channel-v1'
   ?'verification/fixtures/five-backend-actor-channel-v1/'
   :'fixtures/portable-task-v1/';
 if(!R(c)||!ID.test(c.id)||typeof c.fixture_path!=='string'||
   c.fixture_path!==fixtureDir+c.id+'.atto'||
    !SHA.test(c.fixture_blob_sha||'')||!R(c.expect)||
   !exactKeys(c,['id','fixture_path','fixture_blob_sha','expect']))
   fail('invalid case fixture provenance');
 const e=c.expect;
 const required=e.kind==='positive'
  ?(suite==='actor-channel-v1'
    ?['kind','expected_stdout_text','expected_stdout_hex','expected_exit_code','oracle_state']
    :['kind','expected_exit_code','required_observations','forbidden_observations','expected_stdout_hex','oracle_state'])
  :(suite==='actor-channel-v1'
    ?['kind','expected_diagnostic_pattern','expected_diagnostic_category','expected_phase','oracle_state']
    :['kind','expected_diagnostic_category','expected_phase','oracle_state']);
 if(!exactKeys(e,required))fail('unknown or missing oracle authority keys');
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
    !Array.isArray(s.evidence)||s.evidence.length!==0||
   !exactKeys(s,['schema_version','scope','as_of','required_backends','suites','evidence','note'])||
   typeof s.note!=='string'||s.note.length===0||s.note.length>2048)
   fail('invalid draft-only guest inventory');
 for(const suite of s.suites){
   const expected=SOURCES[suite.id];
   if(!exactKeys(suite,['id','source','cases'])||
     !exactKeys(suite.source,['pr','pr_head','manifest_blob_sha','original_backends'])||
     suite.source.pr!==expected.pr||
     suite.source.pr_head!==expected.head||
     suite.source.manifest_blob_sha!==expected.manifest||
     !Array.isArray(suite.source.original_backends)||
     !distinct(suite.source.original_backends)||
     suite.source.original_backends.length!==5||
     !suite.source.original_backends.every(x=>typeof x==='string'&&ID.test(x))||
     JSON.stringify(suite.source.original_backends)!==JSON.stringify(PINNED[suite.id].roster)||
     !Array.isArray(suite.cases)||!names(suite.cases.map(c=>c?.id),expected.cases))
     fail('source suite identity/coverage mismatch');
   for(const c of suite.cases){
     inspectCase(c,suite.id);
     const pinned=PINNED[suite.id].cases[c.id];
     if(!pinned||c.fixture_blob_sha!==pinned.sha||c.expect.kind!==pinned.kind)
       fail('unpinned fixture blob or kind');
     if(suite.id==='actor-channel-v1'){
       if((pinned.kind==='positive'?c.expect.expected_stdout_text:
           c.expect.expected_diagnostic_pattern)!==pinned.value)
         fail('draft oracle changed without upstream semantic review');
     }else if(pinned.kind==='positive'){
       if(c.expect.expected_exit_code!==pinned.value.exit||
          JSON.stringify(c.expect.required_observations)!==JSON.stringify(pinned.value.observe)||
          JSON.stringify(c.expect.forbidden_observations)!==JSON.stringify(pinned.value.forbid))
         fail('Task observations differ from pinned source');
     }else if(c.expect.expected_diagnostic_category!==pinned.value)
       fail('Task diagnostic differs from pinned source');
   }
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
