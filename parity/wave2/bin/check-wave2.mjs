#!/usr/bin/env node
import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadManifest,evaluateReport} from '../src/gate.mjs';
try{
 const args={};
 for(const token of process.argv.slice(2)){
  if(token==='--manifest-only'){if(Object.hasOwn(args,'manifest-only'))throw Error('duplicate --manifest-only');args['manifest-only']=true;continue;}
  const m=/^--(report)=(.+)$/.exec(token);
  if(!m||Object.hasOwn(args,m[1]))throw Error('unexpected/duplicate argument: '+token);
  args[m[1]]=m[2];
 }
 if(Boolean(args.report)===Boolean(args['manifest-only']))throw Error('specify exactly one of --manifest-only or --report=PATH');
 const manifest=await loadManifest();
 if(args['manifest-only'])console.log(JSON.stringify({cases:manifest.cases.length,areas:manifest.areas,backends:manifest.backends,verified:false,sourceHashesVerified:true},null,2));
 else{
  const path=resolve(args.report),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('report must be a regular file <=1 MiB');
  const report=JSON.parse(await readFile(path,'utf8'));
  const result=evaluateReport(manifest,report);
  console.log(JSON.stringify(result,null,2));
  if(!result.consistent)process.exitCode=1;
 }
}catch(e){console.error(e.stack||e.message);process.exitCode=2;}
