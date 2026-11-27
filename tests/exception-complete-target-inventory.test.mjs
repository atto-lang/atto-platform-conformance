import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const suites=[
 ['exception-control-bang',28],['exception-unwind-ownership',20],
 ['exception-async-result',12],['exception-allocation-aot',10]
];
test('all seventy immutable exception target sources retain their exact bytes and no fabricated pass',()=>{
  let total=0,cells=0;
  for(const [suite,count] of suites){
    const path='fixtures/'+suite+'/v1/';
    const m=JSON.parse(read(path+'manifest.json'));
    assert.equal(m.status,'TARGET_NOT_CERTIFIED');
    assert.equal(m.cases.length,count);
    assert.equal(new Set(m.cases.map(c=>c.id)).size,count);
    assert.equal(new Set(m.backend_names).size,11);
    assert.deepEqual(readdirSync(new URL(path,root)).filter(p=>p.endsWith('.atto')).sort(),m.cases.map(c=>c.path).sort());
    for(const c of m.cases){
      assert.match(c.path,/^[a-z-]+\.atto$/);
      assert.equal(gitBlob(read(path+c.path)),c.git_blob_sha1,c.id);
      assert.deepEqual(Object.keys(c.backend_statuses).sort(),[...m.backend_names].sort());
      assert.ok(Object.values(c.backend_statuses).every(s=>s==='NOT_EXECUTED'));
      total++;cells+=Object.keys(c.backend_statuses).length;
    }
    for(const r of m.authority_refs??[])assert.equal(gitBlob(read(r.path)),r.git_blob_sha1,r.path);
  }
  assert.equal(total,70);assert.equal(cells,770);
});
test('async target witnesses require real suspension and Result typing',()=>{
  const m=JSON.parse(read('fixtures/exception-async-result/v1/manifest.json'));
  assert.equal(m.cases.filter(c=>c.expected.kind==='compile_rejection').length,2);
  const cancel=m.cases.find(c=>c.id==='cancel-suspended-trap').expected;
  assert.equal(cancel.terminal,'cancelled_after_physical_cleanup');
  assert.ok(cancel.required_observations.includes('real_suspend'));
  assert.ok(cancel.required_observations.includes('no_double_resume'));
  for(const c of m.cases.filter(c=>c.id.endsWith('after-await')||c.id==='preserve-result-err')){
    assert.ok(c.expected.required_observations.includes('real_suspend'),c.id);
    assert.ok(c.expected.required_observations.includes('same_invocation_resumed'),c.id);
  }
});
test('AOT measurement targets distinguish zero allocations from bounded retirement and host collection',()=>{
  const m=JSON.parse(read('fixtures/exception-allocation-aot/v1/manifest.json'));
  assert.equal(m.cases.filter(c=>c.expected.allocation_policy.max_guest_heap_allocations===0).length,6);
  assert.equal(m.cases.filter(c=>c.expected.allocation_policy.require_exact_retirement).length,4);
  assert.ok(m.cases.every(c=>c.expected.allocation_policy.host_gc_disclosed));
  assert.equal(m.cases.find(c=>c.id==='repeated-exception-retirement').expected.repeat_policy.minimum_invocations,100000);
  assert.ok(m.profiles.native_aot.includes('no runtime compiler'));
});
