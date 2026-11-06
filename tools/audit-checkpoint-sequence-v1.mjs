// Source-free checkpoint integrity checker. Hash linkage is tamper-evident only when
// the previous digest is kept independently; it is NOT an authenticated signature.
import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function timestamp(s){if(typeof s!=='string'||!ISO.test(s))return null;const t=Date.parse(s);return Number.isFinite(t)&&new Date(t).toISOString().replace('.000Z','Z')===s?t:null;}
const issue=(code,detail)=>({code,...detail});

export function checkpointDigest(snapshot){
  const x=validateSnapshot(snapshot);
  if(x.length)throw new Error('malformed snapshot: '+x.map(y=>y.code).join(','));
  const norm={schema:1,org:snapshot.org,sequence:snapshot.sequence,observedAt:snapshot.observedAt,
    priorDigest:snapshot.priorDigest,coverageComplete:snapshot.coverageComplete,
    repos:[...snapshot.repos].sort(),gaps:[...snapshot.gaps].sort()};
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}
export function validateSnapshot(s){
  const errors=[];
  if(!plain(s))return [issue('SNAPSHOT_MALFORMED')];
  if(s.schema!==1)errors.push(issue('SCHEMA_UNSUPPORTED'));
  if(typeof s.org!=='string'||!/^[A-Za-z0-9_.-]+$/.test(s.org))errors.push(issue('ORG_INVALID'));
  if(!Number.isSafeInteger(s.sequence)||s.sequence<1)errors.push(issue('SEQUENCE_INVALID'));
  if(timestamp(s.observedAt)===null)errors.push(issue('TIMESTAMP_INVALID'));
  if(s.priorDigest!==null&&!SHA.test(s.priorDigest??''))errors.push(issue('PRIOR_DIGEST_INVALID'));
  if(typeof s.coverageComplete!=='boolean')errors.push(issue('COVERAGE_UNVERIFIED'));
  if(!Array.isArray(s.repos)||!s.repos.length||s.repos.length>2048||
    s.repos.some(x=>typeof x!=='string'||!REPO.test(x)||!x.startsWith(s.org+'/'))||new Set(s.repos).size!==s.repos.length)
    errors.push(issue('REPO_SCOPE_INVALID'));
  if(!Array.isArray(s.gaps)||s.gaps.length>4096||s.gaps.some(x=>typeof x!=='string'||x.length>200)||
    new Set(s.gaps).size!==s.gaps.length)errors.push(issue('GAPS_INVALID'));
  if(s.coverageComplete===true&&Array.isArray(s.gaps)&&s.gaps.length!==0)errors.push(issue('FALSE_COMPLETENESS'));
  return errors;
}
export function inspectCheckpoint(previous,current,{nowMs=Date.now(),maxAgeMs=6*3600_000,futureSkewMs=5*60_000}={}){
  if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<=0||
     !Number.isSafeInteger(futureSkewMs)||futureSkewMs<0)throw Error('invalid clock policy');
  const errors=validateSnapshot(current),currentTime=timestamp(current?.observedAt);
  if(currentTime!==null){
    if(currentTime>nowMs+futureSkewMs)errors.push(issue('FUTURE_SNAPSHOT'));
    if(nowMs-currentTime>maxAgeMs)errors.push(issue('STALE_SNAPSHOT'));
  }
  if(previous===null||previous===undefined){
    if(current?.priorDigest!==null)errors.push(issue('GENESIS_DIGEST_MUST_BE_NULL'));
    errors.push(issue('INDEPENDENT_BASELINE_MISSING'));
  }else{
    errors.push(...validateSnapshot(previous).map(x=>issue('PREVIOUS_'+x.code)));
    if(current?.org!==previous?.org)errors.push(issue('ORG_CHANGED'));
    if(!Number.isSafeInteger(previous?.sequence)||current?.sequence!==previous.sequence+1)
      errors.push(issue('SEQUENCE_REPLAY_OR_SKIP'));
    const priorTime=timestamp(previous?.observedAt);
    if(currentTime!==null&&priorTime!==null&&currentTime<=priorTime)errors.push(issue('TIME_REPLAY'));
    try{if(current?.priorDigest!==checkpointDigest(previous))errors.push(issue('BROKEN_HASH_CHAIN'));}
    catch{errors.push(issue('PREVIOUS_DIGEST_UNVERIFIED'));}
    if(Array.isArray(previous?.repos)&&Array.isArray(current?.repos)){
      for(const repo of previous.repos)if(!current.repos.includes(repo))errors.push(issue('REPO_DISAPPEARED',{repo}));
    }
  }
  if(current?.coverageComplete!==true)errors.push(issue('DISCOVERY_NOT_COMPLETE'));
  // A well-formed hash chain is never a release or export authorization.
  return {status:errors.length?'BLOCKED':'CONSISTENT_UNAUTHENTICATED',issues:errors,
    digest:validateSnapshot(current).length===0?checkpointDigest(current):null,
    releaseAuthorized:false,sourceTransferAuthorized:false};
}
