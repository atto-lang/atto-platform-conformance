#!/usr/bin/env node
import {readFile, lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateVectors,validateReceipt} from '../src/liveview-wire-receipts.mjs';
const args=process.argv.slice(2);
if(args.length>2 || args.some(x=>x.startsWith('--') && x!=='--structural-only')) {
  console.error('usage: node bin/check-liveview-wire-v1.mjs [RECEIPT.json] [--structural-only]');
  process.exit(2);
}
const structural=args.includes('--structural-only');
const reportPath=args.find(x=>x!=='--structural-only');
const read=async path=>{
  const file=resolve(path),info=await lstat(file);
  if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>131072)
    throw Error('not an ordinary bounded receipt/fixture');
  const data=await readFile(file);
  if(data.length>131072)throw Error('file too large');
  return data.toString('utf8');
};
try {
  const raw=await read(new URL('../contracts/v1/ores-liveview-wire-v1.json',import.meta.url).pathname);
  const fixture=JSON.parse(raw);
  const check=validateVectors(fixture,raw);
  const result=reportPath?validateReceipt(JSON.parse(await read(reportPath)),fixture):{no_native_receipt:true};
  console.log(JSON.stringify({...check,...result},null,2));
  // Even plausible receipts need independent authenticated job logs, binary provenance,
  // source/guest identity and execution observation. Never certify from JSON alone.
  if(!structural)process.exitCode=3;
} catch(e) {
  console.error('LIVEVIEW_WIRE_GATE_REJECTED: '+e.message);
  process.exitCode=1;
}
