import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../fixtures/exception-control-bang/v1/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
test('canonical bang guest suite has exact immutable sources and no invented backend receipts',()=>{
  assert.equal(manifest.schema,'atto.exception-control-bang.guest.v1');
  assert.equal(manifest.status,'TARGET_NOT_CERTIFIED');
  assert.equal(manifest.cases.length,28);
  assert.equal(manifest.backend_names.length,11);
  assert.equal(new Set(manifest.backend_names).size,11);
  assert.equal(manifest.cases.filter(c=>c.category==='admission').length,12);
  assert.equal(manifest.cases.filter(c=>c.category==='propagation').length,16);
  assert.deepEqual(readdirSync(root).filter(p=>p.endsWith('.atto')).sort(),manifest.cases.map(c=>c.path).sort());
  assert.equal(new Set(manifest.cases.map(c=>c.id)).size,28);
  for(const c of manifest.cases){
    assert.match(c.path,/^[a-z-]+\.atto$/);
    const bytes=readFileSync(new URL(c.path,root));
    const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    assert.equal(sha,c.git_blob_sha1,c.id);
    assert.match(bytes.toString('utf8'),/\b(?:trap|throw|raise|panic)!|\btry\b/,c.id);
    assert.deepEqual(Object.keys(c.backend_statuses).sort(),[...manifest.backend_names].sort());
    for(const state of Object.values(c.backend_statuses))assert.equal(state,'NOT_EXECUTED');
    assert.ok(['return_i64','compile_rejection','escaping_guest_effect'].includes(c.expected.kind));
  }
  const canonical=manifest.cases.find(c=>c.id==='canonical-catch');
  assert.equal(canonical.expected.value,'42');
  assert.equal(readFileSync(new URL(canonical.path,root),'utf8'),"pub fnc main(): int {\n    try {\n        throw! new Error(\"ordinary failure\");\n    } catch (err) {\n        return 42;\n    }\n}\n");
});
