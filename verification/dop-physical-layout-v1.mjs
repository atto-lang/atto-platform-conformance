// Normative HOST arithmetic oracle for the AttoLang DOP physical-layout v1
// fixture. This is NOT .atto parsing, typechecking, HIR/MIR or guest codegen.
const MAX = (1n << 63n) - 1n;
const power2 = n => Number.isSafeInteger(n) && n > 0 && (n & (n - 1)) === 0;
const req = (ok, message) => { if (!ok) throw new RangeError(message); };
const checked = n => { req(n >= 0n && n <= MAX, 'physical-layout-overflow'); return n; };
const add = (a,b) => checked(a + b);
const mul = (a,b) => checked(a * b);
const align = (n,a) => n ? mul(add((n - 1n) / a,1n),a) : 0n;
const toCount = (n,label) => {
  if (typeof n === 'number') { req(Number.isSafeInteger(n), label); n = BigInt(n); }
  else if (typeof n === 'string') { req(/^(0|[1-9][0-9]*)$/.test(n),label); n = BigInt(n); }
  req(typeof n === 'bigint' && n >= 0n && n <= MAX,label);
  return n;
};

export function physicalLayoutV1({kind, rows, fields, lanes = 1, groups = [],
  maximumBytes = MAX}) {
  const count = toCount(rows, 'physical-layout-rows');
  const quota = toCount(maximumBytes,'physical-layout-quota');
  req(Array.isArray(fields) && fields.length >= 1 && fields.length <= 64,
    'physical-layout-fields');
  req(['aos','soa','aosoa','soaos'].includes(kind), 'physical-layout-kind');
  req(power2(lanes) && lanes <= 1024 && (kind === 'aosoa' || lanes === 1),
    'physical-layout-lanes');
  req(Array.isArray(groups), 'physical-layout-groups');
  const specs = fields.map((f,i) => {
    req(f && typeof f === 'object' && power2(f.bytes) &&
      power2(f.alignment) && f.bytes <= f.alignment && f.alignment <= 4096,
      'physical-layout-field-' + i);
    return {bytes: BigInt(f.bytes), alignment: BigInt(f.alignment)};
  });
  const locations = Array.from({length:specs.length});
  const segments = [];
  function record(indices,seg) {
    let cursor=0n, alignment=1n;
    for (const idx of indices) {
      const f = specs[idx]; cursor=align(cursor,f.alignment);
      locations[idx] = {segment:seg, offset:cursor};
      cursor=add(cursor,f.bytes);
      if (f.alignment > alignment) alignment=f.alignment;
    }
    const stride=align(cursor,alignment);
    for (const idx of indices) locations[idx].rowStride=stride;
    return {alignment,bytes:mul(count,stride),stride};
  }
  const indices = specs.map((_,i)=>i);
  switch(kind) {
    case 'aos': {
      req(groups.length===0,'physical-layout-extraneous-groups');
      segments.push(record(indices,0));
      break;
    }
    case 'soa': {
      req(groups.length===0,'physical-layout-extraneous-groups');
      for(const [i,f] of specs.entries()) {
        const stride=align(f.bytes,f.alignment);
        segments.push({alignment:f.alignment,bytes:mul(count,stride),stride});
        locations[i]={segment:i,offset:0n,rowStride:stride};
      }
      break;
    }
    case 'aosoa': {
      req(groups.length===0,'physical-layout-extraneous-groups');
      let cursor=0n, alignment=1n;
      for (const [i,f] of specs.entries()) {
        cursor=align(cursor,f.alignment);
        const laneStride=align(f.bytes,f.alignment);
        locations[i]={segment:0,offset:cursor,rowStride:laneStride};
        cursor=add(cursor,mul(BigInt(lanes),laneStride));
        if(f.alignment>alignment) alignment=f.alignment;
      }
      const stride=align(cursor,alignment);
      const tileCount=add(count/BigInt(lanes),count%BigInt(lanes)===0n?0n:1n);
      segments.push({alignment,bytes:mul(tileCount,stride),stride});
      break;
    }
    case 'soaos': {
      req(groups.length>0,'physical-layout-missing-groups');
      const seen = new Set();
      for(const group of groups) {
        req(Array.isArray(group) && group.length>0,'physical-layout-empty-group');
        for(const idx of group) {
          req(Number.isInteger(idx) && idx >=0 && idx < specs.length && !seen.has(idx),
            'physical-layout-group-partition');
          seen.add(idx);
        }
        segments.push(record(group,segments.length));
      }
      req(seen.size === specs.length, 'physical-layout-group-partition');
    }
  }
  let size=0n;
  for(const segment of segments) {
    size=align(size,segment.alignment);
    segment.base=size;
    size=add(size,segment.bytes);
    req(size<=quota,'physical-layout-quota-exceeded');
  }
  function address(row,field) {
    const r=toCount(row,'physical-layout-index');
    req(Number.isInteger(field) && field>=0 && field<specs.length && r<count,
      'physical-layout-out-of-bounds');
    const loc=locations[field], s=segments[loc.segment];
    const relative=kind==='aosoa'
      ? add(add(mul(r/BigInt(lanes),s.stride),loc.offset),
        mul(r%BigInt(lanes),loc.rowStride))
      : add(mul(r,loc.rowStride),loc.offset);
    req(add(relative,specs[field].bytes)<=s.bytes,'physical-layout-segment-overrun');
    return {segment:loc.segment,offset:relative,absolute:add(s.base,relative)};
  }
  return {rows:count,fields:specs.length,lanes,kind,physicalBytes:size,segments,
    address};
}
