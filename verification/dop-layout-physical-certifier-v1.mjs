// Finite source-free layout checker; not proof of AttoLang guest codegen.
import { TYPES, alignUp } from './data-layout-abi-v1.mjs';

export function certifyPhysicalLayout(plan, maxCells = 65536) {
  if (!plan || plan.version !== 1 || typeof plan.address !== 'function' ||
      !Array.isArray(plan.fields) || !Array.isArray(plan.segments) ||
      typeof plan.capacity !== 'bigint' || plan.capacity < 0n) {
    throw new TypeError('invalid v1 layout');
  }
  if (!Number.isSafeInteger(maxCells) || maxCells < 0 || maxCells > 1000000 ||
      plan.fields.length < 1 || plan.fields.length > 256) {
    throw new RangeError('invalid finite verification budget or field count');
  }
  const cells = plan.capacity * BigInt(plan.fields.length);
  if (cells > BigInt(maxCells)) throw new RangeError('finite verification budget exceeded');
  const names = new Set();
  let rowBytes = 0n;
  for (const f of plan.fields) {
    if (!f || typeof f.name !== 'string' || names.has(f.name) ||
        typeof f.type !== 'string' || !Object.hasOwn(TYPES,f.type) ||
        f.size !== TYPES[f.type].size || f.align !== TYPES[f.type].align) {
      throw new TypeError('invalid declared scalar physical width');
    }
    names.add(f.name); rowBytes += f.size;
  }
  let next = 0n, payload = 0n;
  for (const segment of plan.segments) {
    if (!segment || typeof segment.align !== 'bigint' ||
        typeof segment.bytes !== 'bigint' || typeof segment.base !== 'bigint' ||
        segment.bytes < 0n || segment.align <= 0n ||
        (segment.align & (segment.align-1n)) !== 0n) {
      throw new TypeError('invalid segment');
    }
    next = alignUp(next,segment.align);
    if (segment.base !== next) throw new RangeError('incorrect segment base');
    next += segment.bytes; payload += segment.bytes;
  }
  if (plan.physicalBytes !== next || plan.payloadBytes !== payload) {
    throw new RangeError('incorrect charged physical allocation');
  }
  const occupied = plan.segments.map(()=>[]);
  for (let row=0n; row<plan.capacity; row++) for (const field of plan.fields) {
    const at = plan.address(Number(row),field.name);
    if (!at || !Number.isSafeInteger(at.segment) || at.segment<0 ||
        at.segment>=plan.segments.length || typeof at.byteOffset !== 'bigint' ||
        at.byteOffset<0n) throw new RangeError('invalid field address');
    const seg = plan.segments[at.segment];
    const end=at.byteOffset+field.size;
    if (end>seg.bytes) throw new RangeError('physical field outside allocation');
    if ((seg.base+at.byteOffset)%field.align !== 0n) {
      throw new RangeError('misaligned physical field');
    }
    occupied[at.segment].push([at.byteOffset,end]);
  }
  for (const ranges of occupied) {
    ranges.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    for (let i=1;i<ranges.length;i++) {
      if (ranges[i][0]<ranges[i-1][1]) {
        throw new RangeError('aliased physical cells');
      }
    }
  }
  const live=rowBytes*plan.capacity;
  if (live>next) throw new RangeError('physical allocation below live payload');
  return Object.freeze({version:1,layout:plan.layout,checkedCells:cells,
    liveBytes:live,physicalBytes:next,paddingAndUnusedBytes:next-live});
}
