import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
const root=new URL('../fixtures/canonical-stdout/v1/',import.meta.url);
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const profiles=['java-jvm','java-native-image','dotnet-coreclr','dotnet-native-aot','llvm-native-aot','rust','wasm','javascript','forge','cranelift','hdl','self-hosted-atto','realtime'];
const pins=[
 ['stdio-direct.atto','fcb8c1b56322b1b068007513cd60791504de5918','AB'],
 ['process-direct.atto','0d4a07d1c1ccf6c9f1083816a3740091a8467641','AB'],
 ['mixed-defer.atto','7d1868164d3263bb8158c590a7ad0c36e069bb56','CBA'],
 ['mixed-trapped-task.atto','5b122c0396240cee7d0be125f952655560b1e78d','ED']
];
function read(name){const url=new URL(name,root),st=lstatSync(url);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size>0&&st.size<=65536,'unsafe fixture');const bytes=readFileSync(url);assert.equal(bytes.length,st.size);return bytes;}
function verify(manifestBytes,readFixture,names){
 assert.ok(manifestBytes instanceof Uint8Array);
 assert.equal(blob(manifestBytes),'d4199e0995c0b173b0ae9585953ade31d65e0ab2','manifest blob drift');
 assert.deepEqual(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)),{
  format:'atto.canonical-stdout.v1',status:'AUTHORED_NOT_EXECUTED',required_backends:profiles,
  cases:pins.map(([path,git_blob_sha1,stdout])=>({path,git_blob_sha1,expected:{result:42,stdout}}))
 });
 assert.deepEqual([...names].sort(),pins.map(p=>p[0]).sort(),'fixture inventory drift');
 for(const [name,sha] of pins){const b=readFixture(name);assert.ok(b instanceof Uint8Array&&b.length>0&&b.length<=65536);assert.equal(blob(b),sha,'fixture blob drift: '+name);}
 return {source_fixtures_verified:4,target_profiles:13,candidate_cells:52,guest_executions:0,evidence_kind:'SOURCE_INTEGRITY_ONLY'};
}
const names=readdirSync(root).filter(n=>n.endsWith('.atto'));
const manifest=read('manifest.json');
test('canonical stdout exact source and independent oracle pins',()=>assert.deepEqual(verify(manifest,read,names),{source_fixtures_verified:4,target_profiles:13,candidate_cells:52,guest_executions:0,evidence_kind:'SOURCE_INTEGRITY_ONLY'}));
test('reject changed bytes, missing fixtures, added newline and ambiguous JSON',()=>{
 assert.throws(()=>verify(manifest,read,names.slice(1)),/inventory drift/);
 assert.throws(()=>verify(manifest,read,[...names,'extra.atto']),/inventory drift/);
 assert.throws(()=>verify(manifest,n=>Buffer.concat([read(n),Buffer.from('\n')]),names),/fixture blob drift/);
 for(const mutated of [manifest.toString().replace('"status": "AUTHORED_NOT_EXECUTED"','"status": "PASS", "status": "AUTHORED_NOT_EXECUTED"'),manifest.toString().replace('"stdout": "AB"','"stdout": "AB\\n"')])
  assert.throws(()=>verify(Buffer.from(mutated),read,names),/manifest blob drift/);
});
