import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadBorrowSourceLedger,validateBorrowSourceLedger} from '../lib/core-option-borrow-source-ledger-v1.mjs';
import {loadCoreOptionDashboard} from '../lib/core-option-parity-dashboard-v1.mjs';

const ledger=loadBorrowSourceLedger();
const dash=loadCoreOptionDashboard();
const clone=()=>structuredClone(ledger);
const reject=(name,mutate)=>test(name,()=>{
  const data=clone();mutate(data);
  assert.throws(()=>validateBorrowSourceLedger(data,dash),/BORROW_SOURCE_LEDGER_DENIED/);
});
test('all eleven profiles, seven source-borrow candidates and 47 Git blob pins exist',()=>{
  assert.deepEqual(validateBorrowSourceLedger(ledger,dash),
    {backends:11,borrow_candidates:7,source_artifacts:47,guest_passes:0});
  assert.deepEqual(new Set(ledger.backends.map(x=>x.id)),
    new Set(['java','llvm','net','rs','wasm','forge','cranelift','js','hdl','atto','realtime']));
});
test('bounded Rust immutable ADT borrow checker code and typed negatives have independent SHA pins',()=>{
  const rs=ledger.backends.find(x=>x.id==='rs');
  const files=new Map(rs.source_artifacts.map(x=>[x.path,x.blob_sha]));
  const required=new Map([
    ['src/check.rs','0b6da174e5cde0d277db1846ac5106f79370d852'],
    ['.github/workflows/core-option-result-borrow-exact-head.yml','05c8853c15986b35fd5d376b417b34b9f1968eb4'],
    ['tests/core_option_result_scalar.rs','bbeb6f381193fcd8897534eaf34e6b60c7c3a106'],
    ['tests/core_option_result/borrowed_read_42.atto','b18d140202a29425911f4fba7417696ed7f6cf0d'],
    ['tests/core_option_result/negative_affine_borrow_escape.atto','3815a07ee254c30541bf8069f3a17cfd7be01138'],
    ['tests/core_option_result/negative_unproved_affine_option.atto','6f4cde94cf54a65b0271bb8fbbc79dd32b7f014a'],
    ['tests/core_option_result/negative_borrow_option_temporary.atto','c40331a00c8ad8b912f02c2c2bfac04ece716508'],
    ['tests/core_option_result/negative_borrow_mut_option.atto','fbca2779ca3268afedabd146c6c09b771a8f2a3f'],
    ['tests/core_option_result/negative_borrow_option_return.atto','77a2d72c3682822993d4f5f01f779601b7c228fc']
  ]);
  for(const [path,sha] of required)assert.equal(files.get(path),sha,path);
  assert.equal(rs.source_head_sha,'9f881e82675df9bc08621b4056f1206583e9054d');
  assert.equal(rs.root_tree_sha,'88d3dda23a74456172e39c0f157db9b7c4db88cf');
  assert.ok(Object.values(rs.checks).every(x=>x==='not_executed'));
});
test('Java JUnit linked guest, OwnershipChecker, TypeChecker and exact-head workflow are pinned',()=>{
  const java=ledger.backends.find(x=>x.id==='java');
  const files=new Map(java.source_artifacts.map(x=>[x.path,x.blob_sha]));
  const expected=new Map([
    ['core/option.atto','4400fae94588587fbb85474256e82cac6c26256c'],
    ['core/result.atto','6bae249740af1088e069c3592ff8fb2bc72f1216'],
    ['tests/core_option_result/borrowed_queries.atto','35f77b9020812364d1d0885e35f53a071cb50134'],
    ['src/test/java/dev/oreslang/CoreOptionResultSourceTest.java','ef08bcc9f3165a04a8e57a59525769ad66e7116f'],
    ['src/test/java/dev/oreslang/CoreOptionResultBorrowSafetyTest.java','d44dfe085ed6728e5f5b50be889a1c56bf78bc39'],
    ['src/main/java/dev/oreslang/types/OwnershipChecker.java','6be88b5f3717f70759440be6a3012a0411f2315b'],
    ['src/main/java/dev/oreslang/types/TypeChecker.java','95a344571ba41d78303f3d1979918927b11619af'],
    ['.github/workflows/core-option-result-jvm-borrow-exact-head.yml','9d74a1ea63898534fb3c991dfd805b031b74a860']
  ]);
  for(const [path,sha] of expected)assert.equal(files.get(path),sha,path);
  assert.equal(java.source_head_sha,'fd5055c3544ee7cf7e50dd5ac1b89469ada114a3');
  assert.equal(java.root_tree_sha,'af9c40f78d8f4b15e2cb8903f658f7df5be48aa2');
  assert.ok(Object.values(java.checks).every(x=>x==='not_executed'));
});
test('noncompiler profiles never masquerade as generic ownership passes',()=>{
  for(const id of ['js','hdl','atto','realtime']){
    const b=ledger.backends.find(x=>x.id===id);
    assert.notEqual(b.stage,'borrow_source_candidate');
    assert.ok(Object.values(b.checks).every(x=>x==='not_executed'));
  }
});
test('every source-owned implementation fixture is individually pinned and backend-scoped',()=>{
  for(const id of ['java','rs','llvm','net','wasm','forge','cranelift']){
    const b=ledger.backends.find(x=>x.id===id);
    assert.equal(b.source_artifacts.length,id==='java'?8:id==='rs'?12:4,id);
    assert.ok(b.source_artifacts.filter(x=>x.path.endsWith('.atto')).length>=3);
    assert.match(b.root_tree_sha,/^[0-9a-f]{40}$/);
    assert.equal(b.source_head_sha,dash.backends.find(x=>x.id===id).candidate.head_sha);
  }
});
reject('omit backend',x=>x.backends.pop());
reject('duplicate backend',x=>x.backends[1].id='java');
reject('rename repository',x=>x.backends[0].repository='atto-lang/atto-source.llvm');
reject('swap exact candidate commit with another valid SHA',x=>x.backends[0].source_head_sha='a'.repeat(40));
reject('swap exact full root Git tree',x=>x.backends[0].root_tree_sha='b'.repeat(40));
reject('omit a source fixture',x=>x.backends[0].source_artifacts.pop());
reject('duplicate source fixture',x=>x.backends[0].source_artifacts[1]=structuredClone(x.backends[0].source_artifacts[0]));
reject('swap a valid-looking source Git blob',x=>x.backends[0].source_artifacts[0].blob_sha='a'.repeat(40));
reject('inject path traversal',x=>x.backends[0].source_artifacts[0].path='../compiler-secret.txt');
reject('forge source file as AOT receipt',x=>x.backends[0].checks.native_aot='passed');
reject('forge compiled guest status',x=>x.backends[0].checks.compiled_guest='passed');
reject('host-only result cannot count as compiled guest',x=>x.backends[0].checks.compiled_guest='host_only');
reject('cannot self-declare unsupported semantic borrow',x=>x.backends.find(b=>b.id==='hdl').checks.semantic_borrow_negative='unsupported');
reject('cannot self-declare sanitized memory',x=>x.backends[0].checks.memory_safety='passed');
reject('scalar JS cannot become generic borrower by metadata edit',x=>x.backends.find(b=>b.id==='js').stage='borrow_source_candidate');
reject('self-hosted Atto cannot acquire fictitious root tree',x=>x.backends.find(b=>b.id==='atto').root_tree_sha='a'.repeat(40));
reject('release flag is not compiler evidence',x=>x.release_qualified=true);
test('duplicate-key/noncanonical and symlinked ledger files are refused',t=>{
 const dir=mkdtempSync(join(tmpdir(),'atto-option-borrow-ledger-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const path=join(dir,'index.json'),link=join(dir,'link.json');
 writeFileSync(path,JSON.stringify(ledger,null,2).replace(
   '  "schema": "atto.core-option-borrow-source-ledger.v1",',
   '  "schema": "forged",\n  "schema": "atto.core-option-borrow-source-ledger.v1",')+'\n');
 assert.throws(()=>loadBorrowSourceLedger(path),/BORROW_SOURCE_LEDGER_DENIED/);
 symlinkSync(path,link);
 assert.throws(()=>loadBorrowSourceLedger(link),/BORROW_SOURCE_LEDGER_DENIED/);
});
