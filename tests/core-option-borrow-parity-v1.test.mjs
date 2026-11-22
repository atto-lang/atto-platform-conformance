import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadCoreOptionBorrowParity,validateCoreOptionBorrowParity,
  REQUIRED_BORROW_CASE_IDS} from '../lib/core-option-borrow-parity-v1.mjs';
import {loadCoreOptionDashboard} from '../lib/core-option-parity-dashboard-v1.mjs';
const base=loadCoreOptionBorrowParity(), dashboard=loadCoreOptionDashboard();
const clone=()=>structuredClone(base);
const denied=(name,mutate)=>test(name,()=>{
  const x=clone();mutate(x);
  assert.throws(()=>validateCoreOptionBorrowParity(x,dashboard),
    /CORE_OPTION_BORROW_PARITY_DENIED/);
});

test('all 11 independent compiler backends retain 16 unexecuted borrow obligations',()=>{
  assert.deepEqual(validateCoreOptionBorrowParity(base,dashboard),
    {backends:11,cases:16,cells:176,guest_passes:0});
  assert.deepEqual(new Set(base.backends.map(x=>x.id)),
    new Set(['java','llvm','rs','net','wasm','forge','cranelift','js','hdl','atto','realtime']));
  assert.deepEqual(new Set(base.cases.map(x=>x.id)),new Set(REQUIRED_BORROW_CASE_IDS));
});
test('Java linked borrow fixture and checker targets have exact audited Git identities',()=>{
  const j=dashboard.java_reference;
  assert.equal(j.head_sha,'919d1d1fc59712e5e2059c72fe7a55cf5720df60');
  assert.equal(j.root_tree_sha,'58d26bb865a1211fae18395ab87587f6a4433b68');
  const expected=new Map([
    ['tests/core_option_result/borrowed_queries.atto','35f77b9020812364d1d0885e35f53a071cb50134'],
    ['src/test/java/dev/oreslang/CoreOptionResultBorrowSafetyTest.java','d44dfe085ed6728e5f5b50be889a1c56bf78bc39'],
    ['core/option.atto','4400fae94588587fbb85474256e82cac6c26256c'],
    ['core/result.atto','6bae249740af1088e069c3592ff8fb2bc72f1216']
  ]);
  const actual=new Map([...j.module_blobs,...j.test_blobs].map(x=>[x.path,x.sha]));
  for(const [path,sha] of expected)assert.equal(actual.get(path),sha);
  assert.ok(j.authored_junit_tests.some(x=>x.id==='linked_borrowed_core_queries' &&
    x.expected_stdout==='42' && x.state==='not_executed'));
  assert.ok(j.authored_junit_tests.some(x=>x.id==='borrowed_flatten_denied' &&
    x.kind==='borrow_negative' && x.state==='not_executed'));
});
denied('missing compiler cannot vanish',x=>x.backends.pop());
denied('duplicate compiler entry cannot inflate coverage',x=>x.backends[1].id='java');
denied('unknown backend identity cannot enter parity',x=>x.backends[0].id='ghost');
denied('observed main SHA is immutable against a well-formed substitution',
  x=>x.backends[0].observed_main_sha='a'.repeat(40));
denied('compiler candidate SHA is immutable against a well-formed substitution',
  x=>x.backends[0].candidate_head_sha='a'.repeat(40));
denied('cross-repository candidate cannot claim equivalence',x=>x.backends[0].repository='atto-lang/atto-source.rs');
denied('HDL cannot self-declare unsupported',x=>x.backends.find(b=>b.id==='hdl').capability_state='unsupported');
denied('self-hosted Atto cannot claim a candidate without independent registration',
  x=>x.backends.find(b=>b.id==='atto').candidate_head_sha='a'.repeat(40));
denied('missing borrow case rejects',x=>delete x.backends[0].cases.owner_survives_loan);
denied('PASS status on an Option guest is rejected',x=>x.backends[0].cases.borrowed_option_some_query.state='passed');
denied('HOST_ONLY cannot count as a guest',x=>x.backends[0].cases.borrowed_option_some_query.state='host_only');
denied('UNSUPPORTED case cannot be self-reported',x=>x.backends.find(b=>b.id==='hdl').cases.borrowed_affine_flatten.state='unsupported');
denied('fabricated job/guest receipt is rejected',x=>x.backends[0].cases.borrowed_affine_flatten.receipt={run_id:123});
denied('drop-once evidence cannot be forged',x=>x.backends[0].cases.inactive_variant_drop_once.state='passed');
denied('borrow-case expected rejection cannot flip to acceptance',x=>x.cases[5].expected='accept');
denied('borrow-case diagnostic class cannot be erased',x=>x.cases[5].diagnostic_class=null);
denied('new unchecked borrow-case name cannot replace reviewed one',x=>x.cases[2].id='new-case');
denied('unreviewed additional borrow-case cannot be appended',x=>x.cases.push(structuredClone(x.cases[0])));
denied('release qualification cannot be asserted without guest evidence',x=>x.release_qualified=true);
test('noncanonical duplicate-key source document is rejected',t=>{
  const dir=mkdtempSync(join(tmpdir(),'borrow-parity-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'registry.json');
  writeFileSync(path,JSON.stringify(base,null,2).replace(
    '  "schema": "atto.core-option-borrow-parity.v1",',
    '  "schema": "malicious",\n  "schema": "atto.core-option-borrow-parity.v1",')+'\n');
  assert.throws(()=>loadCoreOptionBorrowParity(path),/CORE_OPTION_BORROW_PARITY_DENIED/);
});
