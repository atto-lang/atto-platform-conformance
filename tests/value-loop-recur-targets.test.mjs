import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../fixtures/value-loop-recur-v1/',import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const profiles = ['java-graalvm','llvm-native','wasm-independent','net-nativeaot','forge-native','cranelift-native','rs-wasm','js-esm','hdl-specialized','realtime-specialized'];
const read = path => readFileSync(new URL(path,root));
const gitBlob = b => createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
test('fixed inventory and unique paths, no dropped historical controls',()=>{
  assert.equal(m.schema,'atto.value-loop-recur.targets.v1');
  assert.equal(m.cases.length,28);
  assert.equal(new Set(m.cases.map(c=>c.id)).size,28);
  assert.equal(new Set(m.cases.map(c=>c.path)).size,28);
  for(const [kind,n] of [['pass',12],['fail',16]]){
    const names=readdirSync(new URL(kind+'/',root)).filter(x=>x.endsWith('.atto')).sort();
    assert.equal(names.length,n);
    assert.deepEqual(m.cases.filter(c=>c.path.startsWith(kind+'/')).map(c=>c.path.slice(kind.length+1)).sort(),names);
  }
});
test('all source blobs and exact expected outcomes are pinned',()=>{
  for(const c of m.cases){
    assert.match(c.path,/^(pass|fail)\/[0-9]+-[a-z0-9-]+\.atto$/);
    const b=read(c.path),s=b.toString('utf8');
    assert.equal(gitBlob(b),c.blob,c.path);
    assert.equal(c.origin_path,'tests/fixtures/'+c.path);
    if(c.path.startsWith('pass/')){
      assert.equal(c.expected.kind,'execute');
      assert.match(c.expected.return_i64,/^-?\d+$/);
      assert.equal(s.match(/^\/\/ expect-exit: (-?\d+)$/m)?.[1],c.expected.return_i64);
      const lines=[...s.matchAll(/^\/\/ expect-stdout: (.*)$/gm)].map(x=>x[1]);
      assert.equal(c.expected.stdout,lines.length?lines.join('\n')+'\n':'');
    }else{
      assert.equal(c.expected.kind,'reject');
      assert.equal(c.expected.no_artifact,true);
      assert.match(c.expected.historical_rust_diagnostic,/^E_[A-Z0-9_]+$/);
      assert.equal(s.match(/^\/\/ expect-error: (E_[A-Z0-9_]+)$/m)?.[1],c.expected.historical_rust_diagnostic);
    }
  }
});
test('no fixture inventory or historical receipt can certify a backend',()=>{
  assert.equal(m.status,'TARGET_NOT_EXECUTED');
  assert.deepEqual(Object.keys(m.profile_status).sort(),profiles.sort());
  for(const status of Object.values(m.profile_status))assert.equal(status,'NOT_EXECUTED');
  assert.equal(m.origin.commit,'05d1cf6841f2f91b1678c8e0c296dc476f5e3789');
  assert.equal(m.origin.historical_commit,'24a2102ecb7902a0274db59086ec513ce5050cc9');
});
