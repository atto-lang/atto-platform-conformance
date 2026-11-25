import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGpuExecutionEvidenceV1 as verify} from '../src/gpu-execution-evidence-v1.mjs';

const phases = ['source_checkout','guest_compile','guest_execute','device_event','numeric_oracle'];
const expected = () => ({
  head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),fixture_blob_sha:'c'.repeat(40),
  backend:'llvm',run_id:90,run_attempt:2,job_id:12,artifact_sha256:'d'.repeat(64),
  kernel_name:'saxpy',tenant_id:'tenant-1',device_vendor:'vendor-1',device_id:'gpu:0',
  queue_generation:2,allocation_generation:17,submission_id:'evt-1',
  oracle_artifact_sha256:'e'.repeat(64),output_samples:256,maximum_absolute_tolerance:0.001
});
const receipt = () => ({
  source:{head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),fixture_blob_sha:'c'.repeat(40)},
  run:{run_id:90,run_attempt:2,job_id:12,status:'completed',conclusion:'success',
    steps:phases.map(name=>({name,status:'completed',conclusion:'success'}))},
  compiler:{backend:'llvm',compiled_guest:true,artifact_sha256:'d'.repeat(64),source_language:'atto'},
  guest:{executed:true,kernel_name:'saxpy',exit_code:0},
  device:{kind:'physical_gpu',tenant_id:'tenant-1',vendor:'vendor-1',device_id:'gpu:0',
    queue_generation:2,allocation_generation:17,submission_id:'evt-1',
    fence_state:'completed',event_observed:true},
  numerics:{oracle:'independent_cpu',oracle_artifact_sha256:'e'.repeat(64),
    samples:256,max_absolute_error:0.00001,tolerance:0.001}
});
const mutate = (label, code, fn) => test(label, () => {
  const r=receipt(), e=expected();fn(r,e);
  assert.throws(()=>verify(r,e),x=>x.code===code, label);
});

test('matching candidate is immutable and explicitly unattested',()=>{
  const v=verify(receipt(),expected());
  assert.equal(v.classification,'PHYSICAL_GPU_CANDIDATE_UNATTESTED');
  assert.equal(Object.isFrozen(v),true);
  assert.match(v.caveat,/independently/);
});
for(const backend of ['java','llvm','net','wasm','forge','cranelift'])
  test(`valid ${backend} candidate remains unattested`,()=>{
    const r=receipt(),e=expected();r.compiler.backend=e.backend=backend;
    assert.equal(verify(r,e).classification,'PHYSICAL_GPU_CANDIDATE_UNATTESTED');
  });
test('extra successful unrelated steps are allowed',()=>{
  const r=receipt();r.run.steps.unshift({name:'toolchain_setup',status:'completed',conclusion:'success'});
  assert.equal(verify(r,expected()).classification,'PHYSICAL_GPU_CANDIDATE_UNATTESTED');
});

// PR and fixture identity: exact matching independently pinned values.
mutate('wrong PR head','GPU-EVIDENCE-002',r=>r.source.head_sha='f'.repeat(40));
mutate('wrong tree','GPU-EVIDENCE-002',r=>r.source.tree_sha='f'.repeat(40));
mutate('wrong fixture blob','GPU-EVIDENCE-002',r=>r.source.fixture_blob_sha='f'.repeat(40));
mutate('malformed source head','GPU-EVIDENCE-002',r=>r.source.head_sha='zzz');
mutate('bad expected SHA','GPU-EVIDENCE-002',(_,e)=>e.fixture_blob_sha='not-git-sha');
mutate('expected unsupported backend','GPU-EVIDENCE-001',(_,e)=>e.backend='cuda');
mutate('unexpected schema field','GPU-EVIDENCE-001',r=>r.unsafe_bypass=true);
mutate('expected unexpected schema field','GPU-EVIDENCE-001',(_,e)=>e.unsafe_bypass=true);
mutate('expected from a Date','GPU-EVIDENCE-001',(_,e)=>Object.setPrototypeOf(e,Date.prototype));

