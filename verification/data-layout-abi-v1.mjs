// Backend-neutral source-free reference for oreslang-data-layout-abi-v1.
// This is executable contract machinery, NOT proof of any compiler backend.

const TYPES = Object.freeze({
  bool:{size:1n,align:1n}, i8:{size:1n,align:1n}, u8:{size:1n,align:1n},
  i16:{size:2n,align:2n}, u16:{size:2n,align:2n},
  i32:{size:4n,align:4n}, u32:{size:4n,align:4n}, f32:{size:4n,align:4n},
  char32:{size:4n,align:4n}, ref32:{size:4n,align:4n},
  i64:{size:8n,align:8n}, u64:{size:8n,align:8n}, f64:{size:8n,align:8n},
});
// Immutability must reach nested widths: exported TYPES is used as the source
// of truth for later ABI geometry, not just a display-only manifest.
for (const shape of Object.values(TYPES)) Object.freeze(shape);

const U32_MAX = 0xffff_ffffn;
const REF_ALIGN = 8n;
const MAX_COMPRESSED32_OFFSET = (U32_MAX - 1n) * REF_ALIGN;
const MAX_COMPRESSED32_SPAN = U32_MAX * REF_ALIGN;

function alignUp(value, alignment) {
  if (typeof value !== 'bigint' || typeof alignment !== 'bigint' ||
      value < 0n || alignment <= 0n || (alignment & (alignment - 1n)) !== 0n) {
    throw new RangeError('invalid ABI alignment');
  }
  return (value + alignment - 1n) & ~(alignment - 1n);
}

function checkedCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fff_ffff) {
    throw new RangeError(`invalid ${label}`);
  }
  return BigInt(value);
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('fields required');
  const seen = new Set();
  return fields.map((field, index) => {
    // Capture user-controlled descriptor properties exactly once. A getter
    // that changes type between checking and allocation must not publish
    // a mismatched declared scalar type and physical byte width.
    if (!field) throw new TypeError(`invalid field ${index}`);
    const name = field.name;
    const type = field.type;
    if (typeof name !== 'string' || !/^[$A-Z_a-z][$\\w]*$/.test(name) ||
        seen.has(name) || typeof type !== 'string' || !Object.hasOwn(TYPES, type)) {
      throw new TypeError(`invalid field ${index}`);
    }
    seen.add(name);
    return Object.freeze({name,type,...TYPES[type]});
  });
}

function recordShape(fields) {
  let cursor = 0n;
  let maxAlign = 1n;
  const offsets = Object.create(null);
  for (const field of fields) {
    cursor = alignUp(cursor, field.align);
    offsets[field.name] = cursor;
    cursor += field.size;
    if (field.align > maxAlign) maxAlign = field.align;
  }
  return Object.freeze({align:maxAlign,stride:alignUp(cursor,maxAlign),offsets});
}

