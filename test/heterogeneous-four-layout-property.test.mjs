import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLayoutAbi,TYPES} from '../verification/data-layout-abi-v1.mjs';

test('deterministic 480-plan mixed-width layout sweep validates physical byte isolation',()=>{
  let seed=0x6a09e667;
  function random(bound){
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed>>>0)%bound;
  }
  const allNames=['id','x','flag','next','a','b','__proto__','constructor'];
  const allTypes=['u32','f64','bool','ref32'];
  const layouts=['aos','soa','aosoa','soaos'];
  let checkedPlans=0,checkedCells=0;
  for(let sample=0;sample<120;sample++){
    const count=1+random(allNames.length);
    const fields=allNames.slice(0,count).map(name=>({
      name,type:allTypes[random(allTypes.length)]
    }));
    const capacity=random(19);
    for(const layout of layouts){
      const options={};
      if(layout==='aosoa')options.tileWidth=1<<random(5);
      if(layout==='soaos'){
        const names=fields.map(f=>f.name);
        for(let i=names.length-1;i>0;i--){
          const j=random(i+1);
          [names[i],names[j]]=[names[j],names[i]];
        }
        const groups=[];
        for(let cursor=0;cursor<names.length;){
          const size=1+random(names.length-cursor);
          groups.push(names.slice(cursor,cursor+size));
          cursor+=size;
        }
        options.groups=groups;
      }
      const geometry=computeLayoutAbi({layout,fields,capacity,...options});
      assert.equal(geometry.segments.reduce((sum,s)=>sum+s.bytes,0n),
        geometry.payloadBytes,'field payload accounting');
      let next=0n;
      for(const s of geometry.segments){
        assert.equal(s.base% s.align,0n,'segment base alignment');
        assert.ok(s.base>=next,'segment does not overlap prior segment');
        next=s.base+s.bytes;
      }
      assert.equal(next,geometry.physicalBytes);
      const occupied=new Set();
      for(let row=0;row<capacity;row++)for(const f of fields){
        const address=geometry.address(row,f.name);
        const segment=geometry.segments[address.segment];
        const width=TYPES[f.type].size;
        const absolute=segment.base+address.byteOffset;
        assert.equal(absolute%TYPES[f.type].align,0n,'field alignment');
        assert.ok(address.byteOffset>=0n &&
          address.byteOffset+width<=segment.bytes,'field in segment');
        for(let offset=0n;offset<width;offset++){
          const byte=(absolute+offset).toString();
          assert.equal(occupied.has(byte),false,'byte alias');
          occupied.add(byte);
        }
        checkedCells++;
      }
      if(geometry.physicalBytes>0n){
        assert.throws(()=>computeLayoutAbi({
          layout,fields,capacity,...options,
          maxTotalBytes:geometry.physicalBytes-1n
        }),RangeError,'actual aligned physical extent must determine quota');
      }
      assert.doesNotThrow(()=>computeLayoutAbi({
        layout,fields,capacity,...options,
        maxTotalBytes:geometry.physicalBytes
      }));
      assert.throws(()=>geometry.address(capacity,fields[0].name),RangeError);
      checkedPlans++;
    }
  }
  assert.equal(checkedPlans,480);
  assert.ok(checkedCells>10000);
});
