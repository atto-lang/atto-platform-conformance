// Portable host-only conformance reference: not a guest scheduler, CPU binding,
// physical allocator, native memory layout or performance qualification.
const DOMAINS = new Set(['control', 'shared', 'isolated', 'untrusted']);
const LAYOUTS = new Set(['aos', 'soa', 'aosoa', 'soaos']);
const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const align = (n, a) => Math.ceil(n / a) * a;
const hash = value => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++)
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Validate effective-CPU eligibility before choosing a soft placement. */
export function makeTopology(workers, allowedCpus) {
  if (!Array.isArray(workers) || !int(workers.length, 1, 64) ||
      !Array.isArray(allowedCpus) || allowedCpus.length === 0 ||
      allowedCpus.some(x => !int(x, 0, 65535)) ||
      new Set(allowedCpus).size !== allowedCpus.length) throw Error('invalid effective cpuset');
  const seen = new Set();
  const accepted = workers.map(w => {
    if (!w || typeof w.id !== 'string' || !w.id || seen.has(w.id) ||
        !DOMAINS.has(w.domain) || !int(w.cpu, 0, 65535) ||
        (w.cacheKey != null && (typeof w.cacheKey !== 'string' || !w.cacheKey.includes(':'))) ||
        (w.numa != null && !int(w.numa, 0, 65535))) throw Error('invalid carrier topology');
    seen.add(w.id);
    return Object.freeze({id:w.id, domain:w.domain, cpu:w.cpu,
      cacheKey:w.cacheKey ?? null, numa:w.numa ?? null});
  }).filter(w => allowedCpus.includes(w.cpu));
  if (!accepted.length) throw Error('no allowed carriers');
  return Object.freeze(accepted);
}

/** Stable rendezvous tie-breaking within the best known locality class. */
export function chooseCarrier(topology, request) {
  const {actorId, domain, lastWorker = null, preferredCpu = null,
    preferredCache = null, regionNuma = null} = request ?? {};
  if (!Array.isArray(topology) || !topology.length ||
      typeof actorId !== 'string' || !actorId || !DOMAINS.has(domain) ||
      (preferredCpu != null && !int(preferredCpu, 0, 65535)) ||
      (preferredCache != null && (typeof preferredCache !== 'string' || !preferredCache.includes(':'))) ||
      (regionNuma != null && !int(regionNuma, 0, 65535))) throw Error('invalid placement request');
  const eligible = topology.filter(w => w.domain === domain);
  if (!eligible.length) throw Error('no carrier in execution domain');
  const previous = eligible.find(w => w.id === lastWorker);
  if (previous) return previous.id; // soft reuse only; turn lease still required
  const rank = w => w.cpu === preferredCpu && preferredCpu != null ? 0
    : w.cacheKey === preferredCache && preferredCache != null ? 1
    : w.numa === regionNuma && regionNuma != null ? 2 : 3;
  const best = Math.min(...eligible.map(rank));
  return eligible.filter(w => rank(w) === best)
    .reduce((winner, w) => {
      const score = hash(domain + '\0' + actorId + '\0' + w.id);
      return !winner || score > winner.score || (score === winner.score && w.id < winner.id)
        ? {id:w.id, score} : winner;
    }, null).id;
}

/** CONTROL-first pick; bounded hot-turn preference cannot starve cold DATA. */
/**
 * The caller must advance globalStart after dispatch and update the physical
 * ready queues. Without cursor progression a repeated first-cold pick would
 * starve other unfamiliar actors. This is only a dispatch decision oracle.
 */
export function chooseReady(control, data, familiarActor, hotTurns, globalStart = 0) {
  if (!Array.isArray(control) || !Array.isArray(data) ||
      !int(hotTurns, 0, Number.MAX_SAFE_INTEGER) ||
      !int(globalStart, 0, Number.MAX_SAFE_INTEGER))
    throw Error('invalid ready queues');
  if (control.length) return {kind:'control', actor:control[0]};
  if (!data.length) return null;
  const known = data.find(x => x === familiarActor);
  let cold = null;
  for (let n=0; n<data.length; n++) {
    const candidate = data[(globalStart % data.length + n) % data.length];
    if (candidate !== familiarActor) { cold = candidate; break; }
  }
  if (known != null && (hotTurns < 8 || cold == null))
    return {kind:'data', actor:known};
  return {kind:'data', actor:cold ?? data[globalStart % data.length]};
}

/** Checked mixed-width byte geometry; no arrays/arena memory are allocated. */
export function makeLayoutPlan(fields, rows, layout, tileWidth = 4, byteCap = 16 * 1024 * 1024) {
  if (!Array.isArray(fields) || !int(fields.length, 1, 128) ||
      fields.some(f => !f || typeof f.name !== 'string' || !f.name ||
        ![1,4,8].includes(f.width)) ||
      new Set(fields.map(f => f.name)).size !== fields.length ||
      !int(rows, 0, 65536) || !LAYOUTS.has(layout) ||
      !int(tileWidth, 1, 256) || !int(byteCap, 1, 16 * 1024 * 1024))
    throw Error('invalid layout geometry');
  const widths = fields.map(f => f.width);
  const maxAlign = Math.max(...widths);
  let rowStride = 0;
  const offsets = widths.map(w => {
    rowStride = align(rowStride,w);
    const off = rowStride; rowStride += w;
    return off;
  });
  rowStride = align(rowStride,maxAlign);
  const colOffsets = [];
  let bytes = 0, tileStride = 0;
  if (layout === 'aos') bytes = rowStride * rows;
  else if (layout === 'soa') {
    for (const w of widths) {
      bytes = align(bytes,w); colOffsets.push(bytes); bytes += w * rows;
    }
  } else if (layout === 'aosoa') {
    for (const w of widths) {
      tileStride = align(tileStride,w); colOffsets.push(tileStride);
      tileStride += w * tileWidth;
    }
    tileStride = align(tileStride,maxAlign);
    bytes = Math.ceil(rows / tileWidth) * tileStride;
  } else {
    tileStride = align(rowStride * tileWidth,64);
    bytes = Math.ceil(rows / tileWidth) * tileStride;
  }
  if (bytes > byteCap) throw Error('layout byte quota exceeded');
  const physicalBytes = bytes;
  return Object.freeze({layout, rows, physicalBytes, tileWidth,
    address(row, field) {
      if (!int(row,0,rows-1) || !int(field,0,widths.length-1)) throw Error('out of bounds cell');
      const position = layout === 'aos' ? row * rowStride + offsets[field]
        : layout === 'soa' ? colOffsets[field] + row * widths[field]
        : layout === 'aosoa' ? Math.floor(row/tileWidth)*tileStride + colOffsets[field] + (row%tileWidth)*widths[field]
        : Math.floor(row/tileWidth)*tileStride + (row%tileWidth)*rowStride + offsets[field];
      if (position + widths[field] > physicalBytes || position % widths[field] !== 0)
        throw Error('invalid physical cell');
      return position;
    }
  });
}
