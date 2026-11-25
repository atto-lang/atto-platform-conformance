// Task #37: reject forged/insufficient *shape* of zero-GC workload metrics.
// Nothing here authenticates runtime counter collection, compiler or artifacts.
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const sha64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>natural(x)&&x>0;
const backends=new Set(['java','llvm','net','wasm','forge']);
const stages=new Set(['GUEST_OWNED_ARENA','MANAGED_HOST_GUEST_OWNED']);
const failure=(diagnostic)=>Object.freeze({ok:false,diagnostic,
  classification:'METRICS_SHAPE_REJECTED',guestZeroGcCertified:false,processZeroGcCertified:false});
export function validateZeroGcMetrics(receipt){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
     receipt.schema!=='atto.zero-gc-metrics/1'||!backends.has(receipt.backend)||
     !stages.has(receipt.profile)||!sha40(receipt.sourceHead)||
     !sha64(receipt.compilerDigest)||!sha64(receipt.artifactDigest))
    return failure('IDENTITY_OR_PROFILE_INVALID');
  const j=receipt.job;
  if(!j||!positive(j.runId)||!positive(j.attempt)||!positive(j.jobId)||
    !positive(j.runnerId)||!Array.isArray(j.steps)||j.steps.length===0||
    j.steps.length>100||!j.steps.some(s=>s?.name==='Execute compiled guest memory profile'&&
      s?.status==='completed'&&s?.conclusion==='success')||
    j.steps.some(s=>typeof s?.name!=='string'||s.name.trim()===''||
      s?.status!=='completed'||s?.conclusion!=='success')||
    new Set(j.steps.map(s=>s.name)).size!==j.steps.length)
    return failure('NO_AUTHENTICATED_EXECUTION_SHAPE');
  const m=receipt.metrics;
  if(!m||!positive(m.iterations)||!natural(m.hostTracingCollections)||
    !natural(m.guestTracingCollections)||m.guestTracingCollections!==0||
    !positive(m.createdActors)||m.createdActors!==m.retiredActors||
    !natural(m.peakActorOwnedBytes)||!natural(m.finalActorOwnedBytes)||
    m.finalActorOwnedBytes!==0||!Array.isArray(m.actors)||
    m.actors.length!==m.createdActors||m.actors.length>128)
    return failure('UNQUALIFIED_MEMORY_METRICS');
  const ids=new Set();
  for(const a of m.actors){
    if(!a||typeof a.actorId!=='string'||!/^[a-zA-Z0-9_-]{1,48}$/.test(a.actorId)||
       !positive(a.generation)||!natural(a.allocatedBytes)||!natural(a.reclaimedBytes)||
       a.allocatedBytes!==a.reclaimedBytes||a.allocatedBytes===0||
       !natural(a.highWaterBytes)||a.highWaterBytes>a.allocatedBytes||
       ids.has(a.actorId+':'+a.generation))
      return failure('INVALID_ACTOR_RECLAMATION');
    ids.add(a.actorId+':'+a.generation);
  }
  const scope=m.hostTracingCollections>0?'GUEST_ONLY_HOST_GC_OBSERVED':'GUEST_ONLY_HOST_GC_NOT_PROVEN_ABSENT';
  return Object.freeze({
    ok:true,classification:'UNAUTHENTICATED_METRICS_CANDIDATE',
    scope,executionMetadataClaimed:true,
    guestZeroGcCertified:false,processZeroGcCertified:false,
    diagnostic:null,backend:receipt.backend
  });
}
