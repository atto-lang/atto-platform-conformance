import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGpuExecutionEvidenceV1 as verify} from '../src/gpu-execution-evidence-v1.mjs';
const expected = () => ({head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),fixture_blob_sha:'c'.repeat(40),backend:'llvm'});
const receipt = () => ({
  source:{head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),fixture_blob_sha:'c'.repeat(40)},
  run:{run_id:90,run_attempt:2,job_id:12,steps:[{name:'compiled-device',status:'completed',conclusion:'success'}]},
  compiler:{backend:'llvm',compiled_guest:true,artifact_sha256:'d'.repeat(64),source_language:'atto'},
  guest:{executed:true,kernel_name:'saxpy',exit_code:0},
  device:{kind:'physical_gpu',vendor:'example',device_id:'gpu:0',queue_generation:2,submission_id:'evt-1',fence_state:'completed',event_observed:true},
  numerics:{oracle:'independent_cpu',samples:256,max_absolute_error:0.00001,tolerance:0.001}
});
const mutate = (label, code, fn) => test(label, () => {
  const r = receipt(), e = expected(); fn(r,e);
  assert.throws(() => verify(r,e), err => err.code === code);
});
test('positive structurally admissible candidate remains explicitly UNATTESTED', () => {
  const result = verify(receipt(), expected());
  assert.equal(result.classification,'PHYSICAL_GPU_CANDIDATE_UNATTESTED');
  assert.equal(Object.isFrozen(result),true);
});
mutate('wrong PR head','GPU-EVIDENCE-002',r=>{r.source.head_sha='f'.repeat(40)});
mutate('wrong tree','GPU-EVIDENCE-002',r=>{r.source.tree_sha='f'.repeat(40)});
mutate('wrong fixture blob','GPU-EVIDENCE-002',r=>{r.source.fixture_blob_sha='f'.repeat(40)});
mutate('zero run attempt','GPU-EVIDENCE-003',r=>{r.run.run_attempt=0});
mutate('no CI steps','GPU-EVIDENCE-001',r=>{r.run.steps=[]});
mutate('null CI steps','GPU-EVIDENCE-001',r=>{r.run.steps=null});
mutate('CI only queued','GPU-EVIDENCE-003',r=>{r.run.steps[0].status='queued';r.run.steps[0].conclusion=null});
mutate('CI step failed','GPU-EVIDENCE-003',r=>{r.run.steps[0].conclusion='failure'});
mutate('backend impersonation','GPU-EVIDENCE-004',r=>{r.compiler.backend='java'});
mutate('no compiled guest','GPU-EVIDENCE-004',r=>{r.compiler.compiled_guest=false});
mutate('host-only compiled language','GPU-EVIDENCE-004',r=>{r.compiler.source_language='c++'});
mutate('no artifact hash','GPU-EVIDENCE-004',r=>{r.compiler.artifact_sha256=''});
mutate('no guest execution','GPU-EVIDENCE-005',r=>{r.guest.executed=false});
mutate('guest crashed','GPU-EVIDENCE-005',r=>{r.guest.exit_code=139});
mutate('CPU fallback','GPU-EVIDENCE-006',r=>{r.device.kind='cpu'});
mutate('unobserved event','GPU-EVIDENCE-006',r=>{r.device.event_observed=false});
mutate('stale queue generation','GPU-EVIDENCE-006',r=>{r.device.queue_generation=0});
mutate('device fence still pending','GPU-EVIDENCE-006',r=>{r.device.fence_state='pending'});
mutate('not independent oracle','GPU-EVIDENCE-007',r=>{r.numerics.oracle='device'});
mutate('no numeric samples','GPU-EVIDENCE-007',r=>{r.numerics.samples=0});
mutate('numeric mismatch','GPU-EVIDENCE-007',r=>{r.numerics.max_absolute_error=1});
mutate('NaN tolerance','GPU-EVIDENCE-007',r=>{r.numerics.tolerance=NaN});
mutate('Infinity result','GPU-EVIDENCE-007',r=>{r.numerics.max_absolute_error=Infinity});
mutate('unexpected metadata key','GPU-EVIDENCE-001',r=>{r.unsafe_bypass=true});
mutate('accessor injection','GPU-EVIDENCE-001',r=>{Object.defineProperty(r.device,'vendor',{get(){throw Error('executed getter')}})});
mutate('sparse steps','GPU-EVIDENCE-001',r=>{r.run.steps=new Array(1)});
mutate('duplicate malicious step property','GPU-EVIDENCE-001',r=>{r.run.steps[0].other='extra'});
test('reject direct caller-controlled expected source mismatch',()=>{
  const e=expected();e.backend='cuda';
  assert.throws(()=>verify(receipt(),e),x=>x.code==='GPU-EVIDENCE-001');
});

test('reject malformed trailing CI step even after successful first step', () => {
  const r = receipt();
  r.run.steps.push({name:'forged',status:'completed',conclusion:'success',bypass:true});
  assert.throws(()=>verify(r,expected()),x=>x.code==='GPU-EVIDENCE-001');
});
test('reject CI step throwing accessor even after successful first step', () => {
  const r = receipt();
  const forged = {name:'forged',status:'completed',conclusion:'success'};
  Object.defineProperty(forged,'name',{get(){throw Error('malicious getter')}});
  r.run.steps.push(forged);
  assert.throws(()=>verify(r,expected()),x=>x.code==='GPU-EVIDENCE-001');
});
