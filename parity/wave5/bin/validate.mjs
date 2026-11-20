#!/usr/bin/env node
import {loadManifest} from '../src/manifest.mjs';
try{
 if(process.argv.length!==3||process.argv[2]!=='--validate')throw Error('usage: node parity/wave5/bin/validate.mjs --validate');
 const m=await loadManifest();
 console.log(JSON.stringify({status:'SOURCE_CONTRACT_ONLY',tasks:m.tasks.map(t=>t.id),fixtures:m.fixtures.length,
  compilerExecuted:false,guestExecuted:false,parityVerified:false}));
}catch(e){console.error(e.stack||e.message);process.exitCode=2}
