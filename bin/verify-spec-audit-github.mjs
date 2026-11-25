#!/usr/bin/env node
// Read-only GitHub API metadata cross-check, not guest parity certification.
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {checkSpecAuditGithubApi} from '../lib/spec-audit-github-evidence.mjs';
const root=resolve(import.meta.dirname,'..');
function readJson(file){
 if(!isAbsolute(file))throw Error('only absolute reviewed paths are supported');
 const st=lstatSync(file);
 if(!st.isFile()||st.nlink!==1||st.size<1||st.size>256*1024)throw Error('invalid or oversized evidence file');
 return JSON.parse(readFileSync(file,'utf8'));
}
function git(...args){return execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:root,encoding:'utf8',timeout:10000}).trim();}
try{
 if(process.argv.length!==4||!process.argv[2].startsWith('--receipt=')||!process.argv[3].startsWith('--expect='))
  throw Error('usage: node bin/verify-spec-audit-github.mjs --receipt=/abs/receipt.json --expect=/abs/independent-pins.json');
 const receipt=readJson(process.argv[2].slice('--receipt='.length));
 const reviewed=readJson(process.argv[3].slice('--expect='.length));
 if(!reviewed||typeof reviewed!=='object'||!reviewed.expected||!reviewed.ciPins)
  throw Error('independent reviewed expectation and CI pins required');
 const expected=reviewed.expected;
 if(git('rev-parse','HEAD')!==expected.conformanceHead||git('rev-parse','HEAD^{tree}')!==expected.conformanceTree)
  throw Error('local conformance checkout does not match independently pinned head/tree');
 execFileSync('python3',['scripts/verify-raw-worktree.py','.'],{cwd:root,encoding:'utf8',timeout:30000});
 const manifest=JSON.parse(readFileSync(resolve(root,'fixtures/spec-audit-v1/manifest.json'),'utf8'));
 const result=await checkSpecAuditGithubApi(manifest,receipt,expected,reviewed.ciPins,{token:process.env.GITHUB_TOKEN});
 console.log(JSON.stringify(result,null,2));
 // Even matched authenticated API job metadata cannot authenticate guest
 // artifact bytes. Deliberate nonzero prevents accidental use as a release gate.
 process.exitCode=3;
}catch(e){console.error('SPEC_AUDIT_GITHUB_NOT_VERIFIED: '+(e?.message??String(e)));process.exitCode=2;}
