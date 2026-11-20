#!/usr/bin/env node
import {load} from '../src/manifest.mjs';
try {
 if(process.argv.length!==2)throw Error('wave6 manifest validation has no promotion flag');
 const m=await load();
 console.log(JSON.stringify({status:'PINNED_CONTRACT_ONLY',tasks:m.tasks.map(t=>t.id),fixtures:m.fixtures.length,profiles:m.profiles.length,realCompilerExecuted:false,releaseCertified:false}));
} catch(e) { console.error(e.stack||e.message);process.exitCode=2; }
