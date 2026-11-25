// SOURCE_ONLY: registry/fixture integrity. Not compiled Atto guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root,'contracts/pointer-ref-local-v1.json'),'utf8'));
const anchors = {"PRL-009":["ptr = ref! value;","deref! ptr;","unref! ptr;"],"PRL-010":["ref!value;","deref!ptr;","unref!ptr;"],"PRL-011":["rt ref (value);","deref! (ptr);","rt unref (ptr);"],"PRL-012":["first = rt deref ptr;","second = deref! ptr;"],"PRL-013":["rt unref ptr;","value = 43;","return answer;"],"PRL-014":["unref! first;","second = ref! value;","rt unref second;"],"PRL-015":["rt ref left;","rt ref right;","rt unref p;"],"PRL-016":["first = rt ref value;","second = rt ref value;","unref! second;"],"PRL-017":["rt ref (40 + 2);"],"PRL-018":["duplicate = ptr;"],"PRL-019":["drop! value;","unref! ptr;"],"PRL-020":["Pointer<bool> ptr = rt ref value;"],"PRL-021":["restored: int = unref! ptr;"],"PRL-022":["do if early then","return answer;","rt unref ptr;"],"PRL-023":["do if release then","rt unref ptr;"],"PRL-024":["ptr = &value;"],"PRL-025":["answer = *ptr;"],"PRL-026":["deref !ptr;"],"PRL-027":["unref !ptr;"],"PRL-028":["rt deref 42;"],"PRL-029":["copy! ptr;"],"PRL-030":["share! ptr;"],"PRL-031":["drop! value;","rt ref value;"],"PRL-032":["unref! value;"],"PRL-033":["ptr.close();"],"PRL-034":["ptr.write_at(0, 13);"],"PRL-035":["ptr as int;"],"PRL-036":["let value: int;","deref! ptr;"]};
const backends = ["atto-source.atto","atto-source.cranelift","atto-source.forge","atto-source.hdl","atto-source.java","atto-source.js","atto-source.llvm","atto-source.net","atto-source.realtime","atto-source.rs","atto-source.wasm"];
function source(path) {
  assert.match(path,/^fixtures\/pointer-ref-local-v1\/(pass|fail)\/[a-z-]+\.atto$/);
  assert.ok(!path.includes('..'));
  return readFileSync(resolve(root,path),'utf8');
}
function blobHash(s) {
  const raw=Buffer.from(s,'utf8');
  return createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
}
test('original user examples remain byte-identical and equivalently lowered target sources',()=>{
  const a=source(manifest.cases[0].path), b=source(manifest.cases[1].path);
  assert.equal(blobHash(a),'6056400afa8d7b9b71f29be5ca4cfb15240a59b3');
  assert.equal(blobHash(b),'8fa66e68b386c2c6d1f2b15b9399e70a116c0828');
  assert.equal(a.replace('rt deref ptr','deref! ptr').replace('rt unref ptr','unref! ptr'),b);
});
test('36 unique target fixtures have valid positive or no-artifact negative obligations',()=>{
  assert.equal(manifest.schema,'atto.pointer-ref-local.v1');
  assert.equal(manifest.status,'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(manifest.case_count,36);
  assert.equal(manifest.pass_count,10);
  assert.equal(manifest.reject_count,26);
  assert.equal(manifest.cases.length,36);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,36);
  assert.equal(new Set(manifest.cases.map(x=>x.path)).size,36);
  for(const [i,c] of manifest.cases.entries()){
    assert.equal(c.id,'PRL-'+String(i+1).padStart(3,'0'));
    assert.equal(c.status,'NOT_EXECUTED');
    const code=source(c.path);
    assert.ok(code.endsWith('\n'));
    assert.ok(Buffer.byteLength(code,'utf8')<=8192);
    assert.match(code,/pub fnc main\(\): int/);
    if(c.result==='PASS'){
      assert.match(c.path,/\/pass\//);assert.equal(c.exit,42);
      assert.ok(!('error_category' in c));
    } else {
      assert.equal(c.result,'REJECT_NO_ARTIFACT');
      assert.match(c.path,/\/fail\//);
      assert.match(c.error_category,/^E_POINTER_/);
      assert.ok(!('exit' in c));
    }
  }
  assert.equal(manifest.cases.filter(x=>x.result==='PASS').length,10);
  assert.equal(manifest.cases.filter(x=>x.result==='REJECT_NO_ARTIFACT').length,26);
});
test('28 new scenarios are anchored to their distinct source-level behavior',()=>{
  assert.equal(Object.keys(anchors).length,28);
  for(const [id,parts] of Object.entries(anchors)){
    const c=manifest.cases.find(x=>x.id===id);
    assert.ok(c,'case missing '+id);
    const code=source(c.path);
    for(const part of parts)assert.ok(code.includes(part),id+' lacks '+part);
  }
});
test('eleven backend evidence slots stay fail-closed until real guest execution',()=>{
  assert.deepEqual(Object.keys(manifest.backend_status).sort(),backends);
  assert.equal(backends.length,11);
  for(const v of Object.values(manifest.backend_status)){
    assert.equal(v.status,'NOT_EXECUTED');
    assert.equal(v.compiler_commit,null);
    assert.equal(v.guest_artifact,null);
    assert.equal(v.runner,null);
  }
  assert.equal(manifest.normative_source,'atto-lang/atto-spec#18');
  assert.ok(manifest.candidate_prototype.includes('class handles only'));
  assert.ok(manifest.proof_requirements.some(x=>x.includes('Actually execute compiled guest')));
  assert.ok(manifest.proof_requirements.some(x=>x.includes('Typed IR equality')));
  assert.ok(manifest.proof_requirements.some(x=>x.includes('no emitted guest module')));
});
