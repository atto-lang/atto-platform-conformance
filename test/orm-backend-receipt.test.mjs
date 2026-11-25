import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyOrmReceipt} from '../bin/verify-orm-backend-receipt.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = fs.readFileSync(path.join(root,'contracts/orm-backend-parity-v1.json'));
const contract = JSON.parse(bytes);
const digest = createHash('sha256').update(bytes).digest('hex');
function fixture(backend='java') {
  return {
    schema:'oreslang.orm-backend-parity-receipt/1', backend,
    repository:contract.backends[backend].repository,
    sourceCommit:'a'.repeat(40), fixtureSha256:digest,
    run:{headCommit:'a'.repeat(40),exactHead:true,executedSteps:15,conclusion:'success'},
    compiler:{produced:true,hostOnly:false,binarySha256:'b'.repeat(64)},
    target:{executed:true,mode:contract.backends[backend].modes[0],artifactSha256:'c'.repeat(64)},
    results:contract.cases.map(c=>({id:c.id,observed:c.expect,executedByGuest:true}))
  };
}
function rejects(change, label) {
  const x=fixture();change(x);
  const r=verifyOrmReceipt(x,contract,bytes);
  assert.equal(r.ok,false,label+' should fail');
}
test('accepts only internally consistent synthetic receipt, not authenticated evidence',()=>{
  for(const name of Object.keys(contract.backends)) assert.equal(verifyOrmReceipt(fixture(name),contract,bytes).ok,true,name);
});
test('rejects unknown backend and repository substitution',()=>{
  rejects(r=>r.backend='__proto__','unknown');
  rejects(r=>r.repository='other/repo','substitution');
});
test('rejects zero-step and queued workflow',()=>{
  rejects(r=>r.run.executedSteps=0,'zero-step');
  rejects(r=>r.run.executedSteps=-1,'negative steps');
  rejects(r=>r.run.conclusion='queued','queued');
});
test('rejects mismatched or unverified exact head',()=>{
  rejects(r=>r.run.headCommit='f'.repeat(40),'head mismatch');
  rejects(r=>r.run.exactHead=false,'head flag');
});
test('rejects fabricated compiler/target or host oracle substitution',()=>{
  rejects(r=>r.compiler.produced=false,'host stub');
  rejects(r=>r.compiler.hostOnly=true,'host oracle');
  rejects(r=>r.compiler.binarySha256='', 'no compiler digest');
  rejects(r=>r.target.executed=false,'no guest execution');
  rejects(r=>r.target.mode='x86-host-python','wrong mode');
});
test('rejects digest mismatch and non-SHA fields',()=>{
  rejects(r=>r.fixtureSha256='0'.repeat(64),'wrong fixture');
  rejects(r=>r.target.artifactSha256='0','wrong artifact digest');
  rejects(r=>r.sourceCommit='not-hex','source');
});
test('rejects missing, duplicate, unexpected, mismatched or host-only case',()=>{
  rejects(r=>r.results.pop(),'missing');
  rejects(r=>r.results[1]=r.results[0],'duplicate');
  rejects(r=>r.results[0].id='unknown-case','unknown');
  rejects(r=>r.results[0].observed='bad','mismatch');
  rejects(r=>r.results[0].executedByGuest=false,'host-only');
});
test('refuses modified contract registry, case-count or expectations',()=>{
  for (const change of [c=>{delete c.backends.cranelift},c=>{c.cases.pop()},c=>{c.cases[0].expect='unknown'}]) {
    const bad=structuredClone(contract);change(bad);
    assert.equal(verifyOrmReceipt(fixture(),bad,bytes).ok,false);
  }
});
test('rejects substituted known oracle identity and altered backend mode whitelist',()=>{
  const changed=structuredClone(contract);
  changed.cases[0].id='invented_accept_case';
  assert.equal(verifyOrmReceipt(fixture(),changed,bytes).ok,false);
  const swapped=structuredClone(contract);
  swapped.cases[0].expect='reject';
  assert.equal(verifyOrmReceipt(fixture(),swapped,bytes).ok,false);
  const modes=structuredClone(contract);
  modes.backends.java.modes=['x86-host-python'];
  assert.equal(verifyOrmReceipt(fixture(),modes,bytes).ok,false);
});
