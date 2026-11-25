#!/usr/bin/env node
// Read-only source-free release candidate report; no network, credentials or merges.
import {openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {evaluateCandidate,toMarkdown,validateCandidate} from '../tools/atto-five-backend-certification-v1.mjs';

const LIMIT=262144;
function readCanonical(path) {
  if(!Number.isInteger(constants.O_NOFOLLOW))throw Error('unsafe symlink-capable host');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||!Number.isSafeInteger(st.size)||st.size>LIMIT)
      throw Error('nonregular, linked or oversized snapshot');
    const buf=Buffer.alloc(st.size+1);
    const n=readSync(fd,buf,0,buf.length,0);
    const after=fstatSync(fd);
    if(n!==st.size||after.size!==st.size||after.ino!==st.ino||
       after.dev!==st.dev||after.nlink!==1)throw Error('snapshot changed during read');
    const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buf.subarray(0,n));
    const parsed=JSON.parse(raw);
    // Canonical serialization also rejects duplicate decoded JSON keys and aliases.
    if(JSON.stringify(parsed,null,2)+'\n'!==raw)
      throw Error('noncanonical JSON authority or whitespace');
    return{parsed,bytes:buf.subarray(0,n)};
  }finally{closeSync(fd)}
}
function gitBlob(bytes){
  const h=createHash('sha1');
  h.update('blob '+bytes.length+'\0');
  h.update(bytes);
  return h.digest('hex');
}
const args=process.argv.slice(2);
if(args.length<1||args.length>2||(args.length===2&&args[1]!=='--markdown')){
  console.error('Usage: node bin/atto-five-backend-certification-v1.mjs candidate.json [--markdown]');
  process.exitCode=2;
}else{
  try {
    const manifest=readCanonical(args[0]).parsed;
    validateCandidate(manifest);
    const path=fileURLToPath(new URL('../'+manifest.postmerge_ledger.path,import.meta.url));
    const ledger=readCanonical(path);
    if(gitBlob(ledger.bytes)!==manifest.postmerge_ledger.github_blob_sha)
      throw Error('landed evidence Git blob SHA mismatch');
    // Pin the exact source-owned case manifest in this draft branch.
    // Offline bytes still cannot authenticate a compiler guest execution.
    const casePath=fileURLToPath(new URL('../contracts/atto-guest-case-oracle-v1.json',import.meta.url));
    const caseInventory=readCanonical(casePath);
    if(gitBlob(caseInventory.bytes)!=='94b6e74a0100b8210401a5dbc3aebe4ce142eb71')
      throw Error('case-level draft manifest Git blob SHA mismatch');
    const report=evaluateCandidate(manifest,ledger.parsed,caseInventory.parsed);
    console.log(args[1]==='--markdown'?toMarkdown(report):JSON.stringify(report,null,2));
    process.exitCode=report.status==='BLOCKED'?1:3;
  }catch(e){
    console.error('FAIL_CLOSED: '+e.message);
    process.exitCode=2;
  }
}
