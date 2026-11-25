import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const manifest=JSON.parse(readFileSync(new URL('../contracts/java-style-no-copy-passing-v1.json', import.meta.url),'utf8'));
test('all 11 compiler status slots are explicit and unverified',()=>{
  assert.equal(manifest.status,'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(manifest.backends.length,11);
  assert.equal(new Set(manifest.backends).size,11);
  assert.equal(manifest.cases.length,26);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,26);
  for(const c of manifest.cases){
    assert.match(c.id,/^JNP-\d{3}$/);
    assert.ok(['ALLOW','REJECT'].includes(c.verdict));
    assert.ok(c.scenario.length>15 && c.oracle.length>4);
    assert.equal(c.admission,'TARGET_ONLY');
    assert.deepEqual(Object.keys(c.backend_status).sort(),[...manifest.backends].sort());
    assert.ok(Object.values(c.backend_status).every(x=>x==='NOT_EXECUTED'));
  }
});
test('no-copy / exclusivity / capability-transfer obligations cannot disappear',()=>{
  const scenarios=manifest.cases.map(c=>c.scenario.toLowerCase()).join('\n');
  for(const phrase of ['same allocation identity','two simultaneous read-only','writes through','overlapping across argument','copy! with','copy!! with','pointer<t> argument','double unref','stale handle','numeric ref32','independently owned','throwing, raising','128-bit value','serialization','virtual/ffi']){
    assert.ok(scenarios.includes(phrase),phrase);
  }
  const required=[['JNP-001','ALLOW'],['JNP-003','ALLOW'],['JNP-004','REJECT'],['JNP-005','REJECT'],['JNP-014','REJECT'],['JNP-015','REJECT'],['JNP-018','REJECT'],['JNP-019','REJECT'],['JNP-022','REJECT']];
  for(const [id,verdict] of required)assert.equal(manifest.cases.find(c=>c.id===id)?.verdict,verdict);
});
test('no backend can be promoted by target-only source-model checks',()=>{
  assert.ok(manifest.cases.every(c=>c.admission==='TARGET_ONLY'));
  assert.ok(manifest.cases.every(c=>Object.values(c.backend_status).every(s=>s==='NOT_EXECUTED')));
});