// CI admission: no generic green step, step omission, duplicate, skipped or out-of-order.
mutate('wrong run id','GPU-EVIDENCE-003',r=>r.run.run_id=100);
mutate('wrong attempt','GPU-EVIDENCE-003',r=>r.run.run_attempt=1);
mutate('wrong job id','GPU-EVIDENCE-003',r=>r.run.job_id=100);
mutate('zero run attempt','GPU-EVIDENCE-003',r=>r.run.run_attempt=0);
mutate('unsafe integer run id','GPU-EVIDENCE-003',r=>r.run.run_id=Number.MAX_SAFE_INTEGER+1);
mutate('failed overall job despite green steps','GPU-EVIDENCE-003',r=>r.run.conclusion='failure');
mutate('cancelled overall job','GPU-EVIDENCE-003',r=>r.run.conclusion='cancelled');
mutate('queued overall job','GPU-EVIDENCE-003',r=>r.run.status='queued');
mutate('no CI steps','GPU-EVIDENCE-001',r=>r.run.steps=[]);
mutate('null CI steps','GPU-EVIDENCE-001',r=>r.run.steps=null);
mutate('only generic green step','GPU-EVIDENCE-001',r=>r.run.steps=[{name:'smoke',status:'completed',conclusion:'success'}]);
mutate('missing device fence step','GPU-EVIDENCE-003',r=>r.run.steps.splice(3,1,{name:'generic',status:'completed',conclusion:'success'}));
mutate('out-of-order required phases','GPU-EVIDENCE-003',r=>r.run.steps.reverse());
mutate('duplicate success step','GPU-EVIDENCE-003',r=>r.run.steps.push({...r.run.steps[0]}));
mutate('failed trailing unrelated step','GPU-EVIDENCE-003',r=>r.run.steps.push({name:'cleanup',status:'completed',conclusion:'failure'}));
mutate('queued trailing unrelated step','GPU-EVIDENCE-003',r=>r.run.steps.push({name:'cleanup',status:'queued',conclusion:null}));
mutate('skipped required phase','GPU-EVIDENCE-003',r=>r.run.steps[1].conclusion='skipped');
mutate('CI success but step not completed','GPU-EVIDENCE-003',r=>r.run.steps[4].status='in_progress');
mutate('CI sparse steps','GPU-EVIDENCE-001',r=>r.run.steps=new Array(5));
mutate('CI step accessor injection','GPU-EVIDENCE-001',r=>Object.defineProperty(r.run.steps[3],'name',{get(){throw Error('not invoked')}}));
mutate('trailing CI step accessor injection','GPU-EVIDENCE-001',r=>r.run.steps.push({name:'cleanup',status:'completed',get conclusion(){throw Error('not invoked')}}));
mutate('trailing CI step with extra field','GPU-EVIDENCE-001',r=>r.run.steps.push({name:'cleanup',status:'completed',conclusion:'success',bypass:true}));
mutate('CI step array extra field','GPU-EVIDENCE-001',r=>r.run.steps.override=true);
mutate('CI step array too long','GPU-EVIDENCE-001',r=>r.run.steps=Array.from({length:257},(_,i)=>({name:`step-${i}`,status:'completed',conclusion:'success'})));
mutate('CI duplicate phase with late step','GPU-EVIDENCE-003',r=>r.run.steps.push({name:'device_event',status:'completed',conclusion:'success'}));
mutate('expected run ID not positive','GPU-EVIDENCE-001',(_,e)=>e.run_id=0);
mutate('expected run attempt not positive','GPU-EVIDENCE-001',(_,e)=>e.run_attempt=Infinity);

// Compiler and guest source identity.
mutate('backend impersonation','GPU-EVIDENCE-004',r=>r.compiler.backend='java');
mutate('no guest compilation','GPU-EVIDENCE-004',r=>r.compiler.compiled_guest=false);
mutate('host-only source','GPU-EVIDENCE-004',r=>r.compiler.source_language='c++');
mutate('no artifact digest','GPU-EVIDENCE-004',r=>r.compiler.artifact_sha256='');
mutate('artifact digest mismatch','GPU-EVIDENCE-004',r=>r.compiler.artifact_sha256='f'.repeat(64));
mutate('bad expected artifact hash','GPU-EVIDENCE-001',(_,e)=>e.artifact_sha256='bad');
mutate('guest never ran','GPU-EVIDENCE-005',r=>r.guest.executed=false);
mutate('guest exited unsuccessfully','GPU-EVIDENCE-005',r=>r.guest.exit_code=139);
mutate('wrong kernel entrypoint','GPU-EVIDENCE-005',r=>r.guest.kernel_name='vector_add');
mutate('expected kernel invalid','GPU-EVIDENCE-001',(_,e)=>e.kernel_name='');

