import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateContract, validateReceiptShape, gitBlobSha} from '../lib/value-block-range-v0-evidence.mjs';

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
  assert.throws(()=>validateReceiptShape(receipt,contract,matrix),/audited SHA/);
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
  assert.throws(()=>validateReceiptShape(baseline,contract,matrix),/audited SHA/);
});
