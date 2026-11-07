// Finite source-free layout checker; not proof of AttoLang guest codegen.
// Only one canonical snapshot of caller-owned metadata may influence a check.
import { TYPES, alignUp } from './data-layout-abi-v1.mjs';

// Accessor-backed or inherited properties cannot be used as ABI evidence.
// Capture every user-controlled property once; never validate one value and
// then consume a second value returned by a getter or a rewritten array cell.
function ownData(object, property) {
  if (object === null || (typeof object !== 'object' &&
      typeof object !== 'function')) {
    throw new TypeError('physical layout metadata must be a data object');
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError('physical layout requires own data property: '+property);
  }
  return descriptor.value;
}

function snapshotArray(array, label, maxLength, mapper) {
  if (!Array.isArray(array)) throw new TypeError('invalid '+label+' list');
  const length = ownData(array, 'length');
  if (!Number.isSafeInteger(length) || length < 1 || length > maxLength) {
    throw new RangeError('invalid '+label+' count');
  }
  const values = [];
  for (let i = 0; i < length; i++) {
    values.push(Object.freeze(mapper(ownData(array, String(i)))));
  }
  return Object.freeze(values);
}

export function certifyPhysicalLayout(plan, maxCells = 65536) {
  if (!Number.isSafeInteger(maxCells) || maxCells < 0 || maxCells > 1000000) {
    throw new RangeError('invalid finite verification budget or field count');
  }
  const version = ownData(plan, 'version');
  const layout = ownData(plan, 'layout');
  const capacity = ownData(plan, 'capacity');
  const address = ownData(plan, 'address');
  const sourceFields = ownData(plan, 'fields');
  const sourceSegments = ownData(plan, 'segments');
  const declaredPhysical = ownData(plan, 'physicalBytes');
  const declaredPayload = ownData(plan, 'payloadBytes');
  if (version !== 1 || !['aos','soa','aosoa','soaos'].includes(layout) ||
      typeof address !== 'function' || typeof capacity !== 'bigint' ||
      capacity < 0n) {
    throw new TypeError('invalid v1 layout');
  }
  const fields = snapshotArray(sourceFields,'field',256, field => ({
    name:ownData(field,'name'), type:ownData(field,'type'),
    size:ownData(field,'size'), align:ownData(field,'align')
  }));
  // All current ABI v1 layouts allocate at least one segment and at most
  // one per column. An oversized forged segment array must not evade the
  // finite cell budget by requesting capacity=0.
  const segments = snapshotArray(sourceSegments,'segment',fields.length,
    segment => ({
      align:ownData(segment,'align'), bytes:ownData(segment,'bytes'),
      base:ownData(segment,'base')
    }));
  const cells = capacity * BigInt(fields.length);
  if (cells > BigInt(maxCells)) throw new RangeError('finite verification budget exceeded');

  const names = new Set();
  let rowBytes = 0n;
  for (const field of fields) {
    if (typeof field.name !== 'string' || names.has(field.name) ||
        typeof field.type !== 'string' || !Object.hasOwn(TYPES,field.type) ||
        field.size !== TYPES[field.type].size ||
        field.align !== TYPES[field.type].align) {
      throw new TypeError('invalid declared scalar physical width');
    }
    names.add(field.name); rowBytes += field.size;
  }
  let next = 0n, payload = 0n;
  for (const segment of segments) {
    if (typeof segment.align !== 'bigint' ||
        typeof segment.bytes !== 'bigint' || typeof segment.base !== 'bigint' ||
        segment.bytes < 0n || segment.align <= 0n ||
        (segment.align & (segment.align-1n)) !== 0n) {
      throw new TypeError('invalid segment');
    }
    next = alignUp(next,segment.align);
    if (segment.base !== next) throw new RangeError('incorrect segment base');
    next += segment.bytes; payload += segment.bytes;
  }
  if (declaredPhysical !== next || declaredPayload !== payload) {
    throw new RangeError('incorrect charged physical allocation');
  }
  const occupied = segments.map(()=>[]);
  for (let row=0n; row<capacity; row++) for (const field of fields) {
    const at = Reflect.apply(address,plan,[Number(row),field.name]);
    const index = ownData(at,'segment');
    const offset = ownData(at,'byteOffset');
    if (!Number.isSafeInteger(index) || index<0 ||
        index>=segments.length || typeof offset !== 'bigint' ||
        offset<0n) throw new RangeError('invalid field address');
    const segment = segments[index];
    const end=offset+field.size;
    if (end>segment.bytes) throw new RangeError('physical field outside allocation');
    if ((segment.base+offset)%field.align !== 0n) {
      throw new RangeError('misaligned physical field');
    }
    occupied[index].push([offset,end]);
  }
  for (const ranges of occupied) {
    ranges.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    for (let i=1;i<ranges.length;i++) {
      if (ranges[i][0]<ranges[i-1][1]) {
        throw new RangeError('aliased physical cells');
      }
    }
  }
  const live=rowBytes*capacity;
  if (live>next) throw new RangeError('physical allocation below live payload');
  // This certifies one finite snapshot. It is not a future-proof capability
  // to trust a separately mutable plan or side-effectful address callback.
  return Object.freeze({version:1,layout,checkedCells:cells,
    liveBytes:live,physicalBytes:next,paddingAndUnusedBytes:next-live});
}
