#!/usr/bin/env node
// A source-free integrity check. Does not run the AttoLang compiler.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {validateContract, validateReceiptShape} from '../lib/value-block-range-v0-evidence.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path=(name)=>resolve(root,'contracts/value-block-range-v0',name);
const raw=readFileSync(path('cases.json'),'utf8');
const contract=JSON.parse(raw);
const matrix=JSON.parse(readFileSync(path('matrix.json'),'utf8'));

try {
  const result=validateContract(contract,matrix,raw);
  if(process.argv.length===2) {
    console.log(JSON.stringify(result,null,2));
    console.log('SOURCE_FREE_CONTRACT_ONLY — no compiler or guest execution verified');
  } else if(process.argv.length===4 && process.argv[2]==='--receipt') {
    const receipt=JSON.parse(readFileSync(process.argv[3],'utf8'));
    console.log(JSON.stringify(validateReceiptShape(receipt,contract,matrix),null,2));
    console.log('EXTERNAL_GITHUB_RUN_AND_BLOB_VERIFICATION_STILL_REQUIRED');
  } else {
    throw Error('Usage: node bin/verify-value-block-range-v0.mjs [--receipt /path/to/receipt.json]');
  }
} catch (e) {
  console.error('VALUE_BLOCK_RANGE_V0_REJECTED:',e.message);
  process.exitCode=1;
}
