#!/usr/bin/env node
import {loadManifest,runCompilerCandidates} from '../src/manifest.mjs';
try{
 const args={};
 for(const raw of process.argv.slice(2)){
  const match=/^--(validate|backend|argv|source-sha|timeout-ms)(?:=(.*))?$/.exec(raw);
  if(!match||Object.hasOwn(args,match[1])||(match[1]==='validate'&&match[2]!==undefined)||(match[1]!=='validate'&&!match[2]))throw Error('invalid/duplicate CLI argument');
  args[match[1]]=match[1]==='validate'?true:match[2];
 }
 if(args.validate){
  if(Object.keys(args).length!==1)throw Error('--validate is exclusive');
  const m=await loadManifest();console.log(JSON.stringify({status:'SOURCE_CONTRACT_VALID_ONLY',tasks:m.tasks.length,sourceCases:m.sourceCases.length,verified:false}));
 }else{
  if(!args.backend)throw Error('--backend required');
  const result=await runCompilerCandidates({backend:args.backend,argv:args.argv?JSON.parse(args.argv):undefined,sourceSha:args['source-sha'],timeoutMs:args['timeout-ms']?Number(args['timeout-ms']):10000});
  console.log(JSON.stringify(result,null,2));
  if(!result.configured)process.exitCode=3;
  else if(result.status==='INCOMPLETE')process.exitCode=1;
 }
}catch(err){console.error(err.stack||err.message);process.exitCode=2;}
