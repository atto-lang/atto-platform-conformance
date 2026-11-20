#!/usr/bin/env node
import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {compareEvidence} from '../src/differential.mjs';
try {
 if(process.argv.length!==3||!process.argv[2].startsWith('--observations='))throw Error('use --observations=/absolute/path/to/observations.json');
 const path=process.argv[2].slice('--observations='.length);
 if(!isAbsolute(path))throw Error('absolute observations file required');
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>512*1024)throw Error('bounded regular observations file required');
 const parsed=JSON.parse(await readFile(path,'utf8'));
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==2||!Object.hasOwn(parsed,'records')||!Object.hasOwn(parsed,'requiredCases'))throw Error('invalid observations envelope');
 const result=compareEvidence(parsed.records,{requiredCases:parsed.requiredCases});
 console.log(JSON.stringify(result,null,2));
 // Never certify a release from self-reported values, even if all five look identical.
 process.exitCode=result.status==='DIVERGENT'?1:result.status==='INCOMPLETE'?3:4;
} catch(err) {console.error(err.stack||err.message);process.exitCode=2}
