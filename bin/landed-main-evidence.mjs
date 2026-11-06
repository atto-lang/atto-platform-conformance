#!/usr/bin/env node
// Offline, no tokens, no GitHub API, no repository mutation.
import {readFileSync,lstatSync} from 'node:fs';
import {auditLedger} from '../tools/landed-main-evidence.mjs';
try {
  if (process.argv.length!==3) throw Error('usage: node bin/landed-main-evidence.mjs <ledger.json>');
  const path=process.argv[2], stat=lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size>262144) throw Error('invalid input file');
  const report=auditLedger(JSON.parse(readFileSync(path,'utf8')));
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  if (report.status==='BLOCKED') process.exitCode=1;
} catch(e) {console.error(`FAIL_CLOSED: ${e.message}`);process.exitCode=2;}
