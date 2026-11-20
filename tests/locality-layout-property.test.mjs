import test from 'node:test';
import assert from 'node:assert/strict';
import {makeLayoutPlan, makeTopology, chooseCarrier, chooseReady} from '../src/locality-layout-oracle.mjs';

let rng = 0x5eed1234;
function next() {
  rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
  return rng >>> 0;
}

test('seeded mixed-width layout addresses never overlap across rows or tiles', () => {
  for (const layout of ['aos','soa','aosoa','soaos']) {
    for (let sample=0; sample<128; sample++) {
      const rows = next() % 39;
      const tile = 1 + next() % 11;
      const fields = Array.from({length: 1 + next() % 6},
        (_,i)=>({name:'field_'+i,width:[1,4,8][next()%3]}));
      const p = makeLayoutPlan(fields, rows, layout, tile, 65536);
      const occupied = new Set();
      for (let row=0;row<rows;row++) for (let field=0;field<fields.length;field++) {
        const address=p.address(row,field);
        assert.equal(address % fields[field].width,0);
        for (let byte=address;byte<address+fields[field].width;byte++) {
          assert.ok(byte < p.physicalBytes,layout+' '+sample+': escaped quota');
          assert.ok(!occupied.has(byte),layout+' '+sample+': aliased '+byte);
          occupied.add(byte);
        }
      }
      assert.throws(()=>p.address(rows,0),/out of bounds/);
      assert.throws(()=>p.address(0,fields.length),/out of bounds/);
    }
  }
});

test('four-layout address plans reject malformed fields and exhausted quota',()=>{
  const fields=[{name:'word',width:8},{name:'flag',width:1},{name:'count',width:4}];
  for (const layout of ['aos','soa','aosoa','soaos']) {
    assert.throws(()=>makeLayoutPlan(fields,16384,layout,7,1024),/quota/);
  }
  assert.throws(()=>makeLayoutPlan([{name:'dup',width:8},{name:'dup',width:1}],4,'soa'),/geometry/);
  assert.throws(()=>makeLayoutPlan([{name:'i64',width:16}],4,'soa'),/geometry/);
  assert.throws(()=>makeLayoutPlan(fields,-1,'soa'),/geometry/);
  assert.throws(()=>makeLayoutPlan(fields,4,'soa',3,-1),/geometry/);
});

test('unfamiliar DATA actors rotate under a bounded familiar-turn budget',()=>{
  const data=['hot','cold-1','cold-2','cold-3'];
  const visited = new Set();
  let cursor=0;
  for(let i=0;i<30;i++){
    const selected=chooseReady([],data,'hot',8,cursor);
    assert.equal(selected.kind,'data');
    assert.notEqual(selected.actor,'hot');
    visited.add(selected.actor);
    cursor=(data.indexOf(selected.actor)+1)%data.length;
  }
  assert.deepEqual([...visited].sort(),['cold-1','cold-2','cold-3']);
  assert.throws(()=>chooseReady([],data,'hot',8,-1),/ready queues/);
  assert.throws(()=>chooseReady([],data,'hot',8,NaN),/ready queues/);
  assert.deepEqual(chooseReady(['control'],data,'hot',999,cursor),{kind:'control',actor:'control'});
});

test('loss of allowed CPU or cache evidence cannot preserve stale carrier',()=>{
  const inputs=[
    {id:'a',domain:'shared',cpu:3,cacheKey:'package0:llc0',numa:0},
    {id:'b',domain:'shared',cpu:7,cacheKey:'package0:llc0',numa:0},
    {id:'c',domain:'shared',cpu:12,cacheKey:'package1:llc0',numa:1},
    {id:'control',domain:'control',cpu:13}
  ];
  const full=makeTopology(inputs,[3,7,12,13]);
  const req={actorId:'actor-77',domain:'shared',lastWorker:'b'};
  assert.equal(chooseCarrier(full,req),'b');
  const revoked=makeTopology(inputs,[3,12,13]);
  assert.notEqual(chooseCarrier(revoked,req),'b');
  assert.equal(chooseCarrier(revoked,{...req,preferredCpu:3}),'a');
  assert.equal(chooseCarrier(revoked,{...req,preferredCache:'package1:llc0'}),'c');
  assert.equal(chooseCarrier(revoked,{actorId:'actor-77',domain:'control'}),'control');
  assert.throws(()=>chooseCarrier(revoked,{actorId:'actor-77',domain:'isolated'}),/no carrier/);
});
