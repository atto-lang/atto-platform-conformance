/** Additional G0 host-only adversarial tests; not guest execution or GPU attestation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {validate_gpu_launch_v1 as admit} from '../src/gpu-launch-admission-v1.mjs';

const fixture = () => ({
  backend:'gpu', tenant_id:'tenantA',
  device:{id:'device0',tenant_id:'tenantA',max_grid:[65535,65535,65535],
    max_block:[1024,1024,64],max_threads_per_block:1024,max_shared_bytes:49152,
    features:['subgroup'],atomic_scopes:['thread','block','device']},
  capability:{tenant_id:'tenantA',device_id:'device0',gpu:true,
    max_threads_per_launch:65536,max_device_bytes:8192},
  kernel:{name:'saxpy',effects:['device.read','device.write'],features:[],
    atomic_scopes:[],uniform_barrier:false},
  grid:[16,1,1],block:[256,1,1],shared_bytes:0,
  buffers:[
    {tenant_id:'tenantA',device_id:'device0',allocation_id:'x',generation:1,
      allocation_bytes:4096,offset_bytes:0,length_bytes:4096,
      access:'read',layout:'soa',element_bytes:4,fence_state:'idle'},
    {tenant_id:'tenantA',device_id:'device0',allocation_id:'y',generation:9,
      allocation_bytes:4096,offset_bytes:0,length_bytes:4096,
      access:'write',layout:'soa',element_bytes:4,fence_state:'idle'},
  ],
});
const reject = (name, code, change) => test(name, () => {
  const x=fixture();change(x);
  assert.throws(() => admit(x), error => error instanceof TypeError && error.code===code);
});

test('exact thread quota and shared-memory maximum are permitted (schema only)',()=>{
  const x=fixture();x.capability.max_threads_per_launch=4096;
  x.shared_bytes=49152;
  const result=admit(x);
  assert.equal(result.logical_threads,'4096');
  assert.equal(result.physical_gpu_verified,false);
  assert.equal(result.admission,'STATIC_SCHEMA_ONLY');
});

test('1D/2D/3D geometry uses integer products at dimension boundary',()=>{
  for (const [grid,block,threads] of [
    [[1,1,1],[1,1,1],1], [[2,3,5],[4,2,2],480],
    [[1,1,65535],[1,1,1],65535], [[16,16,1],[16,1,1],4096],
  ]) {
    const x=fixture();x.grid=grid;x.block=block;
    x.capability.max_threads_per_launch=threads;
    assert.equal(admit(x).logical_threads,String(threads));
  }
});

test('64 read-only bindings to one generation reserve physical bytes once',()=>{
  const x=fixture();x.buffers=Array.from({length:64},()=>({...x.buffers[0]}));
  x.kernel.effects=['device.read'];x.capability.max_device_bytes=4096;
  const result=admit(x);
  assert.equal(result.buffer_bindings,64);
  assert.equal(result.reserved_allocation_bytes,'4096');
  assert.equal(result.physical_gpu_verified,false);
});

test('null-prototype own-data descriptor is allowed, not inherited authority',()=>{
  const x=fixture();
  x.capability=Object.assign(Object.create(null),x.capability);
  x.kernel=Object.assign(Object.create(null),x.kernel);
  assert.equal(admit(x).admission,'STATIC_SCHEMA_ONLY');
});

test('256 deterministic geometry values agree with independent BigInt thread oracle',()=>{
  let seed=0x51cafe7;
  for (let i=0;i<256;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grid=1+seed%1024;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const block=1+seed%1024;
    const threads=BigInt(grid)*BigInt(block);
    const x=fixture();x.grid=[grid,1,1];x.block=[block,1,1];
    x.capability.max_threads_per_launch=Number(threads);
    assert.equal(admit(x).logical_threads,threads.toString(),'case '+i);
  }
});

test('deterministic quota exact-boundary negative oracle (256 cases)',()=>{
  let seed=0x5ca1ab1e;
  for (let i=0;i<256;i++) {
    seed=(Math.imul(seed,1103515245)+12345)>>>0;
    const grid=2+seed%1023;
    seed=(Math.imul(seed,1103515245)+12345)>>>0;
    const block=1+seed%1024;
    const total=BigInt(grid)*BigInt(block);
    const x=fixture();x.grid=[grid,1,1];x.block=[block,1,1];
    x.capability.max_threads_per_launch=Number(total-1n);
    assert.throws(()=>admit(x),e=>e?.code==='LAUNCH_QUOTA','case '+i);
  }
});

reject('one above 64 binding cap denied','INVALID_DESCRIPTOR',x=>{
  x.buffers=Array.from({length:65},()=>({...x.buffers[0]}));
});
reject('typed-array geometry not mistaken for normal array','INVALID_DESCRIPTOR',x=>{
  x.grid=new Uint32Array([16,1,1]);
});
reject('array with noncanonical prototype is rejected','INVALID_DESCRIPTOR',x=>{
  Object.setPrototypeOf(x.grid,Object.create(Array.prototype));
});
reject('symbol-keyed array metadata is rejected','INVALID_DESCRIPTOR',x=>{
  x.block[Symbol('metadata')]='malicious';
});
reject('array getter must never supply authority','INVALID_DESCRIPTOR',x=>{
  Object.defineProperty(x.grid,0,{get(){throw Error('DO NOT EVALUATE')},enumerable:true});
});
reject('nonenumerable array index is rejected','INVALID_DESCRIPTOR',x=>{
  Object.defineProperty(x.grid,0,{value:16,enumerable:false});
});
reject('nonenumerable extra object key rejected','INVALID_DESCRIPTOR',x=>{
  Object.defineProperty(x.device,'secret',{value:true});
});
reject('getter-backed GPU boolean denied without getter call','INVALID_DESCRIPTOR',x=>{
  Object.defineProperty(x.capability,'gpu',{get(){throw Error('DO NOT EVALUATE')},enumerable:true});
});
reject('prototype-polluted buffer record rejected','INVALID_DESCRIPTOR',x=>{
  Object.setPrototypeOf(x.buffers[0],{tenant_id:'attacker'});
});
reject('boxed GPU backend is never admitted','NO_CPU_FALLBACK',x=>{
  x.backend=new String('gpu');
});
reject('BigInt dimensions are not silently converted','INVALID_INTEGER',x=>{
  x.block[0]=256n;
});
reject('NaN shared-memory quota denied','INVALID_INTEGER',x=>{
  x.shared_bytes=NaN;
});
reject('negative zero quota still fails minimum of one','INVALID_INTEGER',x=>{
  x.capability.max_threads_per_launch=-0;
});
reject('invalid device max-block-thread relationship','INVALID_DEVICE_LIMITS',x=>{
  x.device.max_block=[1,1,1];
});
reject('over-limit shared bytes denied at +1 boundary','SHARED_MEMORY_LIMIT',x=>{
  x.shared_bytes=x.device.max_shared_bytes+1;
});
reject('device allocation at 1 byte above quota denied','DEVICE_QUOTA',x=>{
  x.capability.max_device_bytes=8191;
});
reject('duplicate read/write allocation with reversed loan order denied','WRITE_ALIAS',x=>{
  x.buffers=[{...x.buffers[1],allocation_id:'x',generation:1,access:'write'},x.buffers[0]];
});
reject('duplicate writable same allocation denied','WRITE_ALIAS',x=>{
  x.buffers[1]={...x.buffers[0],access:'read_write'};
});
reject('same allocation generation contradiction denied','STALE_ALLOCATION',x=>{
  x.buffers[1]={...x.buffers[0],generation:2,access:'read'};
});
reject('same allocation capacity contradiction denied','STALE_ALLOCATION',x=>{
  x.buffers[1]={...x.buffers[0],allocation_bytes:8192,access:'read'};
});
reject('GPU device capability quota cannot be string','INVALID_INTEGER',x=>{
  x.capability.max_device_bytes='8192';
});
reject('CPU execution backend cannot be substituted with a symbol','NO_CPU_FALLBACK',x=>{
  x.backend=Symbol.for('gpu');
});
reject('unknown atomic effect must be refused','INVALID_FEATURE',x=>{
  x.kernel.effects.push('device.host_io');
});
reject('features cannot be inherited or forged','INVALID_DESCRIPTOR',x=>{
  Object.setPrototypeOf(x.kernel,{features:['tensor']});
});
reject('declared barrier without compiler uniformity proof denied','DIVERGENT_BARRIER',x=>{
  x.kernel.effects.push('device.barrier');x.kernel.uniform_barrier=false;
});
