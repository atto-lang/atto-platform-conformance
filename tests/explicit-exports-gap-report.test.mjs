import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareGapReport} from '../tools/prepare-explicit-exports-gap-report.mjs';

const contractBytes=fs.readFileSync(
  new URL('../fixtures/explicit-exports-v1/contract.json',import.meta.url));
const contract=JSON.parse(contractBytes.toString('utf8'));
const ledger=JSON.parse(fs.readFileSync(
  new URL('../fixtures/explicit-exports-v1/backend-status.json',import.meta.url),'utf8'));
const backends=['java','llvm','net','wasm','forge','js'];

test('each source-free backend gap report enumerates 97 reference cases without claiming execution',()=>{
  for(const backend of backends){
    const report=prepareGapReport(contract,ledger,backend,contractBytes);
    assert.equal(report.schema,'oreslang.explicit-exports.gap-report.v1');
    assert.notEqual(report.schema,'oreslang.explicit-exports.backend-report.v1');
    assert.equal(report.backend,backend);
    assert.equal(report.exact_head,ledger.backends[backend].implementation_head);
    assert.equal(report.execution.status,'NOT_EXECUTED');
    assert.equal(report.execution.run_url,null);
    assert.equal(report.native_exposure,'UNVERIFIED');
    assert.equal(report.certified,false);
    assert.equal(report.cases.length,97);
    assert.equal(new Set(report.cases.map(x=>x.id)).size,97);
    assert.deepEqual(Object.fromEntries(['modifier','semantic','syntax','abi','access']
      .map(section=>[section,report.cases.filter(c=>c.section===section).length])),
      {modifier:5,semantic:46,syntax:32,abi:7,access:7});
    assert.ok(report.cases.every(c=>c.observed==='NOT_EXECUTED'));
    assert.ok(report.cases.some(c=>c.reference_expectation==='REJECT' &&
      typeof c.reference_diagnostic==='string'));
  }
});

test('a gap report fails closed on forged heads, status promotion and contract drift',()=>{
  assert.throws(()=>prepareGapReport(contract,ledger,'unauthorized',contractBytes),
    /unsupported backend/);
  for(const mutate of [
    copy=>{copy.backends.js.runtime_evidence='EXECUTED';},
    copy=>{copy.backends.js.implementation_head='pending';},
    copy=>{copy.policy.current_contract_execution='EXECUTED';},
    copy=>{copy.contract.git_blob_sha1='0'.repeat(40);}
  ]){
    const copy=structuredClone(ledger);
    mutate(copy);
    assert.throws(()=>prepareGapReport(contract,copy,'js',contractBytes));
  }
  const changed=structuredClone(contract);
  changed.syntax_cases.pop();
  assert.throws(()=>prepareGapReport(changed,ledger,'js',contractBytes),/syntax/);
});

test('reference expectations cannot be confused with an observed backend result',()=>{
  const report=prepareGapReport(contract,ledger,'net',contractBytes);
  assert.ok(report.cases.every(x=>!Object.hasOwn(x,'status')));
  assert.ok(report.cases.every(x=>!Object.hasOwn(x,'diagnostic')));
  assert.ok(report.cases.every(x=>x.observed==='NOT_EXECUTED'));
});
