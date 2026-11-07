#!/usr/bin/env node
// Source-local Java/LLVM probe. Its output is never an authenticated CI receipt.
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {runSpecAuditCompilerProbe} from '../lib/spec-audit-compiler-adapter.mjs';
const root=resolve(import.meta.dirname,'..');
function readJson(file){
 if(!isAbsolute(file))throw Error('config path must be absolute and independently reviewed');
 const st=lstatSync(file);
 if(!st.isFile()||st.nlink!==1||st.size<1||st.size>16384)throw Error('invalid or oversized config file');
 return JSON.parse(readFileSync(file,'utf8'));
}
function git(...args){return execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:root,encoding:'utf8',timeout:10000}).trim();}
try{
 if(process.argv.length!==3||!process.argv[2].startsWith('--config='))
  throw Error('usage: node bin/run-spec-audit-compiler.mjs --config=/absolute/reviewed.json');
 const config=readJson(process.argv[2].slice('--config='.length));
 // Raw source-only checkout integrity precondition, before any compiler is run.
 execFileSync('python3',['scripts/verify-raw-worktree.py','.'],{cwd:root,encoding:'utf8',timeout:30000});
 if(git('rev-parse','HEAD')!==config.conformanceHead||
    git('rev-parse','HEAD^{tree}')!==config.conformanceTree)
  throw Error('checked-out source head/tree differs from independent config pins');
 const manifest=JSON.parse(readFileSync(resolve(root,'fixtures/spec-audit-v1/manifest.json'),'utf8'));
 const result=runSpecAuditCompilerProbe(manifest,config,{root});
 console.log(JSON.stringify(result,null,2));
 // A zero exit code means only that a local probe completed; no GitHub or
 // release gate may interpret it as authenticated compiler-backed parity.
}catch(e){console.error('SPEC_AUDIT_LOCAL_PROBE_NOT_VERIFIED: '+(e?.message??String(e)));process.exitCode=2;}