// Physical GPU identity, tenancy, queue/alloc fencing, observed event.
mutate('CPU fallback','GPU-EVIDENCE-006',r=>r.device.kind='cpu');
mutate('unobserved completion','GPU-EVIDENCE-006',r=>r.device.event_observed=false);
mutate('device fence pending','GPU-EVIDENCE-006',r=>r.device.fence_state='pending');
mutate('device fence canceled','GPU-EVIDENCE-006',r=>r.device.fence_state='canceled');
mutate('wrong tenant','GPU-EVIDENCE-006',r=>r.device.tenant_id='tenant-2');
mutate('wrong physical device','GPU-EVIDENCE-006',r=>r.device.device_id='gpu:1');
mutate('wrong device vendor','GPU-EVIDENCE-006',r=>r.device.vendor='impostor');
mutate('wrong submission ticket','GPU-EVIDENCE-006',r=>r.device.submission_id='evt-2');
mutate('stale queue generation','GPU-EVIDENCE-006',r=>r.device.queue_generation=1);
mutate('zero queue generation','GPU-EVIDENCE-006',r=>r.device.queue_generation=0);
mutate('stale allocation generation','GPU-EVIDENCE-006',r=>r.device.allocation_generation=16);
mutate('zero allocation generation','GPU-EVIDENCE-006',r=>r.device.allocation_generation=0);
mutate('expected queue generation absent','GPU-EVIDENCE-001',(_,e)=>e.queue_generation=0);
mutate('expected device vendor missing','GPU-EVIDENCE-001',(_,e)=>e.device_vendor='');

// Numerical policy MUST be independently pinned, complete, and finite.
mutate('device self-test not independent oracle','GPU-EVIDENCE-007',r=>r.numerics.oracle='device');
mutate('wrong oracle artifact','GPU-EVIDENCE-007',r=>r.numerics.oracle_artifact_sha256='f'.repeat(64));
mutate('oracle artifact malformed','GPU-EVIDENCE-007',r=>r.numerics.oracle_artifact_sha256='garbage');
mutate('missing oracle sample','GPU-EVIDENCE-007',r=>r.numerics.samples=255);
mutate('extra oracle sample','GPU-EVIDENCE-007',r=>r.numerics.samples=257);
mutate('no oracle samples','GPU-EVIDENCE-007',r=>r.numerics.samples=0);
mutate('negative max error','GPU-EVIDENCE-007',r=>r.numerics.max_absolute_error=-0.1);
mutate('infinite max error','GPU-EVIDENCE-007',r=>r.numerics.max_absolute_error=Infinity);
mutate('NaN tolerance','GPU-EVIDENCE-007',r=>r.numerics.tolerance=NaN);
mutate('inflated self-selected tolerance','GPU-EVIDENCE-007',r=>r.numerics.tolerance=1e9);
mutate('overshoot within pinned tolerance','GPU-EVIDENCE-007',r=>r.numerics.max_absolute_error=0.01);
mutate('negative tolerance','GPU-EVIDENCE-007',r=>r.numerics.tolerance=-0.1);
mutate('pinned expected tolerance invalid','GPU-EVIDENCE-001',(_,e)=>e.maximum_absolute_tolerance=NaN);
mutate('pinned expected samples unsafe','GPU-EVIDENCE-001',(_,e)=>e.output_samples=Number.MAX_SAFE_INTEGER+1);
mutate('pinned expected oracle SHA invalid','GPU-EVIDENCE-001',(_,e)=>e.oracle_artifact_sha256='incorrect');

// Deterministic negative-mutation stress for cross-field identity and quota drift.
test('512 deterministic exact-identity, sample-count, and tolerance mutations reject',()=>{
  let state=0x495aab1;
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let i=0;i<512;i++){
    const r=receipt(),e=expected();
    switch(next()%8){
      case 0:r.run.run_id=100+(next()%10000);break;
      case 1:r.run.job_id=100+(next()%10000);break;
      case 2:r.compiler.artifact_sha256='f'.repeat(64);break;
      case 3:r.device.submission_id=`evt-${100+(next()%10000)}`;break;
      case 4:r.device.queue_generation=3+(next()%100);break;
      case 5:r.numerics.samples=1+(next()%200);break;
      case 6:r.numerics.tolerance=1+(next()%100);break;
      case 7:r.source.tree_sha='f'.repeat(40);break;
    }
    assert.throws(()=>verify(r,e),x=>x.code.startsWith('GPU-EVIDENCE-'),`mutation ${i}`);
  }
});
