#!/usr/bin/env node
import {executeAdapter} from '../src/adapter.mjs';
try {
 const opts={};
 for(const token of process.argv.slice(2)){
  const m=/^--(backend|area|adapter-argv|source-commit|timeout-ms)=(.+)$/.exec(token);
  if(!m||Object.hasOwn(opts,m[1]))throw Error('invalid/duplicate adapter argument '+token);
  opts[m[1]]=m[2];
 }
 if(!opts.backend||!opts['source-commit']||!opts['adapter-argv'])throw Error('--backend, --source-commit, --adapter-argv are required');
 const argv=JSON.parse(opts['adapter-argv']);
 const run=await executeAdapter({backend:opts.backend,area:opts.area||null,argv,sourceCommit:opts['source-commit'],
   timeoutMs:opts['timeout-ms']?Number(opts['timeout-ms']):10000});
 console.log(JSON.stringify(run,null,2));
 if(!run.evaluation.consistent)process.exitCode=1;
}catch(e){console.error(e.stack||e.message);process.exitCode=2;}
