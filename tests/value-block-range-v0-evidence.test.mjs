import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateContract, validateReceiptShape, gitBlobSha, sourceSha256} from '../lib/value-block-range-v0-evidence.mjs';

const raw=readFileSync(new URL('../contracts/value-block-range-v0/cases.json',import.meta.url),'utf8');
const contract=JSON.parse(raw);
const matrix=JSON.parse(readFileSync(new URL('../contracts/value-block-range-v0/matrix.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x);

test('canonical nine-backend 17-case contract has immutable Git blob identity, not guest pass',()=>{
  const result=validateContract(contract,matrix,raw);
  assert.equal(result.cases,17);
  assert.equal(result.backends,9);
  assert.equal(result.lanes,10);
  assert.equal(result.evidence_class,'SOURCE_FREE_CONTRACT_ONLY');
  assert.equal(result.contractBlob,gitBlobSha(raw));
});
test('tampering with canonical fixtures without repinning blob fails closed',()=>{
  const changed=raw.replace('block_tail_returns_value','block_tail_mutated');
  assert.notEqual(changed,raw);
  assert.throws(()=>validateContract(JSON.parse(changed),matrix,changed),/blob SHA/);
});
test('unknown backend or invented verified guest receipts never pass the inventory',()=>{
  const wrong=clone(matrix);
  wrong.backend_audit[1].backend='fake-backend';
  assert.throws(()=>validateContract(contract,wrong,raw));
  const unsupported=clone(matrix);
  unsupported.verified_guest_receipts=['made-up-run'];
  assert.throws(()=>validateContract(contract,unsupported,raw));
});
test('duplicate test IDs, missing expected diagnostics and invalid exit statuses fail closed',()=>{
  const duplicate=clone(contract);
  duplicate.cases[1].id=duplicate.cases[0].id;
  assert.throws(()=>validateContract(duplicate,matrix,raw),/duplicate/);
  const missingDiagnostic=clone(contract);
  missingDiagnostic.cases.find(x=>x.kind.startsWith('reject_')).expect={};
  assert.throws(()=>validateContract(missingDiagnostic,matrix,raw),/diagnostic/);
  const invalidGuest=clone(contract);
  invalidGuest.cases.find(x=>x.kind==='accept_execute').expect.exit_code=999;
  assert.throws(()=>validateContract(invalidGuest,matrix,raw),/exit status/);
});
test('source-free and stale or incomplete guest receipts are rejected',()=>{
  const receipt={
    schema:'attolang.value-block-range.guest-receipt.v0',
    evidence_class:'SOURCE_FREE_MODEL',
    contract_blob_sha:matrix.source_contract.git_blob_sha,
    lane:'java-interpreter',backend:'java',
  };
  assert.throws(()=>validateReceiptShape(receipt,contract,matrix),/COMPILED_ATTO_GUEST/);
  receipt.evidence_class='COMPILED_ATTO_GUEST';
  receipt.compiler_head_sha='0'.repeat(40);
  receipt.compiler_tree_sha='0'.repeat(40);
  assert.throws(()=>validateReceiptShape(receipt,contract,matrix),/pinned candidate SHA/);
});

test('all nine compiler repositories and ten execution lanes are present without synthetic successes',()=>{
  const backends=matrix.backend_audit.map(x=>x.backend);
  assert.deepEqual(backends,['java','llvm','wasm','forge','net','rs','cranelift','js','hdl']);
  assert.deepEqual(matrix.required_guest_lanes,[
    'java-interpreter','java-native-image','llvm-native','wasm32',
    'forge-native','net-native-aot','rs-native','cranelift-native',
    'js-worker','hdl-rtl-simulation'
  ]);
  assert.match(matrix.semantic_alignment_blocker?.scope,/Java implementation draft/);
  assert.match(matrix.hardware_profile_note,/restricted hardware/);
});
test('receipt lane cannot impersonate another backend or use skipped guest execution',()=>{
  const baseline={
    schema:'attolang.value-block-range.guest-receipt.v0',
    evidence_class:'COMPILED_ATTO_GUEST',
    contract_blob_sha:matrix.source_contract.git_blob_sha,
    lane:'rs-native',
    backend:'hdl',
  };
  assert.throws(()=>validateReceiptShape(baseline,contract,matrix),/lane\/backend mismatch/);
  baseline.backend='rs';
  baseline.compiler_head_sha='0'.repeat(40);
  baseline.compiler_tree_sha='0'.repeat(40);
  assert.throws(()=>validateReceiptShape(baseline,contract,matrix),/pinned candidate SHA/);
});


function syntheticReceiptShapeOnly(lane='java-interpreter') {
  const backend={ 'java-interpreter':'java', 'java-native-image':'java',
    'llvm-native':'llvm','wasm32':'wasm','forge-native':'forge',
    'net-native-aot':'net','rs-native':'rs','cranelift-native':'cranelift',
    'js-worker':'js','hdl-rtl-simulation':'hdl' }[lane];
  const candidate=matrix.backend_audit.find(x=>x.backend===backend).candidate;
  return {
    schema:'attolang.value-block-range.guest-receipt.v0',
    evidence_class:'COMPILED_ATTO_GUEST',
    contract_blob_sha:matrix.source_contract.git_blob_sha,
    lane,backend,compiler_head_sha:candidate.sha,compiler_tree_sha:candidate.tree,
    runner_repository:'voxletra/voxletra-e2e',run_id:1234,job_id:5678,
    run_url:'https://github.com/voxletra/voxletra-e2e/actions/runs/1234',
    completed_steps:['compiler','artifact','guest-execute'],
    compiler_binary_sha256:'a'.repeat(64),
    cases:contract.cases.map(spec=>{
      const result={id:spec.id,source_sha256:sourceSha256(spec.source),status:'pass'};
      if(spec.kind==='accept_execute') Object.assign(result,{
        phase:'guest-execute',compile_exit:0,guest_exit:spec.expect.exit_code,
        artifact_sha256:'b'.repeat(64),guest_stdout_sha256:'c'.repeat(64),
        executed_guest:true,
        ...(spec.expect.visited ? {visited:spec.expect.visited}:{}),
      });
      if(spec.kind.startsWith('reject_')) Object.assign(result,{
        phase:spec.kind==='reject_parse'?'parser-reject':'typechecker-reject',
        compile_exit:2,diagnostic_class:spec.expect.diagnostic,
        artifact_published:false,
      });
      if(spec.kind==='accept_typecheck') Object.assign(result,{
        phase:'typecheck',compile_exit:0,result_type:spec.expect.result_type,
      });
      if(spec.kind==='accept_lex') Object.assign(result,{
        phase:'lex',lex_pass:true,lex_tokens:spec.expect.token_prefix,
      });
      return result;
    }),
  };
}
test('even a complete fabricated receipt can pass shape checks but is NOT externally verified',()=>{
  const receipt=syntheticReceiptShapeOnly();
  const shape=validateReceiptShape(receipt,contract,matrix);
  assert.equal(shape.claim_status,'RECEIPT_SHAPE_VALID_EXTERNAL_VERIFICATION_REQUIRED');
  assert.ok(!('certified' in shape));
});
test('wrong compiler tree, stale main, and inconsistent run URL are rejected',()=>{
  const stale=syntheticReceiptShapeOnly();
  stale.compiler_head_sha=matrix.backend_audit[0].main_sha;
  assert.throws(()=>validateReceiptShape(stale,contract,matrix),/pinned candidate SHA/);
  const tree=syntheticReceiptShapeOnly();
  tree.compiler_tree_sha='0'.repeat(40);
  assert.throws(()=>validateReceiptShape(tree,contract,matrix),/pinned candidate tree/);
  const url=syntheticReceiptShapeOnly();
  url.run_url='https://github.com/another/repo/actions/runs/1234';
  assert.throws(()=>validateReceiptShape(url,contract,matrix),/runner repo\/url mismatch/);
});
test('wrong negative phase, missing range witness, wrong inferred type and missing lex tokens are rejected',()=>{
  const wrongPhase=syntheticReceiptShapeOnly();
  wrongPhase.cases.find(x=>x.id==='range_chaining').phase='typechecker-reject';
  assert.throws(()=>validateReceiptShape(wrongPhase,contract,matrix),/correct compiler phase/);
  const missingVisit=syntheticReceiptShapeOnly();
  delete missingVisit.cases.find(x=>x.id==='range_exclusive_count').visited;
  assert.throws(()=>validateReceiptShape(missingVisit,contract,matrix),/range iteration witness/);
  const wrongType=syntheticReceiptShapeOnly();
  wrongType.cases.find(x=>x.id==='empty_collection_context').result_type='Unknown';
  assert.throws(()=>validateReceiptShape(wrongType,contract,matrix),/actual checked type/);
  const wrongLex=syntheticReceiptShapeOnly();
  wrongLex.cases.find(x=>x.id==='double_dot_not_spread').lex_tokens=['INT'];
  assert.throws(()=>validateReceiptShape(wrongLex,contract,matrix));
  const skipped=syntheticReceiptShapeOnly();
  skipped.cases.find(x=>x.id==='inclusive_max_endpoint').status='skipped';
  assert.throws(()=>validateReceiptShape(skipped,contract,matrix),/never passes/);
});
