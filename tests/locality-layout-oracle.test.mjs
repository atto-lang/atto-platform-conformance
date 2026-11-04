import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTopology, chooseCarrier, chooseReady, makeLayoutPlan} from '../src/locality-layout-oracle.mjs';

const workers = [
  {id:'control0', domain:'control',cpu:0},
  {id:'shared0', domain:'shared',cpu:1,cacheKey:'package0:llc0',numa:0},
  {id:'shared1', domain:'shared',cpu:2,cacheKey:'package0:llc0',numa:0},
  {id:'shared2', domain:'shared',cpu:3,cacheKey:'package1:llc0',numa:1},
  {id:'isolated0', domain:'isolated',cpu:4},
  {id:'untrusted0', domain:'untrusted',cpu:5}
];
test('effective cpuset filters carriers and rejects empty/noncanonical masks', () => {
  const t = makeTopology(workers,[0,1,3,4,5]);
  assert.deepEqual(t.map(w=>w.id), ['control0','shared0','shared2','isolated0','untrusted0']);
  assert.throws(()=>makeTopology(workers,[9]),/no allowed/);
  assert.throws(()=>makeTopology(workers,[1,1]),/cpuset/);
  assert.throws(()=>makeTopology(workers,[-1]),/cpuset/);
  assert.throws(()=>makeTopology([{...workers[0],id:'a'}, {...workers[1],id:'a'}],[0,1]),/topology/);
});
test('cache identity must be package-qualified; cross-package raw LLC IDs never match',()=>{
  assert.throws(()=>makeTopology([{...workers[1],cacheKey:'0'}],[1]),/topology/);
  const t=makeTopology(workers,[0,1,2,3,4,5]);
  assert.equal(chooseCarrier(t,{actorId:'A',domain:'shared',preferredCache:'package1:llc0'}),'shared2');
  assert.ok(['shared0','shared1'].includes(chooseCarrier(t,{actorId:'A',domain:'shared',preferredCache:'package0:llc0'})));
});
test('domain isolation, same-CPU priority, sticky reuse and allowed-mask revocation',()=>{
  const t=makeTopology(workers,[0,1,2,3,4,5]);
  assert.equal(chooseCarrier(t,{actorId:'A',domain:'shared',preferredCpu:2}),'shared1');
  assert.equal(chooseCarrier(t,{actorId:'A',domain:'shared',lastWorker:'shared2',preferredCpu:2}),'shared2');
  assert.equal(chooseCarrier(t,{actorId:'A',domain:'isolated',lastWorker:'shared0'}),'isolated0');
  assert.equal(chooseCarrier(t,{actorId:'A',domain:'untrusted'}),'untrusted0');
  assert.equal(chooseCarrier(t,{actorId:'A',domain:'control',lastWorker:'shared0'}),'control0');
  const reduced=makeTopology(workers,[0,1,3,4,5]);
  assert.equal(chooseCarrier(reduced,{actorId:'A',domain:'shared',lastWorker:'shared1',preferredCpu:1}),'shared0');
  assert.throws(()=>chooseCarrier(reduced,{actorId:'A',domain:'missing'}),/placement/);
  assert.throws(()=>chooseCarrier(reduced,{actorId:'A',domain:'shared',preferredCache:'raw'}),/placement/);
});
test('deterministic fallback distributes 4096 actor keys instead of first-slot bias',()=>{
  const t=makeTopology(workers,[0,1,2,3,4,5]);
  const counts=new Map([['shared0',0],['shared1',0],['shared2',0]]);
  for(let i=0;i<4096;i++) {
    const req={actorId:'actor-'+i,domain:'shared'};
    const slot=chooseCarrier(t,req);
    assert.equal(chooseCarrier(t,req),slot);
    counts.set(slot,counts.get(slot)+1);
  }
  assert.equal([...counts.values()].reduce((a,b)=>a+b,0),4096);
  for (const c of counts.values()) assert.ok(c > 900 && c < 1800,'unexpected skew '+c);
});
test('CONTROL remains first; familiar DATA never starves cold DATA',()=>{
  for(let n=0;n<128;n++) assert.deepEqual(chooseReady(['panic'],['hot','cold'],'hot',n),{kind:'control',actor:'panic'});
  for(let n=0;n<8;n++) assert.deepEqual(chooseReady([],['hot','cold'],'hot',n),{kind:'data',actor:'hot'});
  assert.deepEqual(chooseReady([],['hot','cold'],'hot',8),{kind:'data',actor:'cold'});
  assert.deepEqual(chooseReady([],['hot'],'hot',8),{kind:'data',actor:'hot'});
  assert.equal(chooseReady([],[],'hot',0),null);
});
test('physical AoS/SoA/AoSoA/SoAoS geometry is aligned and nonaliased',()=>{
  const fields=[{name:'alive',width:1},{name:'id',width:4},{name:'value',width:8}];
  for (const layout of ['aos','soa','aosoa','soaos']) {
    const p=makeLayoutPlan(fields,17,layout,4);
    const cells=[];
    for(let r=0;r<17;r++) for(let f=0;f<fields.length;f++) {
      const at=p.address(r,f), width=fields[f].width;
      assert.equal(at%width,0); assert.ok(at+width<=p.physicalBytes);
      for(let b=0;b<width;b++) cells.push(at+b);
    }
    assert.equal(new Set(cells).size,cells.length,layout+' aliases bytes');
    assert.throws(()=>p.address(17,0),/bounds/);
    assert.throws(()=>p.address(0,3),/bounds/);
  }
  const geometries=['aos','soa','aosoa','soaos'].map(l=>makeLayoutPlan(fields,17,l,3));
  assert.equal(new Set(geometries.map(p=>p.address(5,1))).size,4);
});
test('tile tail, quotas, invalid widths and empty arrays fail closed',()=>{
  const fs=[{name:'n',width:8}];
  assert.equal(makeLayoutPlan(fs,0,'soa').physicalBytes,0);
  assert.equal(makeLayoutPlan(fs,5,'aosoa',4).physicalBytes,64);
  assert.equal(makeLayoutPlan(fs,5,'soaos',4).physicalBytes,128);
  assert.throws(()=>makeLayoutPlan(fs,5,'aosoa',4,63),/quota/);
  assert.throws(()=>makeLayoutPlan([{name:'n',width:3}],5,'aos'),/geometry/);
  assert.throws(()=>makeLayoutPlan(fs,65537,'soa'),/geometry/);
  assert.throws(()=>makeLayoutPlan(fs,5,'soa',0),/geometry/);
  assert.throws(()=>makeLayoutPlan(fs,5,'unknown'),/geometry/);
});
