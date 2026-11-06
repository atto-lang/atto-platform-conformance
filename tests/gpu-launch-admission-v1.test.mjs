import test from 'node:test';
import assert from 'node:assert/strict';
import {validate_gpu_launch_v1 as admit} from '../src/gpu-launch-admission-v1.mjs';

const baseline = () => ({
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
      access:'write',layout:'soa',element_bytes:4,fence_state:'idle'}
  ]
});
const deny = (code, mutate) => {
  const x=baseline();mutate(x);
  assert.throws(()=>admit(x),e=>e?.code===code,code);
};
test('valid descriptor is only static schema admission, NEVER hardware proof',()=>{
  const a=admit(baseline());
  assert.deepEqual(a,{admission:'STATIC_SCHEMA_ONLY',physical_gpu_verified:false,
    logical_threads:'4096',threads_per_block:'256',reserved_allocation_bytes:'8192',
    device_id:'device0',buffer_bindings:2});
  assert.ok(Object.isFrozen(a));
});
test('GPU command never degrades to CPU',()=>deny('NO_CPU_FALLBACK',x=>x.backend='cpu'));
for(const [name,code,mutate] of [
  ['unknown backend','NO_CPU_FALLBACK',x=>x.backend='host'],
  ['tenant spoof','TENANT_MISMATCH',x=>x.device.tenant_id='tenantB'],
  ['capability wrong tenant','CAPABILITY_MISMATCH',x=>x.capability.tenant_id='tenantB'],
  ['capability wrong device','CAPABILITY_MISMATCH',x=>x.capability.device_id='device1'],
  ['capability disabled','GPU_CAPABILITY_REQUIRED',x=>x.capability.gpu=false],
  ['device without matching tenant','BUFFER_DOMAIN',x=>x.buffers[0].tenant_id='tenantB'],
  ['device id mismatch','BUFFER_DOMAIN',x=>x.buffers[1].device_id='device1'],
  ['zero generation','INVALID_INTEGER',x=>x.buffers[0].generation=0],
  ['fractional generation','INVALID_INTEGER',x=>x.buffers[0].generation=1.5],
  ['negative generation','INVALID_INTEGER',x=>x.buffers[0].generation=-1],
  ['generation reuse','STALE_ALLOCATION',x=>{x.buffers[1].allocation_id='x';x.buffers[1].generation=3}],
  ['same alias read/write','WRITE_ALIAS',x=>{x.buffers[1].allocation_id='x';x.buffers[1].generation=1}],
  ['double write alias','WRITE_ALIAS',x=>{x.buffers[0].access='write';x.buffers[1].allocation_id='x';x.buffers[1].generation=1}],
  ['capacity mismatch','STALE_ALLOCATION',x=>{x.buffers[1].allocation_id='x';x.buffers[1].generation=1;x.buffers[1].allocation_bytes=1024;x.buffers[1].length_bytes=1024}],
  ['inflight buffer','IN_FLIGHT_BUFFER',x=>x.buffers[0].fence_state='submitted'],
  ['borrowed buffer','IN_FLIGHT_BUFFER',x=>x.buffers[0].fence_state='loaned'],
  ['misaligned buffer','BUFFER_BOUNDS',x=>x.buffers[0].offset_bytes=2],
  ['overrun buffer','BUFFER_BOUNDS',x=>x.buffers[0].length_bytes=4097],
  ['invalid element size','BUFFER_BOUNDS',x=>x.buffers[0].element_bytes=3],
  ['invalid layout','BUFFER_LAYOUT',x=>x.buffers[0].layout='unknown'],
  ['invalid access','BUFFER_ACCESS',x=>x.buffers[0].access='atomic'],
  ['zero length','INVALID_INTEGER',x=>x.buffers[0].length_bytes=0],
  ['resident quota','DEVICE_QUOTA',x=>x.capability.max_device_bytes=8191],
  ['no buffers','EMPTY_LAUNCH',x=>x.buffers=[]],
  ['zero grid','INVALID_INTEGER',x=>x.grid[0]=0],
  ['negative grid','INVALID_INTEGER',x=>x.grid[1]=-1],
  ['fractional grid','INVALID_INTEGER',x=>x.grid[1]=1.3],
  ['non number block','INVALID_INTEGER',x=>x.block[0]='256'],
  ['grid dims','INVALID_DIMENSIONS',x=>x.grid=[256]],
  ['dim max','LAUNCH_LIMIT',x=>x.grid[0]=65536],
  ['block max','LAUNCH_LIMIT',x=>x.block[0]=1025],
  ['threads per block','LAUNCH_LIMIT',x=>x.block=[64,32,1]],
  ['total threads quota','LAUNCH_QUOTA',x=>x.grid=[257,1,1]],
  ['shared memory cap','SHARED_MEMORY_LIMIT',x=>x.shared_bytes=49153],
  ['negative shared memory','INVALID_INTEGER',x=>x.shared_bytes=-1],
  ['unbounded device limits','INVALID_INTEGER',x=>x.device.max_block[0]=Infinity],
  ['host io effect','INVALID_FEATURE',x=>x.kernel.effects.push('host.io')],
  ['actor state effect','INVALID_FEATURE',x=>x.kernel.effects.push('actor.state')],
  ['host pointer effect','INVALID_FEATURE',x=>x.kernel.effects.push('host.pointer')],
  ['unrecognized capability','INVALID_FEATURE',x=>x.kernel.features.push('cuda_magic')],
  ['missing capability','UNSUPPORTED_FEATURE',x=>x.kernel.features.push('tensor')],
  ['unsupported atomic scope','UNSUPPORTED_SCOPE',x=>{x.kernel.effects.push('device.atomic');x.kernel.atomic_scopes=['system']}],
  ['atomic scope without effect','INVALID_DEVICE_EFFECT',x=>x.kernel.atomic_scopes=['block']],
  ['atomic effect without scope','INVALID_DEVICE_EFFECT',x=>x.kernel.effects.push('device.atomic')],
  ['cluster scope without feature','UNSUPPORTED_FEATURE',x=>{x.device.atomic_scopes.push('cluster');x.kernel.effects.push('device.atomic');x.kernel.atomic_scopes=['cluster']}],
  ['divergent barrier','DIVERGENT_BARRIER',x=>x.kernel.effects.push('device.barrier')],
  ['write without effect','INVALID_DEVICE_EFFECT',x=>x.kernel.effects=['device.read']],
  ['read without effect','INVALID_DEVICE_EFFECT',x=>x.kernel.effects=['device.write']],
  ['duplicate effect','INVALID_FEATURE',x=>x.kernel.effects.push('device.read')],
  ['unknown nested fields','INVALID_DESCRIPTOR',x=>x.buffers[0].device_handle=77],
  ['missing field','INVALID_DESCRIPTOR',x=>delete x.device.id],
  ['inherited top field','INVALID_DESCRIPTOR',x=>Object.setPrototypeOf(x,{evil:true})],
  ['non-integer quota','INVALID_INTEGER',x=>x.capability.max_device_bytes=2**54],
  ['invalid tenant identifier','INVALID_ID',x=>x.tenant_id=''],
  ['sparse dimensions','INVALID_DESCRIPTOR',x=>{delete x.block[1]}],
  ['accessor injection','INVALID_DESCRIPTOR',x=>Object.defineProperty(x.buffers[0],'allocation_bytes',{get(){throw Error('NEVER CALLED')},enumerable:true})],
  ['extra symbol field','INVALID_DESCRIPTOR',x=>x.kernel[Symbol('extra')]='invisible'],
  ['array metadata','INVALID_DESCRIPTOR',x=>x.grid.evil=true],
]) test(`fail closed: ${name}`,()=>deny(code,mutate));

test('duplicate read-only views of one generation count physical bytes once',()=>{
  const x=baseline();x.buffers[1]={...x.buffers[0]};
  x.kernel.effects=['device.read'];
  const result=admit(x);
  assert.equal(result.reserved_allocation_bytes,'4096');
  assert.equal(result.buffer_bindings,2);
});
test('atomic block scope and uniform barriers are only descriptor checks',()=>{
  const x=baseline(); x.kernel.effects.push('device.atomic','device.barrier');
  x.kernel.atomic_scopes=['block'];x.kernel.uniform_barrier=true;
  assert.equal(admit(x).physical_gpu_verified,false);
});
test('device feature matching cannot attest actual tensor hardware',()=>{
  const x=baseline();x.kernel.features=['tensor'];x.device.features=['subgroup','tensor'];
  assert.equal(admit(x).admission,'STATIC_SCHEMA_ONLY');
});
