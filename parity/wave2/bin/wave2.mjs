#!/usr/bin/env node
import {loadManifest,runWave2} from '../src/wave2.mjs';
try{
 const args={};
 for(const token of process.argv.slice(2)){
  const m=/^--(list|backend|task|check-argv|execute-argv|source-sha|timeout-ms|require-all)(?:=(.*))?$/.exec(token);
  if(!m||Object.hasOwn(args,m[1]))throw Error('invalid/duplicate wave2 argument');
  if(['list','require-all'].includes(m[1])){if(m[2]!==undefined)throw Error('flag must not have a value');args[m[1]]=true;}
  else {if(!m[2])throw Error('missing argument value');args[m[1]]=m[2];}
 }
 if(args.list){
  if(Object.keys(args).length!==1)throw Error('--list is exclusive');
  const m=await loadManifest();
  console.log(JSON.stringify({status:m.status,backends:m.backends,tasks:m.tasks,cases:m.cases.map(({id,task,mode,candidates})=>({id,task,mode,candidates})),verified:false},null,2));
 }else{
  if(!args.backend)throw Error('--backend is required');
  if(args.task && !/^(6|7|8|9|10)$/.test(args.task))throw Error('unknown task');
  if(args['source-sha'] && !/^[0-9a-f]{40}$/.test(args['source-sha']))throw Error('invalid source SHA');
  const result=await runWave2({backend:args.backend,task:args.task?Number(args.task):undefined,
   checkArgv:args['check-argv']?JSON.parse(args['check-argv']):undefined,
   executeArgv:args['execute-argv']?JSON.parse(args['execute-argv']):undefined,
   sourceSha:args['source-sha'],
   timeoutMs:args['timeout-ms']===undefined?10000:Number(args['timeout-ms']),
   requireAll:!!args['require-all']});
  console.log(JSON.stringify(result,null,2));
  if(!result.configured)process.exitCode=3;
  else if(!result.ok)process.exitCode=1;
 }
}catch(e){console.error(e.stack||e.message);process.exitCode=2;}
