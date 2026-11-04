import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const fixture=new URL('../contracts/v1/liveview-wire-v1.json',import.meta.url);
const verifier=new URL('../bin/verify_liveview_wire.py',import.meta.url);
const source=JSON.parse(readFileSync(fixture,'utf8'));
function run(manifest) {
  const dir=mkdtempSync(join(tmpdir(),'ores-live-wire-'));
  try {
    const path=join(dir,'test.json');
    writeFileSync(path,JSON.stringify(manifest));
    return spawnSync('python3',[verifier.pathname,path],{encoding:'utf8',timeout:10000});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('independent portable wire oracle matches 14 Phoenix vectors',()=>{
  const r=run(source);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/HOST_WIRE_ORACLE_PASS cases=14/);
  assert.match(r.stdout,/NATIVE_GUEST_NOT_EXECUTED/);
});
test('duplicate vector names are not silently accepted',()=>{
  const m=structuredClone(source);m.cases[1].id=m.cases[0].id;
  assert.notEqual(run(m).status,0);
});
test('tampered client mask or expected close status fails closed',()=>{
  const a=structuredClone(source);a.cases[0].frames_hex='810568656c6c6f';
  assert.notEqual(run(a).status,0);
  const b=structuredClone(source);b.cases.find(c=>c.id==='invalid-utf8-rejected').error_code=1002;
  assert.notEqual(run(b).status,0);
});
test('unknown extension of expected status cannot be disguised as success',()=>{
  const m=structuredClone(source);m.cases[0].error_code=1002;
  assert.notEqual(run(m).status,0);
});

test('misstated wire budgets cannot masquerade as native parity',()=>{
  const m=structuredClone(source);m.limits.max_message_bytes=2**24;
  assert.notEqual(run(m).status,0);
  const n=structuredClone(source);n.limits.max_fragments=2048;
  assert.notEqual(run(n).status,0);
});
test('missing source pin is a failed conformance fixture',()=>{
  const m=structuredClone(source);m.source.blob='0'.repeat(39);
  assert.notEqual(run(m).status,0);
});
