import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=new URL('../contracts/v1/caller-trap-parity/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
const required=new Set(['some-int','some-result-ok','some-result-err','some-none','ordinary-throw','panic-bypass','exactly-once','type-mismatch','result-is-not-throw']);
test('call-site trap contract is fail-closed and never claims unexecuted backend parity',()=>{
  assert.equal(manifest.schema,'atto.caller-trap-cross-backend.v1');
  assert.match(manifest.status,/NOT-full-runtime-parity/);
  assert.deepEqual(manifest.backends,['java-graalvm','llvm-native','dotnet-nativeaot']);
  assert.deepEqual(new Set(manifest.cases.map(x=>x.id)),required);
  for(const backend of manifest.backends){
    const audit=manifest.currentAudit[backend];
    assert.ok(audit);
    assert.deepEqual(audit.verifiedCaseIds,[]);
    assert.notEqual(audit.status,'parity-complete');
    assert.ok(audit.evidence.length>8);
  }
});
test('identical versioned Atto source fixtures preserve trap and nested type boundaries',async()=>{
  for(const item of manifest.cases){
    const source=await readFile(new URL(item.file,base),'utf8');
    assert.match(item.file,/^[0-9]{2}-[a-z-]+\.atto$/);
    assert.match(source,/^\/\/ ATTO-TRAP-V1-/);
    assert.match(source,/\btrap\b/);
    assert.match(source,/\bpub fnc main\(\): int\b/);
    assert.ok(!source.includes('.ores'));
    assert.ok(source.length>80 && source.length<4096);
  }
  const byId=Object.fromEntries(manifest.cases.map(x=>[x.id,x]));
  assert.equal(byId['exactly-once'].expect.stdout,'once');
  assert.equal(byId['panic-bypass'].expect.kind,'panic');
  assert.equal(byId['type-mismatch'].expect.kind,'diagnostic');
  assert.equal(byId['some-none'].expect.value,13);
});
test('status never treats rejects/skips or source-only checks as runtime passes',()=>{
  assert.match(manifest.evidencePolicy.verifiedCaseIdsRequire,/executed backend/);
  assert.match(manifest.evidencePolicy.skippedOrExpectedRejection,/never count/);
  assert.match(manifest.evidencePolicy.carriers,/private exact Git tree SHA/);
  assert.ok(manifest.requiredObservations.some(x=>x.includes('panic')));
  assert.ok(manifest.requiredObservations.some(x=>x.includes('exactly once')));
});
