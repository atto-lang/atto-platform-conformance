import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const load=name=>JSON.parse(readFileSync(new URL('../contracts/'+name,import.meta.url),'utf8'));
const observed=load('field-lifetime-observations-v1.json');
const profileBytes=readFileSync(new URL('../contracts/field-lifetime-source-profile-v1.json',import.meta.url));
const source=JSON.parse(profileBytes);
function validate(doc){
  assert.equal(doc.schema,'atto.field-lifetime-observations.v1');
  assert.equal(doc.full_parity_certified,false);
  assert.equal(doc.profile_blob,createHash('sha1').update('blob '+profileBytes.length+'\0').update(profileBytes).digest('hex'));
  assert.equal(doc.observations.length,11);
  assert.deepEqual(doc.observations.map(r=>r.repo).sort(),Object.keys(source.backend_targets).sort());
  for(const row of doc.observations){
    assert.match(row.commit,/^[a-f0-9]{40}$/); assert.match(row.tree,/^[a-f0-9]{40}$/);
    const bootstrap = ['atto-lang/atto-source.atto','atto-lang/atto-source.realtime'].includes(row.repo);
    assert.equal(row.status==='BOOTSTRAP_NOT_EXECUTED',bootstrap);
    assert.equal(row.status==='SPECIALIZED_PROFILE_DISCOVERY',row.repo==='atto-lang/atto-source.hdl');
    if(row.status==='BOOTSTRAP_NOT_EXECUTED'){
      assert.equal(row.receipt,null);assert.equal(row.positive_guest_executed,null);
      assert.equal(row.negative_rejected,null);assert.equal(row.negative_admitted,null);
      continue;
    }
    assert.match(row.receipt,/^https:\/\/github\.com\/[a-z0-9-]+\/atto-ci\/actions\/runs\/\d+\/job\/\d+$/);
    for(const [key,limit] of [['positive_guest_executed',8],['negative_rejected',11],['negative_admitted',11]]) {
      assert.ok(Number.isSafeInteger(row[key]) && row[key]>=0 && row[key]<=limit, key);
    }
    assert.equal(row.negative_rejected+row.negative_admitted,11);
    if(row.status==='REFERENCE_GUEST_EXECUTED'||row.status==='SHARED_COMPILER_GUEST_EXECUTED'){
      assert.equal(row.repo,row.status==='REFERENCE_GUEST_EXECUTED'?'atto-lang/atto-source.rs':'atto-lang/atto-source.wasm');
      assert.equal(row.positive_guest_executed,8);assert.equal(row.negative_rejected,11);
    }else {
      assert.ok(['DISCOVERY_FAILED','SPECIALIZED_PROFILE_DISCOVERY'].includes(row.status));
      assert.equal(row.positive_guest_executed,0);
    }
  }
}
test('observations preserve evidence boundaries and all eleven targets',()=>validate(observed));
test('unsupported rejection cannot promote into executable parity',()=>{
  for(const mutate of [d=>d.full_parity_certified=true,d=>d.observations.find(r=>r.repo.endsWith('.llvm')).status='REFERENCE_GUEST_EXECUTED',d=>d.observations.find(r=>r.repo.endsWith('.realtime')).negative_rejected=11,d=>d.observations.pop()]){
    const d=structuredClone(observed);mutate(d);assert.throws(()=>validate(d));
  }
});

test('reject malformed observation counts and unauthorized profile reclassification',()=>{
  const java=d=>d.observations.find(r=>r.repo.endsWith('.java'));
  const llvm=d=>d.observations.find(r=>r.repo.endsWith('.llvm'));
  for(const mutate of [
    d=>{java(d).negative_rejected=-1;java(d).negative_admitted=12;},
    d=>{java(d).negative_rejected=9.5;java(d).negative_admitted=1.5;},
    d=>{java(d).negative_rejected='9';java(d).negative_admitted='2';},
    d=>{java(d).positive_guest_executed=9;},
    d=>{llvm(d).status='SPECIALIZED_PROFILE_DISCOVERY';},
    d=>{Object.assign(llvm(d),{status:'BOOTSTRAP_NOT_EXECUTED',receipt:null,positive_guest_executed:null,negative_rejected:null,negative_admitted:null});},
    d=>{d.observations.find(r=>r.repo.endsWith('.hdl')).status='DISCOVERY_FAILED';}
  ]){
    const d=structuredClone(observed);mutate(d);assert.throws(()=>validate(d));
  }
});
