// All provider reads are GET-only. A policy failure can only reduce advisory readiness.
import {validateManifest,collectWave} from './merge-wave-provider-v1.mjs';
import {assessGovernance,governanceFingerprint} from './merge-wave-governance-v1.mjs';

export async function collectProtectedWave(manifest,client) {
  validateManifest(manifest);
  if(typeof client?.get!=='function')throw new TypeError('Missing read-only provider');
  const initial=await collectWave(manifest,client);
  const governance=[];
  for(const spec of manifest.prs){
    const path='/repos/'+spec.repo;
    const load=async()=>{
      const [pr,reviews,protection,rules,checkRuns]=await Promise.all([
        client.get(path+'/pulls/'+spec.number,'object'),
        client.get(path+'/pulls/'+spec.number+'/reviews','array'),
        client.get(path+'/branches/main/protection','object'),
        client.get(path+'/rules/branches/main','array'),
        client.get(path+'/commits/'+spec.expectedHead+'/check-runs?filter=latest','checks')
      ]);
      return {pr,reviews,protection,rules,checkRuns};
    };
    try {
      const first=await load(),second=await load();
      const policy=assessGovernance({repository:spec.repo,head:spec.expectedHead,...second});
      const fp=x=>JSON.stringify({pr:{head:x.pr?.head?.sha,base:x.pr?.base?.sha,
        baseRef:x.pr?.base?.ref,author:x.pr?.user?.login},
        reviews:x.reviews?.map(r=>({id:r?.id,state:r?.state,who:r?.user?.login,
          commit:r?.commit_id,date:r?.submitted_at,dismissed:r?.dismissed_at}))
          .map(x=>JSON.stringify(x)).sort(),policy:governanceFingerprint(x)});
      if(fp(first)!==fp(second)){
        policy.readyForHumanGovernanceReview=false;
        policy.blockers=[...new Set([...policy.blockers,'GOVERNANCE_EVIDENCE_CHANGED'])];
      }
      governance.push(policy);
    }catch{
      governance.push({repository:spec.repo,readyForHumanGovernanceReview:false,
        advisoryOnly:true,mergeAuthorized:false,blockers:['GOVERNANCE_PROVIDER_UNAVAILABLE']});
    }
  }
  // A fresh baseline readback catches PR/approval/CI movement during policy collection.
  const final=await collectWave(manifest,client);
  const baselineDrift=JSON.stringify(initial.prs)!==JSON.stringify(final.prs);
  const blockers=[...new Set([...final.blockers,...governance.flatMap(x=>x.blockers),
    ...(baselineDrift?['BASELINE_CHANGED_DURING_GOVERNANCE']:[])])];
  return {...final,governance,governanceChecked:true,mergeAuthorized:false,
    readyForHumanFinalReview:final.readyForHumanFinalReview&&!baselineDrift&&
      governance.every(x=>x.readyForHumanGovernanceReview),blockers};
}