function computeLayoutAbi({layout, fields, capacity, tileWidth, groups, maxSegmentBytes, maxTotalBytes}) {
  const normalized = normalizeFields(fields);
  const count = checkedCount(capacity, 'capacity');
  if (!['aos','soa','aosoa','soaos'].includes(layout)) throw new RangeError('unknown layout');

  const byName = Object.fromEntries(normalized.map(field => [field.name, field]));
  const locator = Object.create(null);
  const segments = [];

  if (layout === 'aos') {
    if (tileWidth !== undefined || groups !== undefined) throw new TypeError('unexpected layout options');
    const shape = recordShape(normalized);
    segments.push({align:shape.align,bytes:shape.stride*count,stride:shape.stride});
    for (const field of normalized) {
      locator[field.name] = {segment:0,offset:shape.offsets[field.name],rowStride:shape.stride};
    }
  } else if (layout === 'soa') {
    if (tileWidth !== undefined || groups !== undefined) throw new TypeError('unexpected layout options');
    normalized.forEach((field, index) => {
      segments.push({align:field.align,bytes:field.size*count,stride:field.size});
      locator[field.name] = {segment:index,offset:0n,rowStride:field.size};
    });
  } else if (layout === 'aosoa') {
    if (groups !== undefined || !Number.isSafeInteger(tileWidth) || tileWidth < 1 ||
        tileWidth > 1024 || (tileWidth & (tileWidth - 1)) !== 0) {
      throw new RangeError('AoSoA tileWidth must be a power of two in [1,1024]');
    }
    const width = BigInt(tileWidth);
    let cursor = 0n;
    let maxAlign = 1n;
    const offsets = Object.create(null);
    for (const field of normalized) {
      cursor = alignUp(cursor, field.align);
      offsets[field.name] = cursor;
      cursor += field.size * width;
      if (field.align > maxAlign) maxAlign = field.align;
    }
    const tileStride = alignUp(cursor, maxAlign);
    const tileCount = count === 0n ? 0n : (count + width - 1n) / width;
    segments.push({align:maxAlign,bytes:tileStride*tileCount,stride:tileStride,tileWidth});
    for (const field of normalized) {
      locator[field.name] = {
        segment:0,tileOffset:offsets[field.name],elementStride:field.size,tileStride,tileWidth
      };
    }
  } else {
    if (tileWidth !== undefined || !Array.isArray(groups) || groups.length === 0) {
      throw new TypeError('SoAoS groups required');
    }
    // Groups are also untrusted descriptors. Copy each membership once,
    // then validate and calculate offsets from that same canonical snapshot.
    const canonicalGroups = groups.map(group => {
      if (!Array.isArray(group)) throw new TypeError('empty SoAoS group');
      const copy = Array.from(group);
      if (copy.length === 0) throw new TypeError('empty SoAoS group');
      return copy;
    });
    const flat = canonicalGroups.flat();
    if (flat.length !== normalized.length || new Set(flat).size !== normalized.length ||
        flat.some(name => !Object.hasOwn(byName, name))) {
      throw new TypeError('SoAoS groups must exactly partition fields');
    }
    canonicalGroups.forEach((group, segment) => {
      const shape = recordShape(group.map(name => byName[name]));
      segments.push({align:shape.align,bytes:shape.stride*count,stride:shape.stride,fields:[...group]});
      for (const name of group) {
        locator[name] = {segment,offset:shape.offsets[name],rowStride:shape.stride};
      }
    });
  }

  // Backend-specific actor quota/memory32 caps are optional inputs to the
  // shared geometry oracle. Charge real physical extents, including AoSoA
  // tail padding and all SoAoS segment strides, before publishing any layout.
  // BigInt limits avoid accidental Number rounding near 4 GiB/2^53.
  for (const [label, bound] of [
    ['maxSegmentBytes',maxSegmentBytes], ['maxTotalBytes',maxTotalBytes]
  ]) {
    if (bound !== undefined && (typeof bound !== 'bigint' || bound < 0n)) {
      throw new RangeError(`invalid ${label}: expected nonnegative bigint`);
    }
  }
  let payloadBytes = 0n;
  let physicalBytes = 0n;
  const segmentBases = [];
  for (const segment of segments) {
    if (maxSegmentBytes !== undefined && segment.bytes > maxSegmentBytes) {
      throw new RangeError('physical ABI segment exceeds target limit');
    }
    // A single actor arena allocation must align each segment's *base*, even
    // when individual field payloads are byte-packed (e.g. bool before f64).
    // Charge this padding before publication, not just the sum of payloads.
    physicalBytes = alignUp(physicalBytes, segment.align);
    segmentBases.push(physicalBytes);
    physicalBytes += segment.bytes;
    payloadBytes += segment.bytes;
    if (maxTotalBytes !== undefined && physicalBytes > maxTotalBytes) {
      throw new RangeError('physical ABI layout exceeds actor quota');
    }
  }

  const address = (row, field) => {
    const rowIndex = checkedCount(row, 'row');
    if (rowIndex >= count || !Object.hasOwn(locator, field)) throw new RangeError('invalid row/field');
    const place = locator[field];
    if (layout === 'aosoa') {
      const width = BigInt(place.tileWidth);
      const tile = rowIndex / width;
      const lane = rowIndex % width;
      return Object.freeze({
        segment:place.segment,
        byteOffset:tile*place.tileStride + place.tileOffset + lane*place.elementStride
      });
    }
    return Object.freeze({segment:place.segment,byteOffset:rowIndex*place.rowStride+place.offset});
  };

  // Do not publish mutable nested layout metadata. In particular a caller
  // must not be able to retarget address(row, field) after the compiler/verifier
  // has accepted the physical layout, or mutate SoAoS group memberships.
  for (const place of Object.values(locator)) Object.freeze(place);
  const frozenSegments = Object.freeze(segments.map((segment, index) => {
    const immutable = segment.fields === undefined
      ? {...segment,base:segmentBases[index]}
      : {...segment,base:segmentBases[index],fields:Object.freeze([...segment.fields])};
    return Object.freeze(immutable);
  }));
  return Object.freeze({
    version:1,layout,capacity:count,fields:Object.freeze(normalized),
    segments:frozenSegments,payloadBytes,physicalBytes,
    locator:Object.freeze(locator),address
  });
}

function encodeCompressed32(offset) {
  if (typeof offset !== 'bigint' || offset < 0n ||
      offset > MAX_COMPRESSED32_OFFSET || offset % REF_ALIGN !== 0n) {
    throw new RangeError('actor-relative offset cannot be encoded as compressed32');
  }
  return Number(offset / REF_ALIGN + 1n) >>> 0;
}

function decodeCompressed32(word) {
  if (!Number.isInteger(word) || word < 0 || word > 0xffff_ffff) throw new RangeError('invalid u32 word');
  const unsigned = BigInt(word >>> 0);
  return unsigned === 0n ? null : (unsigned - 1n) * REF_ALIGN;
}

function decodeStoredCompressed32(word) {
  if (typeof word !== 'bigint' || word < 0n || word > U32_MAX) {
    throw new RangeError('compressed32 high bits must be zero');
  }
  return decodeCompressed32(Number(word));
}

function dereferenceCompressed32(word, logicalSpanBytes, accessBytes) {
  const offset = decodeStoredCompressed32(word);
  if (offset === null) throw new Error('null compressed32 reference');
  if (typeof logicalSpanBytes !== 'bigint' || typeof accessBytes !== 'bigint' ||
      logicalSpanBytes < 0n || accessBytes <= 0n ||
      offset > logicalSpanBytes || accessBytes > logicalSpanBytes - offset) {
    throw new RangeError('compressed32 access outside logical actor span');
  }
  return offset;
}

export {
  TYPES, MAX_COMPRESSED32_OFFSET, MAX_COMPRESSED32_SPAN,
  alignUp, computeLayoutAbi, encodeCompressed32, decodeCompressed32,
  decodeStoredCompressed32, dereferenceCompressed32
};
