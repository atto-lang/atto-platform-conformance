// Additional read-only governance layer. Even success is never merge authorization.
import {validateManifest,collectWave} from './merge-wave-provider-v1.mjs';
import {assessGovernance,governanceFingerprint} from './merge-wave-governance-v1.mjs';

function policySnapshot(x) {
  return JSON.stringify({
    pr:{head:x.pr?.head?.sha,base:x.pr?.base?.sha,baseRef:x.pr?.base?.ref,
      author:x.pr?.user?.login},
    reviews:x.reviews?.map(r=>({id:r?.id,state:r?.state,who:r?.user?.login,
      commit:r?.commit_id,date:r?.submitted_at,dismissed:r?.dismissed_at}))
      .map(v=>JSON.stringify(v)).sort(),
    policy:governanceFingerprint(x)
  });
}

const knownSources = ['PR','REVIEWS','PROTECTION','RULES','CHECKS'];
function inaccessibleEvidence(error) {
  const sources=Array.isArray(error?.unavailableSources) ? error.unavailableSources : [];
  return {blockers:[...new Set(['GOVERNANCE_PROVIDER_UNAVAILABLE',
    ...sources.map(x=>'GOVERNANCE_'+x.source+'_UNAVAILABLE')])],
    unavailableSources:sources.map(x=>({source:x.source,
      ...(Number.isInteger(x.status) ? {httpStatus:x.status} : {})}))};
}
async function fetchPolicy(client,spec) {
  const root='/repos/'+spec.repo;
  const requests=[
    [root+'/pulls/'+spec.number,'object'],
    [root+'/pulls/'+spec.number+'/reviews','array'],
    [root+'/branches/main/protection','object'],
    [root+'/rules/branches/main','array'],
    [root+'/commits/'+spec.expectedHead+'/check-runs?filter=latest','checks']
  ];
  const results=await Promise.allSettled(requests.map(([path,shape])=>client.get(path,shape)));
  const unavailableSources=results.flatMap((result,i)=>result.status==='rejected'
    ? [{source:knownSources[i],...(Number.isInteger(result.reason?.status)
        ? {status:result.reason.status} : {})}] : []);
  if (unavailableSources.length) {
    const e=new Error('Governance evidence unavailable');
    e.unavailableSources=unavailableSources;
    throw e;
  }
  const [pr,reviews,protection,rules,checkRuns]=results.map(x=>x.value);
  return {pr,reviews,protection,rules,checkRuns};
}

export async function collectProtectedWave(manifest,client) {
  validateManifest(manifest);
  if(typeof client?.get!=='function')throw new TypeError('Missing read-only provider');
  const baseline=await collectWave(manifest,client);
  const governance=[],snapshots=[];
  for(const spec of manifest.prs) {
    try {
      const first=await fetchPolicy(client,spec),second=await fetchPolicy(client,spec);
      const policy=assessGovernance({repository:spec.repo,head:spec.expectedHead,...second});
      if(policySnapshot(first)!==policySnapshot(second)){
        policy.readyForHumanGovernanceReview=false;
        policy.blockers=[...new Set([...policy.blockers,'GOVERNANCE_EVIDENCE_CHANGED'])];
      }
      snapshots.push(policySnapshot(second));
      governance.push(policy);
    } catch (error) {
      snapshots.push(null);
      governance.push({repository:spec.repo,readyForHumanGovernanceReview:false,
        advisoryOnly:true,mergeAuthorized:false,...inaccessibleEvidence(error)});
    }
  }
  // Third read across all repositories catches a policy that changes while a
  // later PR is inspected. It is a stability check, not an atomic merge lease.
  for(let i=0;i<manifest.prs.length;i++){
    if(snapshots[i]===null)continue;
    try {
      const reread=await fetchPolicy(client,manifest.prs[i]);
      if(policySnapshot(reread)!==snapshots[i]){
        governance[i].readyForHumanGovernanceReview=false;
        governance[i].blockers=[...new Set([...governance[i].blockers,'GOVERNANCE_CHANGED_DURING_WAVE'])];
      }
    } catch (error) {
      governance[i].readyForHumanGovernanceReview=false;
      const failure=inaccessibleEvidence(error);
      governance[i].blockers=[...new Set([...governance[i].blockers,...failure.blockers])];
      governance[i].unavailableSources=[...(governance[i].unavailableSources||[]),...failure.unavailableSources];
    }
  }
  const final=await collectWave(manifest,client);
  const baselineDrift=JSON.stringify(baseline.prs)!==JSON.stringify(final.prs);
  const blockers=[...new Set([...final.blockers,...governance.flatMap(x=>x.blockers),
    ...(baselineDrift?['BASELINE_CHANGED_DURING_GOVERNANCE']:[])])];
  return {...final,governance,governanceChecked:true,mergeAuthorized:false,
    readyForHumanFinalReview:final.readyForHumanFinalReview&&!baselineDrift&&
      governance.every(x=>x.readyForHumanGovernanceReview),blockers};
}
