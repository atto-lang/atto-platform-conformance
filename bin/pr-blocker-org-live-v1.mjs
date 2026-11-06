#!/usr/bin/env node
// Opt-in CLI; READ-only GitHub GETs. Does not install or change the four-hour WATCH.
import {githubReadClient, inventoryOrg, inspectPR} from '../tools/pr-blocker-org-live-v1.mjs';
import {collectExactHeadEvidence, persistSnapshot} from '../lib/pr-blocker-ledger-v1.mjs';
function parseArgs(argv){
  const opts={org:'ores-truffle-oreslang',maxPRs:5000,maxRepos:500,maxRequests:12000,
    inspectCI:false,output:null, crossCheckSearch:true};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--inspect-ci')opts.inspectCI=true;
    else if(arg==='--no-search-crosscheck')opts.crossCheckSearch=false;
    else if(arg==='--org')opts.org=argv[++i];
    else if(arg==='--output')opts.output=argv[++i];
    else if(arg==='--start')opts.start=argv[++i];
    else if(arg==='--stop')opts.stop=argv[++i];
    else if(arg==='--max-prs')opts.maxPRs=Number(argv[++i]);
    else if(arg==='--max-repos')opts.maxRepos=Number(argv[++i]);
    else if(arg==='--max-requests')opts.maxRequests=Number(argv[++i]);
    else throw Error('unknown CLI option '+arg);
  }
  if(!opts.output || !/^[\w./-]+\.json$/.test(opts.output)||opts.output.includes('..'))throw Error('--output safe local .json path required');
  if(!Number.isSafeInteger(opts.maxPRs)||opts.maxPRs<1||opts.maxPRs>50000 ||
     !Number.isSafeInteger(opts.maxRepos)||opts.maxRepos<1||opts.maxRepos>10000 ||
     !Number.isSafeInteger(opts.maxRequests)||opts.maxRequests<1||opts.maxRequests>100000)
    throw Error('invalid bounded query budgets');
  return opts;
}
const opts=parseArgs(process.argv.slice(2));
const token=process.env.GITHUB_TOKEN;
if(!token)throw Error('GITHUB_TOKEN with installation-scoped READ permissions required');
const stop=opts.stop??new Date(Math.ceil(Date.now()/1000)*1000).toISOString().replace(/\.000Z$/,'Z');
const client=githubReadClient({token,maxRequests:opts.maxRequests});
const inventory=await inventoryOrg({...opts,client,stop});
const inspected=[];
if(opts.inspectCI){
  for(const pr of inventory.prs.slice(0,opts.maxPRs)){
    inspected.push(await inspectPR(client,pr.repository,pr.number,collectExactHeadEvidence));
  }
}else inventory.gaps.push({kind:'EXACT_HEAD_CI_NOT_INSPECTED',reason:'pass --inspect-ci for per-PR run/job/step reads'});
const result={createdAt:new Date().toISOString(),mode:'READ_ONLY_DIAGNOSTIC_NOT_RELEASE_AUTHORIZATION',
  inventory:{...inventory,complete:inventory.gaps.length===0},inspected,
  exactHeadCoverage:opts.inspectCI?inspected.filter(x=>x.headVerified).length:0,
  complete:inventory.gaps.length===0 && opts.inspectCI && inspected.length===inventory.prs.length &&
    inspected.every(x=>x.complete),stats:{...client.stats}};
await persistSnapshot(opts.output,result);
process.stdout.write(JSON.stringify({file:opts.output,repoCount:inventory.repositories.length,
  prCount:inventory.prs.length,complete:result.complete,gaps:inventory.gaps.length,stats:client.stats})+'\n');
// Exit nonzero for incomplete coverage; file is diagnostic even when exit 0.
if(!result.complete)process.exitCode=3;
