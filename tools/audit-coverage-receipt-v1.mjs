// Audit coverage accounting only. Never certifies builds, reviews or private export.
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const SHA=/^[0-9a-f]{40}$/;
const issue=(code,more={})=>({code,...more});
export function assessCoverage({org,expectedRepos,days,partitions,prs,repositoryEnumerationComplete=false}={}){
  const gaps=[];
  if(typeof org!=='string'||!/^[A-Za-z0-9_.-]+$/.test(org))gaps.push(issue('ORG_UNVERIFIED'));
  if(!Array.isArray(expectedRepos)||expectedRepos.length===0||expectedRepos.length>4096||
    expectedRepos.some(x=>typeof x!=='string'||!REPO.test(x)||!x.startsWith(org+'/'))||
    new Set(expectedRepos).size!==expectedRepos.length)gaps.push(issue('REPO_SCOPE_UNVERIFIED'));
  if(!Array.isArray(days)||days.length===0||days.length>366||days.some(x=>typeof x!=='string'||!DATE.test(x)||!Number.isFinite(Date.parse(x+'T00:00:00Z'))||new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x)||new Set(days).size!==days.length)gaps.push(issue('DATE_SCOPE_UNVERIFIED'));
  if(repositoryEnumerationComplete!==true)gaps.push(issue('REPOSITORY_LIST_INCOMPLETE'));
  if(!Array.isArray(partitions))gaps.push(issue('PARTITIONS_UNOBSERVED'));
  if(!Array.isArray(prs))gaps.push(issue('PR_HEADS_UNOBSERVED'));
  const required=Array.isArray(expectedRepos)&&Array.isArray(days)?expectedRepos.flatMap(repo=>days.map(day=>repo+'|'+day)):[];
  if(required.length>20_000)gaps.push(issue('PARTITION_BUDGET_EXCEEDED'));
  const seen=new Map(),mapped=new Map();
  for(const p of (Array.isArray(partitions)?partitions:[])){
    if(!p||typeof p.repo!=='string'||typeof p.day!=='string'){
      gaps.push(issue('PARTITION_MALFORMED'));continue;
    }
    const key=p.repo+'|'+p.day;
    if(seen.has(key)){gaps.push(issue('PARTITION_DUPLICATED',{key}));continue;}
    seen.set(key,p);
    if(!required.includes(key))gaps.push(issue('OUT_OF_SCOPE_PARTITION',{key}));
    if(p.complete!==true||!Number.isSafeInteger(p.total)||p.total<0||p.total>=1000||
       !Number.isSafeInteger(p.seen)||p.seen!==p.total)
      gaps.push(issue('PARTITION_NOT_PROVEN',{key,seen:p.seen,total:p.total}));
    if(p.incompleteResults===true||p.permissionDenied===true||p.rateLimited===true||p.capHit===true)
      gaps.push(issue('PARTITION_SEARCH_GAP',{key}));
  }
  for(const key of required)if(!seen.has(key))gaps.push(issue('PARTITION_MISSING',{key}));
  for(const pr of (Array.isArray(prs)?prs:[])){
    if(!pr||typeof pr.repository!=='string'||!Number.isSafeInteger(pr.number)||pr.number<1){
      gaps.push(issue('PR_IDENTITY_INVALID'));continue;
    }
    const id=pr.repository+'#'+pr.number;
    if(mapped.has(id)){gaps.push(issue('PR_DUPLICATED',{id}));continue;}
    mapped.set(id,pr);
    if(!Array.isArray(expectedRepos)||!expectedRepos.includes(pr.repository))gaps.push(issue('PR_OUT_OF_SCOPE',{id}));
    if(!SHA.test(pr.head??'')||pr.headVerified!==true||pr.state!=='open')gaps.push(issue('HEAD_UNVERIFIED',{id}));
    if(!Array.isArray(days)||!days.includes(pr.createdDay))gaps.push(issue('PR_CREATED_DAY_UNVERIFIED',{id}));
  }
  if(gaps.length===0){
    const count=[...seen.values()].reduce((n,p)=>n+p.total,0);
    if(count!==mapped.size)gaps.push(issue('PR_COUNT_MISMATCH',{declared:count,unique: mapped.size}));
  }
  return {state:gaps.length?'INCOMPLETE':'ACCOUNTED_NOT_CERTIFIED',gaps,partitionsAccounted:seen.size,
    prCount:mapped.size,executedTestsCertified:false,approvalsRequired:'UNKNOWN',releaseAuthorized:false,privateExportAuthorized:false};
}
