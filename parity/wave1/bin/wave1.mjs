#!/usr/bin/env node
import {loadCatalog,runWave1} from '../src/wave1.mjs';
try {
  const args={};
  for(const token of process.argv.slice(2)) {
    const m=/^--(list|backend|category|argv|source-sha|timeout-ms)(?:=(.*))?$/.exec(token);
    if(!m||Object.hasOwn(args,m[1])||(!['list'].includes(m[1])&&!m[2]))throw Error('invalid/duplicate wave1 argument');
    if(m[1]==='list'&&m[2]!==undefined)throw Error('list takes no value');
    args[m[1]]=m[2]??true;
  }
  if(args.list) {
    if(Object.keys(args).length!==1)throw Error('--list is exclusive');
    const catalog=await loadCatalog();
    console.log(JSON.stringify({policy:catalog.policy,backends:catalog.backends,features:catalog.features,cases:catalog.cases.map(({id,feature,expect})=>({id,feature,expect})),verified:false},null,2));
  } else {
    if(!args.backend)throw Error('--backend required');
    const argv=args.argv?JSON.parse(args.argv):undefined;
    const timeoutMs=args['timeout-ms']===undefined?10000:Number(args['timeout-ms']);
    const result=await runWave1({backend:args.backend,category:args.category,argv,sourceSha:args['source-sha'],timeoutMs});
    console.log(JSON.stringify(result,null,2));
    if(!result.configured)process.exitCode=3;
    else if(!result.ok)process.exitCode=1;
  }
} catch(err){console.error(err.stack||err.message);process.exitCode=2;}
