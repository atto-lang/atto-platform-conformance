// All five gate implementations are loaded from SHA-pinned, verified Git objects.
// Never replace a missing component with a security-decision mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPinnedFiveGates} from '../tools/merge-wave-pinned-gate-loader-v1.mjs';
import {canonicalizeMergeEvidence,canonicalizeMergeWave} from '../tools/merge-wave-canonical-evidence-v1.mjs';

const real=await loadPinnedFiveGates();
const REPO='ores-truffle-oreslang/oreslang-source.java';
const SHA='a'.repeat(40),BASE='b'.repeat(40),TREE='c'.repeat(40),DIFFERENT='d'.repeat(40);
const NOW='2026-11-06T22:30:00Z';
const clone=x=>JSON.parse(JSON.stringify(x));
const has=(r,s)=>(r.blockers??r.gaps??[]).some(v=>v.includes(s));

function fixture(mode='healthy',i=0,repo=REPO) {
  const number=7+i,root='/repos/'+repo;
  const runId=1200+i,jobId=3200+i,checkId=5200+i;
  const pr={head:{sha:SHA,repo:{full_name:repo,id:55}},
    base:{sha:BASE,ref:'main',repo:{full_name:repo,id:55}},
    state:'open',draft:false,mergeable:true,user:{id:2148448,login:'the1mills'}};
  const protection={
    enforce_admins:{enabled:true},
    required_pull_request_reviews:{require_code_owner_reviews:true,dismiss_stale_reviews:true,
      required_approving_review_count:1,bypass_pull_request_allowances:{users:[],teams:[],apps:[]}},
    required_status_checks:{strict:true,checks:[{context:'ci',app_id:77}]}
  };
  const policy={repo,base_sha:BASE,base_ref:'main',protection_readable:true,
    protected:true,require_codeowners:true,dismiss_stale_reviews:true,bypass_count:0,
    required_approvals:1,eligible_reviewer_ids:[2000012]};
  const review={id:7100+i*2,user:{id:2000012,login:'independent-reviewer'},
    state:'APPROVED',commit_id:SHA,submitted_at:'2026-11-06T22:29:00Z'};
  const reviews=[review];
  const check={id:checkId,name:'ci',head_sha:SHA,app:{id:77},
    status:'completed',conclusion:'success'};
  const run={id:runId,run_attempt:2,head_sha:SHA,repository:{id:55},
    head_repository:{id:55},event:'pull_request',status:'completed',conclusion:'success'};
  const job={id:jobId,run_id:runId,run_attempt:2,head_sha:SHA,
    runner_id:900+i,status:'completed',conclusion:'success',
    name:'host exact-head tests',steps:[{number:1,name:'Execute host test',
      status:'completed',conclusion:'success'}]};
  let asOf=NOW,branchProtected=true,policyReadable=true,checkTotal=1,runTotal=1;
  let prReads=0,commitReads=0;
  switch(mode) {
  case 'runnerless':
    run.conclusion='failure';job.runner_id=null;job.conclusion='failure';job.steps=[];break;
  case 'revoked':
    reviews.push({...review,id:review.id+1,state:'CHANGES_REQUESTED',
      submitted_at:'2026-11-06T22:29:30Z'});break;
  case 'future-review':
    review.submitted_at='2026-11-06T22:31:00Z';break;
  case 'invalid-review-calendar':
    review.submitted_at='2026-02-30T22:29:00Z';break;
  case 'duplicate-review':
    reviews.push({...review});break;
  case 'drift-final':break;
  case 'drift-tree':break;
  case 'check-count':checkTotal=2;break;
  case 'run-count':runTotal=2;break;
  case 'job-attempt':job.run_attempt=3;break;
  case 'job-head':job.head_sha=DIFFERENT;break;
  case 'invalid-clock':asOf='2026-02-30T22:30:00Z';break;
  case 'policy-unreadable':policyReadable=false;break;
  case 'main-unprotected':branchProtected=false;break;
  case 'duplicate-step':job.steps.push({...job.steps[0]});break;
  case 'no-runs':runTotal=0;break;
  case 'healthy':break;
  default:throw Error('unsupported fixture '+mode);
  }
  const reads=[];
  const get=async url=>{
    reads.push(url);
    if(url===root+'/pulls/'+number){
      prReads++;
      if(mode==='drift-final'&&prReads===6)
        return {...clone(pr),head:{...clone(pr.head),sha:DIFFERENT}};
      return clone(pr);
    }
    if(url===root+'/branches/main')return {protected:branchProtected,commit:{sha:BASE}};
    if(url===root+'/branches/main/protection'){
      if(!policyReadable)throw Object.assign(Error('policy forbidden'),{status:403});
      return clone(protection);
    }
    if(url===root+'/git/commits/'+SHA){
      commitReads++;
      return {sha:SHA,tree:{sha:mode==='drift-tree'&&commitReads===2?DIFFERENT:TREE}};
    }
    if(url===root+'/pulls/'+number+'/reviews?per_page=100&page=1')return clone(reviews);
    if(url===root+'/commits/'+SHA+'/check-runs?per_page=100&page=1')
      return {total_count:checkTotal,check_runs:[clone(check)]};
    if(url===root+'/actions/runs?head_sha='+SHA+'&per_page=100&page=1')
      return {total_count:runTotal,workflow_runs:mode==='no-runs'?[]:[clone(run)]};
    if(url===root+'/actions/runs/'+runId+'/attempts/2/jobs?per_page=100&page=1')
      return {total_count:1,jobs:[clone(job)]};
    if(url===root+'/actions/jobs/'+jobId)return clone(job);
    throw Error('unrecognized read-only GitHub path '+url);
  };
  const readReviewerPolicy=async()=>{
    if(!policyReadable)throw Object.assign(Error('no admin policy'),{status:403});
    return clone(policy);
  };
  return {repo,number,root,asOf,reads,get,readReviewerPolicy,runId,jobId};
}
const bridge=real.bindMergeWaveGates(real);
async function runCase(mode='healthy',i=0,repo=REPO){
  const f=fixture(mode,i,repo);
  const live=await real.collectLiveEvidence({repo:f.repo,number:f.number,
    get:f.get,now:()=>f.asOf});
  const audit=await bridge.auditPR({repo:f.repo,number:f.number,
    get:f.get,now:()=>f.asOf,
    readReviewerPolicy:f.readReviewerPolicy,
    trustedStepNames:['Execute host test']});
  return {...f,live,audit,canonical:canonicalizeMergeEvidence({audit,live})};
}
function invariant(r){
  assert.equal(r.live.status,'BLOCKED');
  assert.equal(r.live.merge_authorized,false);
  assert.equal(r.audit.status,'BLOCKED');
  assert.equal(r.audit.merge_authorized,false);
  assert.equal(r.audit.compiler_guest_certified,false);
  assert.equal(r.canonical.status,'BLOCKED');
  assert.equal(r.canonical.merge_authorized,false);
  assert.equal(r.canonical.guest_parity_certified,false);
  assert.equal(r.canonical.ci.execution_verified,false);
  assert.equal(r.canonical.review.independence_verified,false);
  assert(r.reads.length>=8);
  for(const url of r.reads)assert(url.startsWith(r.root+'/'),url);
}
function expected(mode,r){
  switch(mode){
  case 'healthy':
    assert.equal(r.canonical.contract_valid,true,JSON.stringify(r.canonical.blockers));
    assert.equal(r.audit.gates.review.status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
    assert(r.audit.gates.ledger.states.includes('EXECUTED_PASS'));
    assert.equal(r.live.executions[0].state,'RUNNER_EXECUTED_SUCCESS');
    assert.equal(r.canonical.ci.classification,'REPORTED_EXECUTION_UNATTESTED');
    assert.equal(r.audit.gates.qualifier.status,'BLOCKED');
    break;
  case 'runnerless':
    assert.equal(r.canonical.ci.classification,'NOT_EXECUTED');
    assert.equal(r.live.executions[0].state,'NOT_EXECUTED');
    assert(r.audit.gates.ledger.states.includes('OBSERVED_NO_STEP_FAILURE'));
    break;
  case 'revoked':assert(r.audit.gates.review.blockers.includes('REVIEW_CHANGES_REQUESTED'));break;
  case 'future-review':assert(r.audit.gates.review.blockers.includes('REVIEW_AFTER_SNAPSHOT'));break;
  case 'invalid-review-calendar':assert(r.audit.gates.review.blockers.includes('REVIEW_RECORD_INVALID'));break;
  case 'duplicate-review':
    assert(has(r.audit,'REVIEW_HISTORY_INCOMPLETE'));break;
  case 'drift-final':
    assert(has(r.audit,'PR_IDENTITY_CHANGED_DURING_COMPOSITION'));break;
  case 'drift-tree':
    assert(has(r.canonical,'GIT_IDENTITY_CONFLICT'));break;
  case 'check-count':assert(has(r.live,'CHECKS_PAGINATION_COUNT_MISMATCH'));break;
  case 'run-count':assert(has(r.live,'RUNS_PAGINATION_COUNT_MISMATCH'));break;
  case 'job-attempt':assert.equal(r.live.executions[0].state,'UNBOUND');break;
  case 'job-head':assert.equal(r.live.executions[0].state,'UNBOUND');break;
  case 'invalid-clock':assert(has(r.canonical,'OBSERVATION_TIME_INVALID'));break;
  case 'policy-unreadable':assert(has(r.audit,'PROTECTION_API_UNREADABLE'));break;
  case 'main-unprotected':assert(has(r.live,'MAIN_NOT_PROTECTED'));break;
  case 'duplicate-step':assert.equal(r.live.executions[0].state,'STEPS_MALFORMED');break;
  case 'no-runs':
    assert.equal(r.canonical.ci.classification,'UNOBSERVED');
    assert(has(r.live,'NO_WORKFLOW_RUNS'));break;
  default:throw Error('missing expected result '+mode);
  }
}
const modes=[
  'healthy','runnerless','revoked','future-review','invalid-review-calendar',
  'duplicate-review','drift-final','drift-tree','check-count','run-count',
  'job-attempt','job-head','invalid-clock','policy-unreadable','main-unprotected',
  'duplicate-step','no-runs'
];

// 17 different adversarial/positive classes * 8 distinct PR/run/job fixtures = 136 native cases.
for(let i=0;i<8;i++){
  for(const mode of modes){
    test('five genuine gates: '+mode+' / isolated attempt '+(i+1),async()=>{
      const r=await runCase(mode,i);
      invariant(r);
      expected(mode,r);
    });
  }
}
test('five-PR wave, three source repositories, all actual gates and NO merge',async()=>{
  const repos=[REPO,REPO,'ores-truffle-oreslang/oreslang-source.llvm',
    'ores-truffle-oreslang/oreslang-source.net','ores-truffle-oreslang/oreslang-source.net'];
  const pairs=[];
  for(let i=0;i<5;i++){
    const r=await runCase('healthy',i,repos[i]);
    invariant(r);expected('healthy',r);
    pairs.push({audit:r.audit,live:r.live});
  }
  const wave=canonicalizeMergeWave(pairs);
  assert.equal(wave.count,5);
  assert.equal(wave.distinct_repos,3);
  assert.equal(wave.status,'BLOCKED');
  assert.equal(wave.merge_authorized,false);
  assert.equal(wave.guest_parity_certified,false);
});
test('same-PR replays are not five distinct approvals',async()=>{
  const r=await runCase('healthy');
  const wave=canonicalizeMergeWave(Array(5).fill({audit:r.audit,live:r.live}));
  assert(wave.blockers.includes('WAVE_DUPLICATE_PR'));
  assert(wave.blockers.includes('WAVE_REPOSITORY_DIVERSITY_INVALID'));
  assert.equal(wave.merge_authorized,false);
});
test('real-gate outputs cannot be converted into a favorable envelope',async()=>{
  const r=await runCase('healthy');
  for(const field of ['merge_authorized','compiler_guest_certified']){
    const changed=clone(r.audit);changed[field]=true;
    const v=canonicalizeMergeEvidence({audit:changed,live:r.live});
    assert.equal(v.contract_valid,false);
    assert(v.blockers.includes('ADVISORY_CONTRACT_INVALID'));
    assert.equal(v.merge_authorized,false);
  }
});
test('real diagnostics preserve lowercase reason codes without admitting control bytes',async()=>{
  const r=await runCase('healthy');
  assert.equal(r.canonical.contract_valid,true);
  assert(has(r.canonical,'QUALIFIER:active_or_unknown_agent_lease'));
  const broken=clone(r.audit);broken.blockers.push('injected\ncontrol');
  const v=canonicalizeMergeEvidence({audit:broken,live:r.live});
  assert(v.blockers.includes('BLOCKER_CODES_INVALID'));
  assert(!JSON.stringify(v).includes('injected\\ncontrol'));
  assert.equal(v.merge_authorized,false);
});
