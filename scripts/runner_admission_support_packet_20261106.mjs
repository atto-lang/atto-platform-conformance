/**
 * Source-only GitHub Actions runner admission packet.
 * GET-only, no checkout, export, token disclosure, or merge decision.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const OWNER='ores-truffle-oreslang';
export const BACKENDS=['java','llvm','net','wasm','forge','js','rs','hdl','cranelift'];
export const CANDIDATES=[
  ['java',2552,'c44e0dbd2ce23bb26c46996843e532c310e248af',41958899763,1,127020277346],
  ['llvm',1443,'4d8df03d523ba1f9f77be6e658f9f633c0a903df',42250847984,1,128005195655],
  ['net',315,'0cc21189793d08c8b460a3e7b61abe9c9f109165',41584808596,1,125747685746],
  ['wasm',395,'0fbf29dd1fd8e30ae81b22521c50ae900e565c52',42247407010,2,128021238142],
  ['forge',189,'26db37477b863621404fdc614efd791e123a8cd5',42075608060,2,127717546451],
].map(([backend,pr,head,run,attempt,job])=>({backend,pr,head,run,attempt,job}));
const repo=b=>OWNER+'/oreslang-source.'+b;
const validSha=s=>typeof s==='string' && /^[0-9a-f]{40}$/.test(s);
// GitHub action setup/checkout/cleanup can complete without executing a test.
const housekeeping=/^(?:set up job|complete job|post(?: run)? .+|initialize .+|checkout|actions\/checkout(?:@.+)?|setup .+|download .+|upload .+|cleanup.*|(?:run|post run)\s+(?:actions|dtolnay|docker|ruby|pnpm|gradle)\/[^\s]+|verify exact (?:pr )?head.*)$/i;

export function assessJob(j,c){
  if(!j || typeof j!=='object' || Array.isArray(j)) return 'MISSING_JOB';
  if(j.id!==c.job || j.run_id!==c.run || j.run_attempt!==c.attempt || j.head_sha!==c.head) return 'IDENTITY_MISMATCH';
  if(j.status!=='completed') return 'NOT_COMPLETED';
  if(!Number.isSafeInteger(j.runner_id)||j.runner_id<=0||!j.runner_name?.trim?.()) return 'RUNNER_NOT_ALLOCATED';
  if(!Array.isArray(j.steps)||j.steps.length===0) return 'NO_EXECUTED_STEPS';
  if(!j.steps.some(s=>s.status==='completed'&&['success','failure'].includes(s.conclusion)&&typeof s.name==='string'&&!housekeeping.test(s.name.trim())))return 'NO_MEANINGFUL_TEST_STEP';
  if(j.conclusion==='success'&&j.steps.every(s=>['success','skipped'].includes(s.conclusion)))return 'EXECUTED_JOB_SUCCESS';
  if(j.conclusion==='failure')return 'EXECUTED_JOB_FAILURE';
  return 'INDETERMINATE';
}

export function buildPacket(s){
  if(!s||typeof s!=='object'||Array.isArray(s))throw new TypeError('snapshot must be an object');
  const sourceRepositories=BACKENDS.map(b=>{
    const v=s.branches?.[b], good=v?.name==='main'&&validSha(v?.commit?.sha);
    return {repository:repo(b), mainSha:good?v.commit.sha:null,
      protection:!good?'UNVERIFIED':v.protected===true?'PROTECTED':v.protected===false?'UNPROTECTED':'UNVERIFIED',
      requiredChecks:good&&['non_admins','everyone'].includes(v.protection?.required_status_checks?.enforcement_level)?'REPORTED_ON':'NOT_VERIFIED_ON'};
  });
  const sampledJobs=CANDIDATES.map(c=>{
    const v=s.candidates?.[c.backend];
    const pr=v?.pr,run=v?.run,jobs=v?.jobs;
    // Historical exact-head CI is still interpretable after a PR is merged.
    // Reject closed-unmerged PRs and closed/merged claims without a merge commit.
    const stateValid=(pr?.state==='open'&&pr?.merged===false)||
      (pr?.state==='closed'&&pr?.merged===true&&validSha(pr?.merge_commit_sha)&&
       typeof pr?.merged_at==='string'&&!Number.isNaN(Date.parse(pr.merged_at)));
    const validPR=pr?.number===c.pr&&pr?.head?.sha===c.head&&pr?.head?.repo?.full_name===repo(c.backend)&&pr?.base?.ref==='main'&&stateValid;
    const validRun=run?.id===c.run&&run?.head_sha===c.head&&Number.isSafeInteger(run?.run_attempt)&&run.run_attempt>=c.attempt&&run?.repository?.full_name===repo(c.backend);
    const hits=Array.isArray(jobs?.jobs)?jobs.jobs.filter(j=>j?.id===c.job):[];
    return {repository:repo(c.backend),pullRequest:'https://github.com/'+repo(c.backend)+'/pull/'+c.pr,
      originalHead:c.head,workflow:'https://github.com/'+repo(c.backend)+'/actions/runs/'+c.run,attempt:c.attempt,latestRunAttempt:validRun?run.run_attempt:null,sampledHistoricalAttempt:validRun&&run.run_attempt>c.attempt,jobId:c.job,
      assessment:!validPR?'PR_HEAD_DRIFT_OR_UNVERIFIED':!validRun?'RUN_IDENTITY_MISMATCH':hits.length!==1?'JOB_MISSING_OR_DUPLICATE':assessJob(hits[0],c)};
  });
  return {schema:'atto-source-runner-admission-support/v1',sourceOrganization:OWNER,sourceRepositories,sampledJobs,
    counts:{unprotectedMains:sourceRepositories.filter(x=>x.protection==='UNPROTECTED').length,unverifiedMains:sourceRepositories.filter(x=>x.protection==='UNVERIFIED').length,runnerNotAllocated:sampledJobs.filter(x=>x.assessment==='RUNNER_NOT_ALLOCATED').length,executedSuccessfulSampledJobs:sampledJobs.filter(x=>x.assessment==='EXECUTED_JOB_SUCCESS').length},
    authorizedToMerge:false,authorizedToExportPrivateSource:false,certifiedAttoGuestExecution:false,
    caveat:'Historical sampled runs only; no billing diagnosis, full required checks, current-head certification or independent approvals.',
    adminAction:'Inspect org Actions billing/eligibility and private runner policy, job UI admission errors, and private branch protection. Restore same-org source-free stepful canary before exact-head backend CI.'};
}


/** Reject duplicate decoded JSON authority keys and unsafe JSON before JSON.parse. */
export function parseUniqueJson(input) {
  if(typeof input!=='string'||input.length>2000000)throw new SyntaxError('invalid or oversized JSON');
  let i=0,nodes=0;const n=input.length;
  const fail=()=>{throw new SyntaxError('invalid or ambiguous GitHub JSON');};
  const ws=()=>{while(i<n&&(input[i]===' '||input[i]==='\n'||input[i]==='\r'||input[i]==='\t'))i++;};
  function quoted(){
    if(input[i]!=='"')fail();
    const begin=i++;let closed=false;
    while(i<n){
      const c=input[i++];
      if(c==='"'){closed=true;break;}
      if(c==='\\'){if(i>=n)fail();const e=input[i++];if(e==='u')i+=4;}
      else if(c.charCodeAt(0)<32)fail();
    }
    if(!closed||i>n)fail();
    let result;try{result=JSON.parse(input.slice(begin,i));}catch{fail();}
    for(let j=0;j<result.length;j++){
      const c=result.charCodeAt(j);
      if(c>=0xd800&&c<=0xdbff){const next=result.charCodeAt(++j);if(!(next>=0xdc00&&next<=0xdfff))fail();}
      else if(c>=0xdc00&&c<=0xdfff)fail();
    }
    return result;
  }
  function value(depth){
    if(depth>64||++nodes>100000)fail();
    ws();if(i>=n)fail();
    const c=input[i];
    if(c==='"'){quoted();return;}
    if(c==='{'){
      i++;ws();const keys=new Set();
      if(input[i]==='}'){i++;return;}
      while(true){
        ws();const key=quoted();if(keys.has(key))throw new SyntaxError('duplicate JSON object key');keys.add(key);
        ws();if(input[i++]!==':')fail();
        value(depth+1);ws();const sep=input[i++];
        if(sep==='}')return;if(sep!==',')fail();
      }
    }
    if(c==='['){
      i++;ws();if(input[i]===']'){i++;return;}
      while(true){value(depth+1);ws();const sep=input[i++];if(sep===']')return;if(sep!==',')fail();}
    }
    const begin=i;
    while(i<n&&![' ','\n','\r','\t',',',']','}'].includes(input[i]))i++;
    if(begin===i)fail();
    const atom=input.slice(begin,i);
    if(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(atom)){
      const num=Number(atom);
      if(!Number.isFinite(num)||(Number.isInteger(num)&&!Number.isSafeInteger(num)))fail();
    }
  }
  value(0);ws();if(i!==n)fail();return JSON.parse(input);
}

