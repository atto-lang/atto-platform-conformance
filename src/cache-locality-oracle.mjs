/**
 * Pure, backend-neutral locality admission oracle. NOT physical pinning,
 * NUMA allocation, guest execution, or GPU submission.
 */
const MAX_CARRIERS = 4096, MAX_PROBES = 64, MAX_QUEUES = 4096, MAX_QUEUE_SKEW = 4;
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 256;
const id = v => Number.isSafeInteger(v) && v >= 0;
// Names must identify a nonempty host topology domain AND a cache within it.
// Bare numbers, empty components, whitespace and slash-only strings provide
// no shared-LLC identity; this syntax check is NOT hardware verification.
const qualifiedLlc = v => text(v)
  && /^[A-Za-z0-9_.:-]+(?:\/[A-Za-z0-9_.:-]+)+$/.test(v);
const fail = code => { const e = new Error(code); e.code = code; throw e; };

function hash(s) {
  let h = 2166136261;
  for (let i=0; i<s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
  return h >>> 0;
}

function validateRequest(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)
      || !['actor','task','thread'].includes(r.kind)
      || !text(r.key) || !['soft','hard'].includes(r.mode)) fail('INVALID_REQUEST');
  for (const k of ['preferredCpu','preferredNuma','previousLane'])
    if (r[k] != null && !id(r[k])) fail('INVALID_REQUEST');
  if (r.preferredLlc != null && !qualifiedLlc(r.preferredLlc))
    fail('INVALID_REQUEST');
  if (r.mode === 'hard' && !id(r.preferredCpu)) fail('CPU_BINDING_UNAVAILABLE');
}

/**
 * Host-observed carriers: {lane,cpu,numa,llc,queued,bound}.
 * LLC identity MUST be qualified by topology domain (not bare numeric ID).
 * A hard request requires separately OS-verified bound=true.
 */
export function selectCpuLane({allowedCpus,carriers,request}) {
  validateRequest(request);
  if (!Array.isArray(allowedCpus) || !allowedCpus.length || allowedCpus.length > MAX_CARRIERS
      || allowedCpus.some(x=>!id(x)) || new Set(allowedCpus).size !== allowedCpus.length)
    fail('INVALID_CPU_MASK');
  if (!Array.isArray(carriers) || !carriers.length || carriers.length > MAX_CARRIERS)
    fail('INVALID_CARRIERS');
  const lanes=new Set(),allowed=new Set(allowedCpus);
  for(const c of carriers) {
    if(!c || !id(c.lane) || !id(c.cpu) || !id(c.queued)
      || typeof c.bound !== 'boolean' || (c.numa != null && !id(c.numa))
      || (c.llc != null && !qualifiedLlc(c.llc))
      || lanes.has(c.lane)) fail('INVALID_CARRIERS');
    lanes.add(c.lane);
  }
  const eligible=carriers.filter(c=>allowed.has(c.cpu)
    && (request.mode==='soft' || (c.bound && c.cpu===request.preferredCpu)));
  if(!eligible.length) fail(request.mode==='hard'?'CPU_BINDING_UNAVAILABLE':'NO_ALLOWED_CARRIER');

  // Bounded, rotated scan so high numbered lanes can be candidates too.
  const offset=hash(request.kind+':'+request.key)%eligible.length;
  const probes=Math.min(MAX_PROBES,eligible.length);
  let best=null, bestRank=4, bestLoad=Infinity, bestSticky=false, least=null;
  function rank(c) {
    return request.preferredCpu!=null && c.cpu===request.preferredCpu ? 0
      : request.preferredLlc!=null && c.llc===request.preferredLlc ? 1
      : request.preferredNuma!=null && c.numa===request.preferredNuma ? 2 : 3;
  }
  for(let i=0;i<probes;i++) {
    const c=eligible[(offset+i)%eligible.length], r=rank(c);
    const sticky=request.previousLane===c.lane;
    if(least===null || c.queued<least.queued) least=c;
    if(r<bestRank || (r===bestRank && (c.queued<bestLoad
        || (c.queued===bestLoad && sticky && !bestSticky)))) {
      best=c;bestRank=r;bestLoad=c.queued;bestSticky=sticky;
    }
  }
  // Soft locality can spill under severe backlog; hard pinning never spills.
  if(request.mode==='soft' && best.queued-least.queued>MAX_QUEUE_SKEW) {
    best=least;bestRank=rank(best);
  }
  return Object.freeze({lane:best.lane,cpu:best.cpu,observedBound:best.bound,
    locality:['cpu','llc','numa','fallback'][bestRank],probes,mode:request.mode});
}

