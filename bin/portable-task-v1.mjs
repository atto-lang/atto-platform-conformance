#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {loadSuite,summarize} from '../lib/portable-task-v1.mjs';
const argv=process.argv.slice(2);
if(argv.length>1||argv.some(x=>!x.startsWith('--receipts='))){console.error('usage: node bin/portable-task-v1.mjs [--receipts=/absolute/path.json]');process.exitCode=2;}
else{
 try{
  const suite=await loadSuite();
  const receipts=argv.length?JSON.parse(await readFile(argv[0].slice('--receipts='.length),'utf8')):{};
  console.log(JSON.stringify({schema:'atto.portable-task-v1-summary',scope:'structural-candidate-only',cases:suite.cases.length,backends:summarize(suite.cases,receipts)},null,2));
  // A structurally plausible receipt is not independently verified.
  // Deliberately fail this release-gate command until an external reviewer/promoter exists.
  process.exitCode=Object.values(summarize(suite.cases,receipts)).every(v=>v.releaseQualified===true)?0:1;
 }catch(e){console.error(e.message);process.exitCode=2;}
}
