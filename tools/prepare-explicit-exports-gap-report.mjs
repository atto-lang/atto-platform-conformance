#!/usr/bin/env node
// Draft-only per-backend coverage inventory. This intentionally cannot produce
// an EXECUTED/PASS/certified backend report. The separate strict protocol #166
// is the only path for executed exact-head conformance evidence.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const BACKENDS=new Set(['java','llvm','net','wasm','forge','js']);
const EXPECTED_CASES=Object.freeze({
  modifier:5,semantic:46,syntax:32,abi:7,access:7
});
const sha=/^[0-9a-f]{40}$/;
const gitBlobSha=bytes=>createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\0','ascii'))
  .update(bytes).digest('hex');

export function prepareGapReport(contract,ledger,backend,contractBytes) {
  if(!BACKENDS.has(backend))throw Error('unsupported backend name');
  if(ledger?.schema!=='oreslang.explicit-exports.backend-status.v1' ||
     ledger.policy?.current_contract_execution!=='NOT_EXECUTED' ||
     ledger.policy?.confirmed_requires_real_exact_head_execution!==true ||
     ledger.policy?.zero_step_is_not_execution!==true)
    throw Error('source-free draft report requires unexecuted fail-closed ledger');
  const status=ledger.backends?.[backend];
  if(!status || !sha.test(status.implementation_head) ||
     status.runtime_evidence!=='NOT_EXECUTED')
    throw Error('backend evidence is missing, unpinned or no longer unexecuted');
  if(contract?.schema!=='oreslang.explicit-exports.v1' ||
     contract.native_exposure!=='separate' ||
     ledger.contract?.git_blob_sha1!==gitBlobSha(contractBytes) ||
     ledger.contract?.revision!=='explicit-exports-v1.2026-10-26.5')
    throw Error('canonical source-free contract identity mismatch');

  const sources=[
    ['modifier',contract.modifier_cases],
    ['semantic',contract.cases],
    ['syntax',contract.syntax_cases],
    ['abi',contract.abi_cases],
    ['access',contract.access_cases]
  ];
  const cases=[];
  for(const [section,entries] of sources){
    if(!Array.isArray(entries)||entries.length!==EXPECTED_CASES[section])
      throw Error('canonical case inventory changed for '+section);
    entries.forEach((entry,index)=>{
      const reference=section==='abi'
        ? (entry.equal ? 'ABI_EQUAL' : 'ABI_DIFFERENT')
        : section==='access'
          ? (entry.expect ? 'ACCESS_ALLOW' : 'ACCESS_DENY')
          : (entry.error ? 'REJECT' : 'ACCEPT');
      cases.push(Object.freeze({
        id:section+':'+index,
        section,
        reference_expectation:reference,
        reference_diagnostic:entry.error??null,
        observed:'NOT_EXECUTED'
      }));
    });
  }
  if(cases.length!==97 || ledger.contract.required_backend_report_rows!==97)
    throw Error('backend report coverage must contain exactly 97 cases');

  return {
    schema:'oreslang.explicit-exports.gap-report.v1',
    backend,
    exact_head:status.implementation_head,
    contract_blob:ledger.contract.git_blob_sha1,
    execution:{status:'NOT_EXECUTED',run_url:null},
    native_exposure:'UNVERIFIED',
    certified:false,
    evidence_note:status.evidence_note??'Exact-head compiler evidence unavailable',
    cases
  };
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  const backend=process.argv[2];
  if(!BACKENDS.has(backend)){
    console.error('usage: node tools/prepare-explicit-exports-gap-report.mjs <java|llvm|net|wasm|forge|js>');
    process.exit(2);
  }
  const contractBytes=fs.readFileSync(
    new URL('../fixtures/explicit-exports-v1/contract.json',import.meta.url));
  const ledger=JSON.parse(fs.readFileSync(
    new URL('../fixtures/explicit-exports-v1/backend-status.json',import.meta.url),'utf8'));
  const report=prepareGapReport(JSON.parse(contractBytes.toString('utf8')),
    ledger,backend,contractBytes);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
