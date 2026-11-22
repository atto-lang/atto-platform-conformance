// Core borrow preflight is a SOURCE-ONLY scalar oracle, not a compiler checker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const spec = JSON.parse(readFileSync(
  new URL('contracts/std-metrics-json-zorde-core-borrow-v1.json', root), 'utf8'));
const sha = text => {
  const b = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
};
const valid = (readers,writer,live) =>
  Number.isInteger(readers) && readers>=0 && readers<=65535 &&
  !(writer&&readers!==0) && (live||(readers===0&&!writer));
function admit(x) {
  const {readers,writer,owner_live:live}=x;
  const v=valid(readers,writer,live);
  return {
    valid:v,
    may_read:v&&live&&!writer&&readers<65535,
    may_write:v&&live&&!writer&&readers===0,
    quiescent_owner:v&&live&&readers===0&&!writer,
    may_finish_read:v&&live&&readers>0&&!writer,
    may_finish_write:v&&live&&readers===0&&writer,
    quiescent_boundary:v&&live&&readers===0&&!writer
  };
}
test('core loan-state admission scalar reference rejects invalid or overlapping loans',()=>{
  assert.equal(spec.schema,'atto.stdlib.core.borrow-admission-boundary-v1');
  assert.equal(spec.max_read_loans,65535);
  assert.equal(Object.keys(spec.core_source_paths).length,9);
  for(const backend of ['java','llvm','net','wasm','forge','rs','cranelift','js','hdl']) {
    const path = spec.core_source_paths[backend];
    assert.match(path,/^[a-zA-Z0-9_./-]+borrow_admission\.atto$/,
      'bad core source location for '+backend);
  }
  assert.match(spec.resolver_status_note,/no verified resolver/);

  assert.equal(spec.vectors.length,13);
  for(const x of spec.vectors) {
    const observed=admit(x);
    for(const [key,value] of Object.entries(observed)) {
      assert.equal(x[key],value,JSON.stringify({readers:x.readers,writer:x.writer,
        live:x.owner_live,key}));
    }
  }
});
test('positive and compiler-negative ownership cases pin immutable .atto blobs',()=>{
  assert.equal(spec.compiler_fixtures.length,12);
  let positives=0,negatives=0;
  for(const f of spec.compiler_fixtures) {
    assert.match(f.blob_sha,/^[0-9a-f]{40}$/);
    assert.match(f.source,/^fixtures\/borrow-checker-v1\/(pass|fail)\/[a-z-]+\.atto$/);
    const actual=sha(readFileSync(new URL(f.source,root),'utf8'));
    assert.equal(actual,f.blob_sha,'fixture drift '+f.source);
    assert.equal(f.status,'NOT_EXECUTED');
    if(f.expected==='COMPILE_AND_EXECUTE') {
      assert.equal(f.expected_exit,42);
      assert.equal(f.expected_error,null);
      positives++;
    } else {
      assert.equal(f.expected,'COMPILER_REJECTION_NO_GUEST_BYTES');
      assert.match(f.expected_error,/^E_[A-Z_]+$/);
      assert.equal(f.expected_exit,null);
      negatives++;
    }
  }
  assert.equal(positives,4);
  assert.equal(negatives,8);
});
test('every backend remains unproven until real source and negative compiler receipts',()=>{
  const expected=['java','llvm','net','wasm','forge','rs','cranelift','js','hdl'];
  assert.deepEqual(spec.backend_target_states.map(x=>x.backend),expected);
  for(const s of spec.backend_target_states) {
    assert.equal(s.repo,'atto-lang/atto-source.'+s.backend);
    assert.equal(s.core_source,'STAGED_NOT_EXECUTED');
    assert.equal(s.compiler_borrow_admission,'NOT_EXECUTED');
    assert.equal(s.compiled_positive,'NOT_EXECUTED');
    assert.equal(s.compiled_negative,'NOT_EXECUTED');
    assert.equal(s.guest_execution,'NOT_EXECUTED');
    assert.equal(s.evidence,null);
    assert.equal(s.errors_unverified,true);
  }
  assert.ok(spec.proof_gate.deny.includes('parser_unknown_keyword_as_borrow_failure'));
  assert.ok(spec.proof_gate.requires.includes('negative_emitted_guest_artifact_bytes=0'));
});