/**
 * GPU choice only: provider MUST re-authenticate queue and epoch at submission.
 * Never implicitly fall back to CPU on missing GPU capacity.
 */
export function selectGpuQueue({tenant,device,generation,bytes,queues,key}) {
  if(!text(tenant)||!text(device)||!text(key)||!id(generation)||!id(bytes)
    ||!Array.isArray(queues)||!queues.length||queues.length>MAX_QUEUES)
    fail('INVALID_GPU_REQUEST');
  const ids=new Set();
  for(const q of queues) {
    if(!q||!text(q.id)||!text(q.tenant)||!text(q.device)||!id(q.generation)
      ||!id(q.capacityBytes)||!id(q.usedBytes)||!id(q.inflight)
      ||typeof q.active!=='boolean'||ids.has(q.id)||q.usedBytes>q.capacityBytes)
      fail('INVALID_GPU_QUEUE');
    ids.add(q.id);
  }
  const eligible=queues.filter(q=>q.active&&q.tenant===tenant&&q.device===device
    &&q.generation===generation&&bytes<=q.capacityBytes-q.usedBytes);
  if(!eligible.length) fail('GPU_QUEUE_UNAVAILABLE');
  const offset=hash(key)%eligible.length;
  let best=eligible[offset];
  for(let i=1;i<eligible.length;i++) {
    const q=eligible[(offset+i)%eligible.length];
    if(q.inflight<best.inflight) best=q;
  }
  return Object.freeze({queueId:best.id,tenant:best.tenant,device:best.device,
    generation:best.generation,providerRevalidationRequired:true});
}

/**
 * Conservative cache-line overlap for contiguous byte intervals in one
 * allocation. Strided views must supply conservative bounding intervals.
 */
export function mayShareCacheLine(a,b,lineBytes=64) {
  if(!id(lineBytes)||lineBytes<16||lineBytes>4096
    ||(lineBytes&(lineBytes-1))!==0) fail('INVALID_CACHE_LINE');
  const valid=x=>x&&text(x.allocation)&&id(x.start)&&id(x.length)
    &&Number.isSafeInteger(x.start+x.length)
    &&(x.baseRemainder==null || (id(x.baseRemainder)&&x.baseRemainder<lineBytes));
  if(!valid(a)||!valid(b)) fail('INVALID_BYTE_RANGE');
  if(a.length===0||b.length===0) return false;
  // A named allocation and its base modulo do not prove that two differently
  // named buffers have disjoint physical cache lines. In particular, caller
  // supplied labels can alias, and two aligned bases are not a non-overlap
  // certificate. Fail closed across allocations until a trusted allocation
  // provenance capability is defined; never infer safety from names.
  if(a.allocation!==b.allocation) return true;
  if(a.baseRemainder!=null && b.baseRemainder!=null
      && a.baseRemainder!==b.baseRemainder) fail('INVALID_BYTE_RANGE');
  const base=a.baseRemainder??b.baseRemainder;
  // Unknown base address modulo line size: no negative sharing claims.
  if(base==null) return true;
  if(!Number.isSafeInteger(a.start+a.length+base)
      ||!Number.isSafeInteger(b.start+b.length+base)) fail('INVALID_BYTE_RANGE');
  const a0=Math.floor((a.start+base)/lineBytes);
  const a1=Math.floor((a.start+a.length+base-1)/lineBytes);
  const b0=Math.floor((b.start+base)/lineBytes);
  const b1=Math.floor((b.start+b.length+base-1)/lineBytes);
  return a0<=b1&&b0<=a1;
}

export const LOCALITY_LIMITS=Object.freeze({MAX_CARRIERS,MAX_PROBES,MAX_QUEUES,MAX_QUEUE_SKEW});
