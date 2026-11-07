// Read-only canonical evidence envelope; never grants merger or compiler authority.
const SHA=/^[a-f0-9]{40}$/;
const REPO=/^ores-truffle-oreslang\/(?:oreslang-source\.(?:java|llvm|net|wasm|forge|cranelift|js|rs|hdl)|oreslang-platform\.(?:mobile|iot|embedded|desktop|asic|fpga)|oreslang-platform-conformance)$/;
const UTC=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const STATES=new Set(['NOT_EXECUTED','RUNNER_EXECUTED_SUCCESS','RUNNER_EXECUTED_NON_SUCCESS','UNBOUND','STEPS_UNOBSERVED','STEPS_UNBOUNDED','STEPS_MALFORMED','NO_PROVEN_RUNNER','NO_MEANINGFUL_STEP']);
const id=x=>Number.isSafeInteger(x)&&x>0;
const sha=x=>typeof x==='string'&&SHA.test(x);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value'));
const utc=x=>{
 if(typeof x!=='string')return false;
 const m=UTC.exec(x);if(!m)return false;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
 const leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return y>0&&mo>=1&&mo<=12&&d>=1&&d<=days[mo-1]&&
  Number(m[4])<=23&&Number(m[5])<=59&&Number(m[6])<=59&&Number.isFinite(Date.parse(x));
};
const codes=x=>Array.isArray(x)&&x.length<=512&&x.every(v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:\-]{0,159}$/.test(v));
const shell=()=>({repo:null,number:null,head_sha:null,base_sha:null,tree_sha:null,observed_at:null});
const output=(bad,target,reviewComplete,ciClass,jobs,gaps)=>({
 schema_version:1,kind:'ATTO_CANONICAL_MERGE_EVIDENCE_V1',
 status:'BLOCKED',merge_authorized:false,guest_parity_certified:false,
 contract_valid:bad.length===0,target,
 review:{history_complete:reviewComplete,independence_verified:false},
 ci:{classification:ciClass,execution_verified:false,jobs},
 evidence_class:'UNATTESTED_READ_ONLY_SNAPSHOT',
 blockers:[...new Set([...bad,...gaps,'AUTHENTICATED_REVIEW_AND_POLICY_REQUIRED',
 'EXECUTED_RECEIPTS_AND_GUEST_PARITY_UNVERIFIED','RELEASE_AUTHORIZATION_UNAVAILABLE'])].sort()
});
export function canonicalizeMergeEvidence(input){
 const failures=new Set(),target=shell(),jobs=[];
 let reviewComplete=false,ciClass='UNOBSERVED',gaps=[];
 const fail=c=>failures.add(c);
 try {
  if(!record(input)||!record(input.audit)||!record(input.live)){
   fail('INPUT_SHAPE_INVALID');return output([...failures],target,reviewComplete,ciClass,jobs,gaps);
  }
  const a=input.audit,l=input.live;
  if(a.schema_version!==1||a.status!=='BLOCKED'||a.merge_authorized!==false||
     a.compiler_guest_certified!==false||l.schema!==1||l.status!=='BLOCKED'||
     l.merge_authorized!==false||l.guest_certified!==false)fail('ADVISORY_CONTRACT_INVALID');
  if(!record(a.target)||!record(a.facts)||!record(l.target)){
   fail('IDENTITY_FIELDS_INVALID');return output([...failures],target,reviewComplete,ciClass,jobs,gaps);
  }
  if(typeof a.target.repo==='string'&&REPO.test(a.target.repo)&&id(a.target.number)&&a.target.number<=1000000){
   target.repo=a.target.repo;target.number=a.target.number;
  }else fail('TARGET_INVALID');
  if(l.target.repo!==target.repo||l.target.number!==target.number)fail('TARGET_CONFLICT');
  if(sha(a.facts.head_sha)&&sha(a.facts.base_sha)&&sha(a.facts.tree_sha)){
   target.head_sha=a.facts.head_sha;target.base_sha=a.facts.base_sha;target.tree_sha=a.facts.tree_sha;
  }else fail('GIT_IDENTITY_INVALID');
  if(l.target.head_sha!==target.head_sha||l.target.base_sha!==target.base_sha||
     l.target.tree_sha!==target.tree_sha)fail('GIT_IDENTITY_CONFLICT');
  if(!utc(a.observed_at)||!utc(l.as_of))fail('OBSERVATION_TIME_INVALID');
  else if(a.observed_at!==l.as_of)fail('OBSERVATION_EPOCH_MISMATCH');
  else target.observed_at=a.observed_at;
  if(!record(a.gates)||!record(a.gates.review)||!record(l.reviews)||
     typeof l.reviews.complete!=='boolean'||!Number.isSafeInteger(l.reviews.observed)||
     l.reviews.observed<0)fail('REVIEW_EVIDENCE_INVALID');
  else {reviewComplete=l.reviews.complete;if(!reviewComplete)fail('REVIEW_HISTORY_INCOMPLETE');}
  if(!record(l.check_runs)||l.check_runs.complete!==true||
     !record(l.workflow_runs)||l.workflow_runs.complete!==true)fail('CI_INVENTORY_INCOMPLETE');
  if(!codes(l.gaps)||!codes(a.blockers))fail('BLOCKER_CODES_INVALID');
  else gaps=[...new Set([...l.gaps.map(s=>'LIVE:'+s),...a.blockers.map(s=>'INTEGRATED:'+s)])].slice(0,1024);
  if(!Array.isArray(l.executions)||l.executions.length>256)fail('JOB_INVENTORY_INVALID');
  else {
   const seen=new Set(),jobIds=new Set();let absent=0,reported=0;
   for(const e of l.executions){
    if(!record(e)||!id(e.run_id)||!id(e.attempt)||!id(e.job_id)||!STATES.has(e.state)||
       !(e.runner_id===null||e.runner_id===0||id(e.runner_id))||
       !(e.steps_count===null||(Number.isSafeInteger(e.steps_count)&&e.steps_count>=0&&e.steps_count<=128))){
     fail('JOB_ENTRY_INVALID');continue;
    }
    const key=[e.run_id,e.attempt,e.job_id].join(':');
    if(seen.has(key)||jobIds.has(e.job_id)){fail('JOB_IDENTITY_DUPLICATE');continue;}
    seen.add(key);jobIds.add(e.job_id);
    const runner=id(e.runner_id)?e.runner_id:null;
    const missing=e.state==='NOT_EXECUTED'&&runner===null&&(e.steps_count===0||e.steps_count===null);
    const success=e.state==='RUNNER_EXECUTED_SUCCESS'&&runner!==null&&e.steps_count>0;
    if((e.state==='NOT_EXECUTED'&&!missing)||(e.state==='RUNNER_EXECUTED_SUCCESS'&&!success))
     fail('JOB_EVIDENCE_CONTRADICTORY');
    if(missing)absent++;if(success)reported++;
    jobs.push({run_id:e.run_id,attempt:e.attempt,job_id:e.job_id,
      runner_id:runner,steps_count:e.steps_count,state:e.state,
      evidence_class:missing?'NOT_EXECUTED':success?'REPORTED_SUCCESS_UNATTESTED':'INCOMPLETE'});
   }
   jobs.sort((a,b)=>a.run_id-b.run_id||a.attempt-b.attempt||a.job_id-b.job_id);
   ciClass=!jobs.length?'UNOBSERVED':absent===jobs.length?'NOT_EXECUTED':
    reported>0?'REPORTED_EXECUTION_UNATTESTED':'MIXED_OR_INCOMPLETE';
  }
 }catch{fail('SNAPSHOT_EVALUATION_FAILED');}
 return output([...failures].sort(),target,reviewComplete,ciClass,jobs,gaps);
}
export function canonicalizeMergeWave(items){
 const issues=new Set(),records=[],repos=new Set(),identities=new Set();
 if(!Array.isArray(items)||items.length!==5)issues.add('WAVE_CARDINALITY_INVALID');
 for(const entry of (Array.isArray(items)?items.slice(0,6):[])){
  const item=canonicalizeMergeEvidence(entry);records.push(item);
  if(!item.contract_valid)issues.add('WAVE_MEMBER_CONTRACT_INVALID');
  if(item.target.repo&&item.target.number){
   const key=item.target.repo+'#'+item.target.number;
   if(identities.has(key))issues.add('WAVE_DUPLICATE_PR');
   identities.add(key);repos.add(item.target.repo);
  }else issues.add('WAVE_MEMBER_IDENTITY_INVALID');
 }
 if(repos.size<3)issues.add('WAVE_REPOSITORY_DIVERSITY_INVALID');
 return {schema_version:1,kind:'ATTO_CANONICAL_MERGE_WAVE_V1',
 status:'BLOCKED',merge_authorized:false,guest_parity_certified:false,
 count:records.length,distinct_repos:repos.size,items:records,
 blockers:[...new Set([...issues,'INDEPENDENT_APPROVAL_AND_EXECUTION_GATES_REQUIRED'])].sort()};
}
