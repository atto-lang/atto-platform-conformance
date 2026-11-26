import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../fixtures/exception-unwind-ownership/v1/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
test('ownership unwind targets pin source and existing scenario registry; no backend pass is implied',()=>{
  assert.equal(manifest.status,'TARGET_NOT_CERTIFIED');
  assert.equal(manifest.cases.length,20);
  assert.equal(new Set(manifest.cases.map(c=>c.id)).size,20);
  assert.equal(new Set(manifest.backend_names).size,11);
  const registryBytes=readFileSync(new URL('../'+manifest.scenario_registry.path,import.meta.url));
  assert.equal(gitBlob(registryBytes),manifest.scenario_registry.git_blob_sha1);
  const registry=JSON.parse(registryBytes);
  assert.deepEqual([...manifest.backend_names].sort(),registry.backends.map(b=>b.replace('atto-source.','')).sort());
  assert.deepEqual(readdirSync(root).filter(p=>p.endsWith('.atto')).sort(),manifest.cases.map(c=>c.path).sort());
  for(const c of manifest.cases){
    assert.match(c.path,/^[a-z-]+\.atto$/);
    assert.equal(gitBlob(readFileSync(new URL(c.path,root))),c.git_blob_sha1,c.id);
    assert.ok(registry.cases.some(x=>x.id===c.scenario),c.id);
    assert.deepEqual(Object.keys(c.backend_statuses).sort(),[...manifest.backend_names].sort());
    assert.ok(Object.values(c.backend_statuses).every(x=>x==='NOT_EXECUTED'));
    if(c.expected.kind==='compile_rejection')assert.ok(c.expected.diagnostic);
    else {
      assert.ok(Array.isArray(c.expected.stdout));
      assert.ok(Array.isArray(c.expected.required_observations));
      if(c.expected.kind==='guest_trace')assert.equal(c.expected.return_i64,'42');
      else assert.ok(['throw','raise','panic'].includes(c.expected.effect));
    }
  }
  assert.equal(manifest.cases.filter(c=>c.expected.kind==='guest_trace').length,13);
  assert.equal(manifest.cases.filter(c=>c.expected.kind==='compile_rejection').length,4);
  assert.equal(manifest.cases.filter(c=>c.expected.kind==='escaping_guest_effect').length,3);
});
