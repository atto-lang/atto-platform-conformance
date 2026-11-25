// Source-free reference oracle, not compiled AttoLang guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';

const golden = JSON.parse(readFileSync(new URL(
  '../contracts/dop-heterogeneous-soa-quota-v1.json', import.meta.url),'utf8'));
const fields = golden.columns.map(({name,type})=>({name,type}));
const quota = BigInt(golden.max_total_bytes);
const plan = (n,extra={})=>computeLayoutAbi({layout:'soa',fields,capacity:n,...extra});

test('SoA schema is host-only, never guest parity',()=>{
  assert.equal(golden.contract,'attolang.dop.heterogeneous-soa-quota/1');
  assert.equal(golden.backend_guest_status,'NOT_EXECUTED');
  assert.deepEqual(fields.map(x=>x.type),['bool','i64','bool']);
});

test('golden physical offsets, payloads and last row addresses',()=>{
  for(const c of golden.scenarios){
    const p=plan(c.capacity);
    assert.equal(String(p.physicalBytes),c.physical_bytes);
    assert.deepEqual(p.segments.map(x=>String(x.base)),c.segment_bases);
    assert.deepEqual(p.segments.map(x=>x.align),[1n,8n,1n]);
    assert.equal(String(p.segments[2].base+p.address(c.capacity-1,'ready').byteOffset),
                 c.last_ready_global_offset);
    for(const [i,name,width] of [[0,'flag',1n],[1,'ticks',8n],[2,'ready',1n]]){
      const last=p.address(c.capacity-1,name);
      assert.equal(last.segment,i);
      assert.ok(last.byteOffset+width <= p.segments[i].bytes);
    }
  }
});

test('16MiB physical quota denies one extra byte even when nominal fits',()=>{
  for(const c of golden.scenarios){
    assert.equal(String(10n*BigInt(c.capacity)),c.packed_total_bytes);
    assert.ok(BigInt(c.physical_bytes)>=BigInt(c.packed_total_bytes));
    if(c.quota_allowed)assert.equal(String(plan(c.capacity,{maxTotalBytes:quota}).physicalBytes),c.physical_bytes);
    else assert.throws(()=>plan(c.capacity,{maxTotalBytes:quota}),/quota/);
  }
  assert.equal(BigInt(golden.scenarios[3].physical_bytes)-quota,1n);
  assert.ok(BigInt(golden.scenarios[3].packed_total_bytes)<quota);
});

test('bad fields, positions and per-segment caps reject',()=>{
  const p=plan(2);
  assert.throws(()=>p.address(2,'ticks'));
  assert.throws(()=>p.address(-1,'ticks'));
  assert.throws(()=>p.address(0,'missing'));
  assert.throws(()=>plan(2,{maxSegmentBytes:15n}),/segment/);
  assert.throws(()=>plan(2,{maxTotalBytes:25n}),/quota/);
});