export async function fetchLiveSnapshot(token,fetchImpl=fetch){
  if(typeof token!=='string'||!token.trim())throw new Error('GITHUB_TOKEN required for private --live reads');
  const api=async(b,suffix)=>{
    const url='https://api.github.com/repos/'+repo(b)+'/'+suffix;
    const r=await fetchImpl(url,{method:'GET',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error('Allowed GitHub GET failed HTTP '+r.status);
    const cap=2000000;
    if(Number(r.headers?.get?.('content-length')??0)>cap)throw new Error('response over 2 MB');
    let bytes;
    if(r.body?.getReader){
      const reader=r.body.getReader(),chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap)throw new Error('response over 2 MB');chunks.push(value);}}
      finally{reader.releaseLock();}
      bytes=new Uint8Array(size);let pos=0;for(const x of chunks){bytes.set(x,pos);pos+=x.byteLength;}
    }else{const buffer=await r.arrayBuffer();if(buffer.byteLength>cap)throw new Error('response over 2 MB');bytes=new Uint8Array(buffer);}
    return parseUniqueJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  };
  const branches={};for(const b of BACKENDS)branches[b]=await api(b,'branches/main');
  const candidates={};for(const c of CANDIDATES)candidates[c.backend]={
    pr:await api(c.backend,'pulls/'+c.pr),run:await api(c.backend,'actions/runs/'+c.run),
    jobs:await api(c.backend,'actions/runs/'+c.run+'/attempts/'+c.attempt+'/jobs')};
  return {branches,candidates};
}

async function main(){
  const args=process.argv.slice(2);let snapshot;
  if(args.length===1&&args[0]==='--live')snapshot=await fetchLiveSnapshot(process.env.GITHUB_TOKEN);
  else if(args.length===2&&args[0]==='--snapshot')snapshot=parseUniqueJson(await readFile(args[1],'utf8'));
  else throw new Error('Usage: node scripts/runner_admission_support_packet_20261106.mjs --live | --snapshot snapshot.json');
  process.stdout.write(JSON.stringify(buildPacket(snapshot),null,2)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
