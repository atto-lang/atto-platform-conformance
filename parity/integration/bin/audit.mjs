#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {collectRun} from '../src/run-audit.mjs';
try{
 const args={};
 for(const x of process.argv.slice(2)){
  const m=/^--(run-id|head|attempt|output)=(.+)$/.exec(x);
  if(!m||Object.hasOwn(args,m[1]))throw Error('unsupported/duplicate option');
  args[m[1]]=m[2];
 }
 if(Object.keys(args).some(k=>!['run-id','head','attempt','output'].includes(k))||!args['run-id']||!args.head||!args.output||!isAbsolute(args.output))throw Error('expected --run-id --head --output absolute path');
 const report=await collectRun({runId:Number(args['run-id']),expectedHead:args.head,attempt:args.attempt?Number(args.attempt):1,token:process.env.GITHUB_TOKEN});
 await writeFile(args.output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({report:args.output,classification:report.classification,reportSha256:report.reportSha256,releaseCertified:false}));
 if(report.classification==='NO_EXECUTED_TEST_EVIDENCE')process.exitCode=3;
 else if(report.classification==='NOT_FINAL')process.exitCode=4;
 else process.exitCode=5; // no metadata-only green path
}catch(e){console.error(String(e.message||e));process.exitCode=2}
