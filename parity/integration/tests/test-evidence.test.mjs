import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessTap, assessProcess} from '../src/test-evidence.mjs';
const summary = ({tests=2,pass=2,fail=0,cancelled=0,skipped=0,todo=0}={}) => `TAP version 13\n${Array.from({length:tests},(_,i)=>`ok ${i+1} - case-${i+1}\n`).join('')}1..${tests}\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;
test('36 real Node test process produces verifiable TAP summary', async()=>{
 const root=await mkdtemp(join(tmpdir(),'ores-wave8-'));
 try {
  const file=join(root,'probe.test.mjs');
  await writeFile(file,`import test from 'node:test'; import assert from 'node:assert/strict'; test('actual arithmetic',()=>assert.equal(6*7,42));\n`);
  const p=spawnSync(process.execPath,['--test',file],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(p.status,0,p.stderr);
  const result=assessProcess(p);
  assert.equal(result.counts.tests,1);assert.equal(result.counts.pass,1);
  assert.equal(result.compilerParityVerified,false);
 } finally {await rm(root,{recursive:true,force:true})}
});
test('36 zero-test green exit is not success',()=>assert.throws(()=>assessProcess({status:0,signal:null,error:null,stderr:'',stdout:summary({tests:0,pass:0})}),/plan|absent/));
test('36 skipped or TODO tests cannot pass source conformance',()=>{
 assert.throws(()=>assessTap(summary({skipped:1})),/skipped|TODO/);
 assert.throws(()=>assessTap(summary({todo:1})),/TODO/);
});
test('36 failed or cancelled tests are rejected even with status zero',()=>{
 assert.throws(()=>assessTap(summary({fail:1})),/failed|plan/);
 assert.throws(()=>assessTap(summary({cancelled:1})),/cancelled|plan/);
});
test('36 malformed, duplicated, forged and overlarge TAP summaries rejected',()=>{
 for(const input of [summary()+ '# pass 2\n',summary().replace('# tests 2','# tests NaN'),summary().replace('# tests 2','# tests -1'),summary().replace('TAP version 13','TAP version 12'),'x'.repeat(2*1024*1024+1)]) assert.throws(()=>assessTap(input),/wave9-test-evidence/);
});
test('36 runner process failure and stderr cannot be obscured by valid TAP',()=>{
 for(const changed of [{status:1},{signal:'SIGTERM'},{error:Error('timeout')},{stderr:'unexpected warning'}]){
  const p={status:0,signal:null,error:null,stderr:'',stdout:summary(),...changed};
  assert.throws(()=>assessProcess(p),/wave9-test-evidence/);
 }
});
test('36 returns host-only evidence even if TAP fully passes',()=>{
 const r=assessTap(summary());assert.equal(r.status,'EXECUTED_NODE_TESTS');assert.equal(r.hostOnly,true);assert.equal(r.compilerParityVerified,false);
});

test('41 / fabricated summary with no TAP test numbers is denied',()=>{
 const forged='TAP version 13\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
 assert.throws(()=>assessTap(forged),/plan/);
});
test('41 / duplicated and out-of-order top-level assertions rejected',()=>{
 const s=summary();
 assert.throws(()=>assessTap(s.replace('ok 2 - case-2','ok 1 - case-2')),/plan/);
 assert.throws(()=>assessTap(s+'1..2\n'),/duplicated/);
});
test('41 / a top-level or nested not-ok is rejected even when counts are forged',()=>{
 assert.throws(()=>assessTap(summary().replace('ok 1','not ok 1')), /failed TAP/);
 assert.throws(()=>assessTap(summary().replace('ok 1','    not ok 1')), /failed TAP/);
});
