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

async function fetchPolicy(client,spec) {
  const root='/repos/'+spec.repo;
  const [pr,reviews,protection,rules,checkRuns]=await Promise.all([
    client.get(root+'/pulls/'+spec.number,'object'),
    client.get(root+'/pulls/'+spec.number+'/reviews','array'),
    client.get(root+'/branches/main/protection','object'),
    client.get(root+'/rules/branches/main','array'),
    client.get(root+'/commits/'+spec.expectedHead+'/check-runs?filter=latest','checks')
  ]);
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
    } catch {
      snapshots.push(null);
      governance.push({repository:spec.repo,readyForHumanGovernanceReview:false,
        advisoryOnly:true,mergeAuthorized:false,blockers:['GOVERNANCE_PROVIDER_UNAVAILABLE']});
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
    } catch {
      governance[i].readyForHumanGovernanceReview=false;
      governance[i].blockers=[...new Set([...governance[i].blockers,'GOVERNANCE_PROVIDER_UNAVAILABLE'])];
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
