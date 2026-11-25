// Reusable API-only bridge. Never classifies a runner as hosted or a guest as executed.
import {classifyRunnerJobEvidence} from './dop-runner-job-evidence-v1.mjs';
export const CORRELATION_V1=Object.freeze({id:'attolang.ci.runner-correlation-v1',
 evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY',
 next:'INDEPENDENT_GITHUB_JOB_LOG_AND_HOSTED_RUNNER_ATTESTATION'});
const reject=s=>{throw Error(s);};
const own=(o,k,opt=false)=>{
 if(!o||typeof o!=='object'||Array.isArray(o))reject('E_OBJECT');
 const d=Object.getOwnPropertyDescriptor(o,k);
 if(!d){if(opt)return undefined;reject('E_FIELD:'+k);}
 if(!Object.hasOwn(d,'value'))reject('E_ACCESSOR:'+k);
 return d.value;
};
const pos=n=>Number.isSafeInteger(n)&&n>0;
const sha=(s,n)=>typeof s==='string'&&new RegExp('^[0-9a-f]{'+n+'}$').test(s);
function compare(a,b){
 if(!a||!b||typeof a!=='object'||typeof b!=='object')reject('E_DETAIL');
 for(const k of ['id','run_id','run_attempt','head_sha','name','status',
 'conclusion','runner_id','runner_name','started_at','completed_at',
 'runner_group_id','runner_group_name','url','run_url','html_url']){
  const x=Object.getOwnPropertyDescriptor(a,k),y=Object.getOwnPropertyDescriptor(b,k);
  if(!x&&!y&&['runner_group_id','runner_group_name','url','run_url','html_url'].includes(k))continue;
  if(!x||!y||!Object.hasOwn(x,'value')||!Object.hasOwn(y,'value')||
     !Object.is(x.value,y.value))reject('E_DETAIL:'+k);
 }
 for(const k of ['steps','labels']){
  const aList=own(a,k,k==='labels'),bList=own(b,k,k==='labels');
  if(aList===undefined&&bList===undefined)continue;
  if(aList===null&&bList===null)continue;
  if(!Array.isArray(aList)||!Array.isArray(bList)||aList.length!==bList.length||
     aList.length>(k==='steps'?256:32))reject('E_DETAIL:'+k);
  for(let i=0;i<aList.length;i++){
   if(k==='labels'){
    if(typeof aList[i]!=='string'||aList[i]!==bList[i])reject('E_DETAIL:labels');
   } else for(const field of ['name','number','status','conclusion','started_at','completed_at']){
    const x=Object.getOwnPropertyDescriptor(aList[i],field),
          y=Object.getOwnPropertyDescriptor(bList[i],field);
    if(!x||!y||!Object.hasOwn(x,'value')||!Object.hasOwn(y,'value')||
       !Object.is(x.value,y.value))reject('E_DETAIL:steps');
   }
  }
 }
}
const numEq=(x,n)=>pos(n)&&(typeof x==='number'?x===n:
 typeof x==='string'&&/^[1-9][0-9]*$/.test(x)&&Number(x)===n);
function receiptMatch(receipt,expect,job){
 if(receipt===null)return 'RECEIPT_ABSENT';
 for(const k of ['release_authorized','guestTestsExecuted','backendParity','certified',
   'waived','signed','hosted_api_verified']){
  if(Object.getOwnPropertyDescriptor(receipt,k))reject('E_RECEIPT_AUTHORITY');
 }
 if(own(receipt,'classification')!=='SOURCE_ONLY_NODE_TEST_EXECUTED_NOT_GUEST_PARITY'||
    own(receipt,'hosted_api_independent_job_step_correlation')!=='NOT_PERFORMED')
  reject('E_RECEIPT_CLASS');
 if(own(receipt,'repo')!==own(expect,'repo')||
    own(receipt,'head')!==own(expect,'headSha')||
    !numEq(own(receipt,'run_id'),own(expect,'runId'))||
    !numEq(own(receipt,'run_attempt'),own(expect,'attempt'))||
    own(receipt,'job')!==own(expect,'jobName'))reject('E_RECEIPT_IDENTITY');
 const tree=own(receipt,'tree'),digest=own(receipt,'tap_sha256');
 if(!sha(tree,40)||!sha(digest,64))reject('E_RECEIPT_HASH');
 const pinTree=own(expect,'treeSha',true),pinDigest=own(expect,'tapSha256',true);
 if(pinTree!==undefined&&(!sha(pinTree,40)||tree!==pinTree))reject('E_RECEIPT_TREE');
 if(pinDigest!==undefined&&(!sha(pinDigest,64)||digest!==pinDigest))reject('E_RECEIPT_DIGEST');
 const jobId=own(receipt,'job_id',true);
 if(jobId!==undefined&&!numEq(jobId,own(job,'id')))reject('E_RECEIPT_JOB');
 return 'SELF_REPORTED_RECEIPT_MATCH_NOT_ATTESTED';
}
export function correlateRunnerEvidence({run,pages,jobDetail,expected,perPage=100,receipt=null}){
 const pageSize=own(expected,'perPage');
 if(!pos(pageSize)||pageSize>100||perPage!==pageSize)reject('E_PAGE_SIZE');
 if(!Array.isArray(pages)||pages.length<1||pages.length>100)reject('E_PAGES');
 let total=null;const jobs=[];
 for(let i=0;i<pages.length;i++){
  const p=pages[i];
  if(own(p,'number')!==i+1)reject('E_PAGE_ORDER');
  // The caller must bind these route fields to the actual independent GET;
  // their presence alone is NOT trustworthy GitHub response provenance.
  const pinnedRoute='/repos/'+own(expected,'repo')+'/actions/runs/'+
    own(expected,'runId')+'/attempts/'+own(expected,'attempt')+
    '/jobs?per_page='+perPage+'&page='+(i+1);
  if(own(p,'requestMethod')!=='GET'||own(p,'requestHost')!=='github.com'||
     own(p,'requestPath')!==pinnedRoute)reject('E_PAGE_ROUTE');
  const response=own(p,'response'),count=own(response,'total_count'),items=own(response,'jobs');
  if(!Number.isSafeInteger(count)||count<1||count>100||!Array.isArray(items))
    reject('E_PAGE_COUNT');
  if(total===null)total=count;
  if(total!==count)reject('E_PAGE_TOTAL');
  const expectedPages=Math.ceil(total/perPage);
  if(pages.length!==expectedPages)reject('E_PAGE_INCOMPLETE');
  const size=i<expectedPages-1?perPage:total-perPage*(expectedPages-1);
  if(items.length!==size)reject('E_PAGE_LENGTH');
  jobs.push(...items);
 }
 const id=own(expected,'jobId');
 if(!pos(id))reject('E_JOB_PIN');
 const selected=jobs.find(j=>own(j,'id')===id);
 if(!selected)reject('E_JOB_MISSING');
 compare(selected,jobDetail);
 const classification=classifyRunnerJobEvidence(run,{total_count:total,jobs},expected);
 return {...classification,contract:CORRELATION_V1.id,
  correlation:'COMPLETE_JOB_LIST_AND_DETAIL_API_ONLY',
  receiptBinding:receiptMatch(receipt,expected,selected),
  independentHostedLogAttestation:false,guestExecutionProven:false,
  mergeAuthorized:false};
}
