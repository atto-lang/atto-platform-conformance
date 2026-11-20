import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {computeLayoutAbi,TYPES} from "../verification/data-layout-abi-v1.mjs";

const location=new URL("../contracts/v1/mixed-ecs-physical-v1.json",import.meta.url);
const load=async()=>JSON.parse(await readFile(location,"utf8"));
const align=(value,bound)=>(value+bound-1n)/bound*bound;

function inspect(artifact){
  assert.equal(artifact.schemaVersion,1);
  assert.equal(artifact.status,"REFERENCE_ONLY_NOT_GUEST_CERTIFIED");
  assert.deepEqual(artifact.fields.map(f=>f.type),["u32","f64","bool","ref32"]);
  assert.equal(artifact.layouts.length,4);
  for(const variant of artifact.layouts){
    const {layout,capacity,options,segmentBytes,segmentBases,allocationBytes,probes}=variant;
    const geometry=computeLayoutAbi({
      layout,fields:artifact.fields,capacity,...options,
      maxSegmentBytes:BigInt(allocationBytes),maxTotalBytes:BigInt(allocationBytes)
    });
    assert.deepEqual(geometry.segments.map(s=>Number(s.bytes)),segmentBytes);
    let physical=0n;
    const bases=[];
    for(const segment of geometry.segments){
      physical=align(physical,segment.align);
      bases.push(Number(physical));
      physical+=segment.bytes;
    }
    assert.deepEqual(bases,segmentBases);
    assert.equal(Number(physical),allocationBytes);

    const used=new Set();
    for(let row=0;row<capacity;row++){
      for(const field of artifact.fields){
        const p=geometry.address(row,field.name);
        const width=Number(TYPES[field.type].size);
        const at=BigInt(bases[p.segment])+p.byteOffset;
        assert.equal(at%TYPES[field.type].align,0n);
        assert.ok(at+TYPES[field.type].size<=BigInt(allocationBytes));
        for(let i=0;i<width;i++){
          const key=Number(at)+i;
          assert.equal(used.has(key),false,`${layout} byte ${key} aliases`);
          used.add(key);
        }
      }
    }
    for(const [row,field,segment,relative,absolute] of probes){
      const addr=geometry.address(row,field);
      assert.equal(addr.segment,segment,`${layout} probe segment`);
      assert.equal(addr.byteOffset,BigInt(relative),`${layout} probe offset`);
      assert.equal(addr.byteOffset+BigInt(bases[segment]),BigInt(absolute),
        `${layout} probe absolute offset`);
    }

    // Independently materialize the fixed logical rows into real host bytes.
    // This checks little endian, signed-zero bits, ref32 words, and padding.
    const memory=new ArrayBuffer(allocationBytes);
    const view=new DataView(memory);
    const at=(row,field)=>{
      const p=geometry.address(row,field);
      return bases[p.segment]+Number(p.byteOffset);
    };
    for(const [row,entity] of artifact.rows.entries()){
      view.setUint32(at(row,"id"),entity.id,true);
      view.setBigUint64(at(row,"x"),BigInt("0x"+entity.xBits),true);
      view.setUint8(at(row,"flag"),entity.flag?1:0);
      view.setUint32(at(row,"next"),entity.next,true);
    }
    for(const [row,entity] of artifact.rows.entries()){
      assert.equal(view.getUint32(at(row,"id"),true),entity.id);
      assert.equal(view.getBigUint64(at(row,"x"),true).toString(16).padStart(16,"0"),entity.xBits);
      assert.equal(view.getUint8(at(row,"flag")),entity.flag?1:0);
      assert.equal(view.getUint32(at(row,"next"),true),entity.next);
    }
    const raw=new Uint8Array(memory);
    for(let i=0;i<raw.length;i++)if(!used.has(i))assert.equal(raw[i],0,`${layout} padding byte ${i}`);
    assert.throws(()=>geometry.address(capacity,"id"),RangeError);
  }
}

test("fixed mixed-width ECS golden ABI matches reference and real byte storage",async()=>{
  inspect(await load());
});
test("golden vector mutation fails rather than silently certifying layout drift",async()=>{
  const original=await load();
  for(const corrupt of [
    x=>x.layouts[0].probes[1][3]++,
    x=>x.layouts[1].segmentBases[1]++,
    x=>x.layouts[2].allocationBytes--,
    x=>x.layouts[3].segmentBytes[0]--,
    x=>x.layouts[1].probes[2][4]++
  ]){
    const copy=structuredClone(original);corrupt(copy);
    assert.throws(()=>inspect(copy));
  }
});
