#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {evaluateHotReloadReport,pendingReport}
  from '../src/actor-hot-reload-matrix.mjs';
const [command,path]=process.argv.slice(2);
try {
  if(command==='init'&&path) {
    writeFileSync(path,JSON.stringify(pendingReport(),null,2)+'\n',{flag:'wx'});
    console.log('Initialized all-blocked matrix: '+path);
  } else if(command==='check'&&path) {
    const result=evaluateHotReloadReport(JSON.parse(readFileSync(path,'utf8')));
    console.log(JSON.stringify(result,null,2));
    if(!result.structurally_complete||!result.authenticated_execution)
      process.exitCode=1; // Structural check cannot attest source or execution.
  } else {
    console.error('usage: node bin/actor-hot-reload-matrix.mjs init|check <report.json>');
    process.exitCode=2;
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
