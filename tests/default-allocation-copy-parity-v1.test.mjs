// Corpus integrity only: never claim compiler or allocation verification here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const c=JSON.parse(readFileSync(new URL('../contracts/default-allocation-copy-parity-v1.json',import.meta.url),'utf8'));
test('eleven profiles remain unverified',()=>{
  assert.equal(c.status,'TARGET_NOT_EXECUTED');
  assert.deepEqual(c.backendProfiles.map(x=>x.repo).sort(),['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'].map(x=>'atto-lang/atto-source.'+x).sort());
  assert.ok(c.backendProfiles.every(x=>x.status==='NOT_EXECUTED'));
});
test('signature variants preserve body, oracle and allocation targets',()=>{
  const variants=['define fnc Buffer • process(Buffer data)','define fnc Buffer <- process(Buffer data)','define fnc process(Buffer data) -> Buffer','define fnc process(Buffer data): Buffer','define fnc process(Buffer data) : Buffer ->'];
  const rows=c.cases.filter(x=>x.id.startsWith('signature-'));
  assert.equal(rows.length,5);
  for(let i=0;i<5;i++){
    assert.ok(rows[i].source.includes(variants[i]+' { return data; }'));
    assert.equal(rows[i].source.replace(variants[i],'<signature>'),rows[0].source.replace(variants[0],'<signature>'));
    assert.deepEqual(rows[i].expect,{kind:'execute',exit:42});
    assert.equal(rows[i].target.dynamicAllocations,0);
    assert.equal(rows[i].target.payloadCopies,0);
  }
});
test('corpus retains safety and measurement boundaries',()=>{
  assert.equal(c.cases.length,8);
  assert.equal(new Set(c.cases.map(x=>x.id)).size,8);
  assert.equal(new Set(c.cases.map(x=>x.source)).size,8);
  assert.ok(c.cases.every(x=>x.status==='NOT_EXECUTED'));
  const get=id=>c.cases.find(x=>x.id===id);
  assert.equal(get('independent-mutable-copy').target.preserveIndependentMutableState,true);
  assert.equal(get('move-use-after-transfer').expect.diagnostic,'E_MOVED');
  assert.equal(get('move-use-after-transfer').target.rejectBeforeCodegen,true);
  assert.equal(get('non-escaping-object').target.dynamicAllocations,0);
  assert.match(c.evidencePolicy.measurement,/do not infer zero/);
  assert.ok(c.evidencePolicy.required.includes('executed nonempty CI steps'));
});
