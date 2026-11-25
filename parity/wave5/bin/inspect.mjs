#!/usr/bin/env node
import {inspectAot} from '../src/evidence.mjs';
const bad=x=>{throw Error('wave5-cli: '+x)};
try{
 const params={};
 for(const token of process.argv.slice(2)){
  const m=/^--(task|backend|target|artifact|sha256|profile|allow-import)(?:=(.*))$/.exec(token);
  if(!m||!m[2])bad('unknown/missing argument');
  if(m[1]!=='allow-import'&&Object.hasOwn(params,m[1]))bad('duplicate argument');
  if(m[1]==='allow-import'){params.allowImports??=[];params.allowImports.push(m[2]);}
  else params[m[1]]=m[2];
 }
 if(!/^(22|23|24|25)$/.test(params.task||''))bad('binary CLI supports tasks 22–25');
 const result=await inspectAot({
  task:Number(params.task),backend:params.backend,target:params.target,artifactPath:params.artifact,
  artifactSha256:params.sha256,wasmProfile:params.profile??'scalar',allowedImports:params.allowImports??[]
 });
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.stack||e.message);process.exitCode=2}
