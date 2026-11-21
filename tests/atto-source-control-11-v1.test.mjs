import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/atto-source-control-11-v1.json',import.meta.url),'utf8'));
const canonical = ['atto','net','hdl','java','realtime','rs','llvm','js',
  'forge','wasm','cranelift'].map(s=>'atto-lang/atto-source.'+s);
const controls = ['001B','007F','0085','061C','200E','200F','2028','2029',
  '202A','202B','202C','202D','202E','2066','2067','2068','2069'];
const sha40 = /^[a-f0-9]{40}$/;

function verify(c) {
  assert.equal(c.schema,'atto.source-control-11-backend.v1');
  assert.equal(c.status,'PARTIAL_SOURCE_ADMISSION_NOT_GUEST_PARITY');
  assert.equal(c.backend_count,11);
  assert.deepEqual(c.backends.map(b=>b.repo),canonical);
  assert.deepEqual(c.control_codepoints_hex,controls);
  assert.equal(new Set(c.control_codepoints_hex).size,controls.length);
  assert.deepEqual(c.injections,[
    'block-comment-after-valid-program','line-comment-after-valid-program',
    'raw-source-tail-after-valid-program'
  ]);
  assert.equal(c.in_memory_checks_exercised,17*3*3+3);
  assert.equal(c.in_memory_checks_failed,0);
  assert.equal(c.full_compiler_parity_certified,false);
  assert.deepEqual(c.certified_backends,[]);
  assert.equal(c.carrier_admission,'NO_APPROVED_PRIVATE_SOURCE_DESTINATION');
  for(const b of c.backends) {
    assert.equal(b.guest_certified,false,b.repo);
    assert.equal(b.source_ci_certified,false,b.repo);
    const suffix=b.repo.slice('atto-lang/atto-source.'.length);
    const status = ['atto','realtime'].includes(suffix)?'BOOTSTRAP_NOT_COMPILER':
      ['hdl','js'].includes(suffix)?'IN_MEMORY_SOURCE_ADMISSION_ONLY':
      suffix==='cranelift'?'SOURCE_INSPECTED_ONLY':'NOT_EXECUTED';
    assert.equal(b.status,status,b.repo);
  }
  assert.deepEqual(c.observations.map(o=>o.repo),
    ['atto-lang/atto-source.hdl','atto-lang/atto-source.js',
      'atto-lang/atto-source.cranelift']);
  for(const o of c.observations) {
    assert.match(o.candidate_head,sha40);
    assert.match(o.source_blob,sha40);
    assert.equal(o.execution_scope.includes('GUEST'),false);
  }
  const [hdl,js,cr]=c.observations;
  assert.equal(hdl.negative_cases,17*3);
  assert.equal(hdl.positive_cases,1);
  assert.equal(js.negative_cases,17*3*2);
  assert.equal(js.positive_cases,2);
  assert.equal(cr.negative_cases,0);
  assert.equal(cr.positive_cases,0);
  assert.deepEqual(js.source_blobs.length,2);
  js.source_blobs.forEach(blob=>assert.match(blob,sha40));
  assert.equal(hdl.pr,39);
  assert.equal(js.pr,107);
  for(const item of ['real_compiler_or_interpreter_entrypoint_negative_tests',
    'material_steps_run_under_authorized_CI_or_local_compiler',
    'independent_review_and_required_checks']) {
    assert.ok(c.required_evidence_for_backend_parity.includes(item));
  }
}

test('all 11 source backends accounted for without false guest qualification',()=>verify(contract));
test('all 17 forbidden source controls have three actual-character negative contexts',()=>{
  for(const x of controls) {
    const ch=String.fromCodePoint(parseInt(x,16));
    for(const source of [
      contract.benign_source_example+' /*'+ch+'*/',
      contract.benign_source_example+' //'+ch,
      contract.benign_source_example+' '+ch
    ]) {
      assert.equal(source.indexOf(ch)>=0,true,'missing raw control U+'+x);
      assert.equal(source.includes('\\u'+x),false,'escaped instead of real control U+'+x);
    }
  }
});
test('forged certification, removed backends or missing controls fail closed',()=>{
  const m=structuredClone(contract);
  m.backends[0].guest_certified=true;
  assert.throws(()=>verify(m));
  const b=structuredClone(contract);
  b.backends.pop();
  assert.throws(()=>verify(b));
  const c=structuredClone(contract);
  c.control_codepoints_hex.pop();
  assert.throws(()=>verify(c));
  const d=structuredClone(contract);
  d.observations[0].negative_cases=0;
  assert.throws(()=>verify(d));
  const e=structuredClone(contract);
  e.carrier_admission='APPROVED';
  assert.throws(()=>verify(e));
  const f=structuredClone(contract);
  f.full_compiler_parity_certified=true;
  assert.throws(()=>verify(f));
});
