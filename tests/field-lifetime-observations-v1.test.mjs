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
    if(row.status==='BOOTSTRAP_NOT_EXECUTED'){
      assert.equal(row.receipt,null);assert.equal(row.positive_guest_executed,null);
      assert.equal(row.negative_rejected,null);assert.equal(row.negative_admitted,null);
      continue;
    }
    assert.match(row.receipt,/^https:\/\/github\.com\/[a-z0-9-]+\/atto-ci\/actions\/runs\/\d+\/job\/\d+$/);
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
