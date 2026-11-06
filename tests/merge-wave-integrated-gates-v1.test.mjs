import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMergeWaveGates} from '../tools/merge-wave-integrated-gates-v1.mjs';
const A='a'.repeat(40), B='b'.repeat(40), T='c'.repeat(40);
const REPO='ores-truffle-oreslang/oreslang-source.java';
const PATH=`/repos/${REPO}`;
const timestamp='2026-11-06T20:00:00Z';
function harness() {
  const pr={head:{sha:A,repo:{full_name:REPO}},base:{sha:B,ref:'main',repo:{full_name:REPO}},
    state:'open',draft:false,mergeable:true,user:{id:42,login:'dev-author'}};
  const protection={enforce_admins:{enabled:true},
    required_pull_request_reviews:{require_code_owner_reviews:true,dismiss_stale_reviews:true,
      required_approving_review_count:1,bypass_pull_request_allowances:{users:[],teams:[],apps:[]}},
    required_status_checks:{strict:true,checks:[{context:'ci',app_id:15368}]}};
  const review={id:71,user:{id:73,login:'independent-reviewer'},state:'APPROVED',commit_id:A,submitted_at:timestamp};
  const run={id:200,run_attempt:2,head_sha:A,status:'completed',conclusion:'success'};
  const job={id:300,run_id:200,run_attempt:2,head_sha:A,runner_id:88,status:'completed',conclusion:'success',
    steps:[{number:1,name:'Actual guest test',status:'completed',conclusion:'success'}]};
  const calls=[],pages=[],gateInputs={},state={prReads:0,head:null,policy:null,failPath:null,live:null,
    policyResult:null,reviewResult:null,ledgerResult:null,qualifierResult:null,reviewPages:null,
    changeFinalHead:false,changeAuthor:false};
  const get=async path=>{
    calls.push(path);
    if (path===state.failPath) throw Object.assign(Error('denied'),{status:403});
    if (path===`${PATH}/pulls/7`){
      state.prReads++;
      if (state.changeFinalHead && state.prReads===2) return {...pr,head:{...pr.head,sha:T}};
      if (state.changeAuthor && state.prReads===2) return {...pr,user:{id:44,login:'other'}};
      return structuredClone(pr);
    }
    if (path===`${PATH}/branches/main/protection`) return structuredClone(state.policy??protection);
    if (path===`${PATH}/actions/jobs/300`) return structuredClone(job);
    throw Error(`unexpected GET ${path}`);
  };
  const dependencies={
    collectLiveEvidence:async args=>{
      assert.equal(args.get,get); assert.equal(args.repo,REPO); assert.equal(args.number,7);
      return state.live??{status:'BLOCKED',merge_authorized:false,guest_certified:false,
        target:{head_sha:A,base_sha:B,tree_sha:T},protection:{branch_protected:true},gaps:['TEST_RECEIPTS_UNVERIFIED']};
    },
    readPages:async (reader,path,field)=>{
      assert.equal(reader,get);pages.push({path,field});
      if (path===`${PATH}/pulls/7/reviews`)return state.reviewPages??{items:[review],complete:true,gaps:[]};
      if (path===`${PATH}/actions/runs?head_sha=${A}` && field==='workflow_runs')
        return {items:[run],complete:true,gaps:[]};
      if (path===`${PATH}/actions/runs/200/attempts/2/jobs` && field==='jobs')
        return {items:[job],complete:true,gaps:[]};
      throw Error(`unknown paginated path ${path}`);
    },
    qualifyReviewTimeline:(input,opts)=>{
      gateInputs.review={input,opts};
      return state.reviewResult??{status:'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK',blockers:[]};
    },
    collectExactHeadEvidence:async input=>{
      gateInputs.ledger=input;
      const runs=await input.listRuns(REPO,A);
      assert.equal(runs.complete,true);
      const jobs=await input.listJobs(REPO,200,2);
      assert.equal(jobs.complete,true);
      const steps=await input.listSteps(REPO,300);
      assert.equal(steps.steps[0].name,'Actual guest test');
      return state.ledgerResult??{complete:true,records:[{state:'EXECUTED_PASS'}],gaps:[]};
    },
    qualifyCandidate:(input,time)=>{
      gateInputs.qualifier={input,time};
      return state.qualifierResult??[{kind:'test',reason:'scope_specific_positive_and_negative_receipts_missing'}];
    }
  };
  return {pr,run,job,review,protection,calls,pages,state,gateInputs,get,dependencies,
    policyReader:async ({repo,base_sha})=>({repo,base_sha,base_ref:'main',protected:true,protection_readable:true,
      require_codeowners:true,dismiss_stale_reviews:true,bypass_count:0,required_approvals:1,eligible_reviewer_ids:[73]}),
    audit:(options={})=>bindMergeWaveGates(dependencies).auditPR({repo:REPO,number:7,get,
      now:()=>timestamp,scope:'compiler',trustedStepNames:['Actual guest test'],...options})};
}
function includes(x,part){return x.blockers.some(s=>s.includes(part));}
test('composition invokes all five versioned gate functions without authorizing a merge',async()=>{
  const h=harness(),v=await h.audit({readReviewerPolicy:h.policyReader});
  assert.equal(v.status,'BLOCKED');assert.equal(v.merge_authorized,false);
  assert.equal(v.compiler_guest_certified,false);
  assert.deepEqual(v.target,{repo:REPO,number:7});
  assert.equal(v.gates.live.status,'BLOCKED');assert.equal(v.gates.review.status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(v.gates.ledger.complete,true);assert.equal(v.gates.qualifier.status,'BLOCKED');
  assert(includes(v,'TEST_RECEIPTS_AND_AGENT_LEASE_NOT_VERIFIED'));
  assert(includes(v,'REVIEWER_ROSTER_PROVENANCE'));
  assert.deepEqual(h.gateInputs.review.input.reviews,[{id:71,reviewer_id:73,login:'independent-reviewer',state:'APPROVED',commit_sha:A,submitted_at:timestamp}]);
  assert.deepEqual(h.gateInputs.qualifier.input.test_receipts,[]);
  assert.equal(h.gateInputs.qualifier.input.head_tree_sha,T);
});
test('all cross-gate identifiers and observation timestamp are pinned',async()=>{
  const h=harness();await h.audit({readReviewerPolicy:h.policyReader});
  const input=h.gateInputs.review.input;
  assert.equal(input.head_sha,A);assert.equal(input.base_sha,B);
  assert.equal(input.author_id,42);assert.equal(input.review_count,1);
  assert.equal(input.as_of,timestamp);
  assert.equal(h.gateInputs.ledger.head,A);
  assert.equal(h.gateInputs.qualifier.time,Date.parse(timestamp));
});
test('adapter refuses missing one of the five component gate functions',()=>{
  const h=harness();for(const name of Object.keys(h.dependencies)){
    const broken={...h.dependencies};delete broken[name];
    assert.throws(()=>bindMergeWaveGates(broken),/five versioned/);
  }
});
test('adapter refuses injected nonfunction and malformed object',()=>{
  const h=harness();assert.throws(()=>bindMergeWaveGates(null));
  assert.throws(()=>bindMergeWaveGates({...h.dependencies,qualifyCandidate:true}));
});
test('rejects unknown repos, bad PR number, unknown scope and unreviewed step name',async()=>{
  const h=harness(),adapter=bindMergeWaveGates(h.dependencies);
  await assert.rejects(()=>adapter.auditPR({repo:'evil/source.java',number:7,get:h.get}));
  await assert.rejects(()=>adapter.auditPR({repo:REPO,number:0,get:h.get}));
  await assert.rejects(()=>adapter.auditPR({repo:REPO,number:7,get:h.get,scope:'guest_certified'}));
  await assert.rejects(()=>adapter.auditPR({repo:REPO,number:7,get:h.get,trustedStepNames:['']}));
  await assert.rejects(()=>adapter.auditPR({repo:REPO,number:7,get:h.get,trustedStepNames:[5]}));
});
test('unknown reviewer policy blocks even if review gate mock returned qualified',async()=>{
 const h=harness(),v=await h.audit();assert(includes(v,'REVIEWER_ROSTER_OR_POLICY_UNVERIFIED'));
 assert.equal(h.gateInputs.review.input.reviewer_policy,null);
});
test('provider substitution of another base SHA fails closed',async()=>{
 const h=harness(),v=await h.audit({readReviewerPolicy:async()=>({repo:REPO,base_sha:T})});
 assert(includes(v,'REVIEWER_ROSTER_OR_POLICY_UNVERIFIED'));
});
test('provider exception is not silently accepted',async()=>{
 const h=harness(),v=await h.audit({readReviewerPolicy:async()=>{throw Error('no admin rights')}});
 assert(includes(v,'REVIEW_POLICY_PROVIDER_FAILED'));
});
test('a malformed reviewer history never promotes favorable review gate status',async()=>{
 const h=harness();h.state.reviewPages={items:[],complete:false,gaps:['PAGE_LIMIT']};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'REVIEW_HISTORY_INCOMPLETE'));
 assert.equal(h.gateInputs.review.input.reviews_complete,false);
});
test('stale PR HEAD changed after collection gets a specific blocker',async()=>{
 const h=harness();h.state.changeFinalHead=true;
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'PR_IDENTITY_CHANGED_DURING_COMPOSITION'));
});
test('author change despite same SHA is detected as inconsistency',async()=>{
 const h=harness();h.state.changeAuthor=true;
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'PR_IDENTITY_CHANGED_DURING_COMPOSITION'));
});
test('collector returning favorable merge_authorized is a contract violation',async()=>{
 const h=harness();h.state.live={status:'PASS',merge_authorized:true,guest_certified:true,target:{head_sha:A,base_sha:B}};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'LIVE_COLLECTOR_IDENTITY_OR_CONTRACT_MISMATCH'));
 assert.equal(v.merge_authorized,false);
});
test('collector head from another PR blocks even if run ledger claims pass',async()=>{
 const h=harness();h.state.live={status:'BLOCKED',merge_authorized:false,guest_certified:false,
 target:{head_sha:T,base_sha:B,tree_sha:T},protection:{branch_protected:true},gaps:[]};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'LIVE_COLLECTOR_IDENTITY_OR_CONTRACT_MISMATCH'));
});
test('ledger gates can be incomplete independently of the collector',async()=>{
 const h=harness();h.state.ledgerResult={complete:false,records:[{state:'UNOBSERVED'}],gaps:[{kind:'STEPS_UNOBSERVED'}]};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'LEDGER_INVENTORY_INCOMPLETE'));
 assert(includes(v,'LEDGER_EXECUTION_NOT_PROVEN'));
 assert(includes(v,'LEDGER:STEPS_UNOBSERVED'));
});
test('review gate exception cannot disable blocking',async()=>{
 const h=harness();h.dependencies.qualifyReviewTimeline=()=>{throw Error('boom')};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'REVIEW_GATE_FAILED'));
});
test('ledger gate exception cannot disable blocking',async()=>{
 const h=harness();h.dependencies.collectExactHeadEvidence=()=>{throw Error('boom')};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'LEDGER_GATE_FAILED'));
});
test('qualifier gate exception cannot disable blocking',async()=>{
 const h=harness();h.dependencies.qualifyCandidate=()=>{throw Error('boom')};
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'QUALIFIER_GATE_FAILED'));
});
test('even a forged favorable qualifier cannot authorize merge',async()=>{
 const h=harness();h.state.qualifierResult=[];
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert.equal(v.merge_authorized,false);
 assert(includes(v,'QUALIFIER_UNEXPECTEDLY_FAVORABLE_WITHOUT_RECEIPTS'));
});
test('protection read 403 creates explicit incomplete governance blocker',async()=>{
 const h=harness();h.state.failPath=`${PATH}/branches/main/protection`;
 const v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'PROTECTION_API_UNREADABLE'));
 assert.equal(h.gateInputs.qualifier.input.protection.protected,false);
});
test('reviewer roster is not implicitly trusted as cryptographic authority',async()=>{
 const h=harness(),v=await h.audit({readReviewerPolicy:h.policyReader});
 assert(includes(v,'REVIEWER_ROSTER_PROVENANCE_REQUIRES_INDEPENDENT_VERIFICATION'));
});
test('integrated ledger adapter uses exact run attempt and individually fetched job steps',async()=>{
 const h=harness();await h.audit({readReviewerPolicy:h.policyReader});
 assert(h.pages.some(p=>p.path===`${PATH}/actions/runs/200/attempts/2/jobs`));
 assert(h.calls.includes(`${PATH}/actions/jobs/300`));
});
test('candidate includes unknown lease and no unverified compiler receipts',async()=>{
 const h=harness();await h.audit({readReviewerPolicy:h.policyReader});
 const c=h.gateInputs.qualifier.input;
 assert.deepEqual(c.test_receipts,[]);assert.equal(c.lease.expires_at,'UNVERIFIED');
 assert.equal(c.scope,'compiler');
});
test('candidate maps branch governance readback into exact protection requirements',async()=>{
 const h=harness();await h.audit({readReviewerPolicy:h.policyReader});
 const p=h.gateInputs.qualifier.input.protection;
 assert.equal(p.require_codeowners,true);assert.equal(p.dismiss_stale_reviews,true);
 assert.equal(p.bypass_count,0);assert.equal(p.enforce_admins,true);
 assert.equal(p.strict_checks,true);
});
test('bypass lists and missing policy cannot be treated as empty',async()=>{
 const h=harness();h.state.policy={...h.protection,required_pull_request_reviews:{...h.protection.required_pull_request_reviews,
   bypass_pull_request_allowances:undefined}};
 await h.audit({readReviewerPolicy:h.policyReader});
 assert.equal(h.gateInputs.qualifier.input.protection.bypass_count,-1);
});
test('manual malformed timestamp still returns a BLOCKED audit',async()=>{
 const h=harness();const x=await h.audit({now:()=> 'today'});
 assert.equal(x.status,'BLOCKED');assert(includes(x,'SNAPSHOT_TIME_UNOBSERVED'));
});
test('exact wave rejects four candidates',async()=>{
 const h=harness(),adapter=bindMergeWaveGates(h.dependencies);
 await assert.rejects(()=>adapter.auditWave({targets:Array(4).fill({repo:REPO,number:7}),get:h.get}));
});
test('exact wave rejects five duplicate PRs',async()=>{
 const h=harness(),adapter=bindMergeWaveGates(h.dependencies);
 await assert.rejects(()=>adapter.auditWave({targets:Array(5).fill({repo:REPO,number:7}),get:h.get}));
});
test('exact wave rejects five PRs across only two repos',async()=>{
 const h=harness(),adapter=bindMergeWaveGates(h.dependencies);
 const targets=Array.from({length:5},(_,i)=>({repo:i<3?REPO:'ores-truffle-oreslang/oreslang-source.llvm',number:i+1}));
 await assert.rejects(()=>adapter.auditWave({targets,get:h.get}));
});
test('GETs are always source repo API paths and never a mutation',async()=>{
 const h=harness();await h.audit({readReviewerPolicy:h.policyReader});
 assert(h.calls.every(x=>x.startsWith(`/repos/${REPO}/`)));
});
test('read-only audit result does not expose a token or return authorization',async()=>{
 const h=harness(),x=await h.audit({readReviewerPolicy:h.policyReader});
 assert.equal(JSON.stringify(x).includes('GH_TOKEN'),false);
 assert.equal(x.merge_authorized,false);
 assert.equal(x.compiler_guest_certified,false);
});
