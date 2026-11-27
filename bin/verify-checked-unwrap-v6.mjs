import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync, readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const root = new URL('../fixtures/option-result-trap/v6/', import.meta.url);
const backends = Object.freeze(['java-jvm','java-native-image','dotnet-coreclr',
  'dotnet-native-aot','llvm-native-aot','rust','wasm','javascript','forge',
  'cranelift','hdl','self-hosted-atto','realtime']);
const pins = Object.freeze([
  ['checked-unwrap.atto','90c6166041963d1f466bc51f105c66a0a7be15ac',{result:42}],
  ['inline-task-failure.atto','446624a894788834550ac7a13a7a76ea5d06444c',{result:42,stdout:'D'}],
  ['short-circuit.atto','d24442cf7daf1dd86876b418f0cb9e793cbb23c2',{result:42,stdout:'RR'}],
  ['terminal-expect.atto','864e6b34fe46de9c260a7e537f3f008caa7c8b79',{runtime_failure:'uncaught_guest_panic'}],
  ['piped-match-none.atto','fb1653c04f6556e130ec0dc51f8a0fd933e34580',{result:42}],
  ['piped-match-some.atto','77b3f981f031aaaef072f1c68b66960825cf232c',{result:42}],
  ['piped-match-dynamic.atto','99cf8ea1bf165b622c65400244a684ae0153fcb9',{result:42}],
  ['piped-match-arm-throw.atto','411801dc7eb4f6e3065911012ba21f3ffc8227c4',{result:42}],
  ['piped-match-error-binding.atto','13ee1d7cd4b83e062c4f8b454d2b5b213cc24a8f',{result:42}]
].map(row=>Object.freeze([row[0],row[1],Object.freeze(row[2])])));
const blob = bytes => createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');

// Pin the serialized manifest as well as the parsed semantics. JSON.parse alone
// silently accepts duplicate keys; other JSON consumers may interpret them differently.
export function parsePinnedCheckedUnwrapManifest(bytes) {
  assert.ok(bytes instanceof Uint8Array && bytes.length>0 && bytes.length<=131072,
    'invalid manifest bytes');
  assert.equal(blob(bytes),'e94694be7bd6f5ade1b5058262903616448fca86',
    'manifest blob drift');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function verifyCheckedUnwrapManifest(manifest, readFixture, fixtureNames) {
  assert.deepEqual(manifest, {
    format:'atto.checked-unwrap.v6-candidate', spec:'atto-lang/atto-spec#249',
    status:'AUTHORED_NOT_EXECUTED', required_backends:[...backends],
    cases:pins.map(([path,git_blob_sha1,expected])=>({path,git_blob_sha1,expected}))
  }, 'manifest differs from independently pinned v6 corpus');
  assert.deepEqual([...fixtureNames].sort(), pins.map(row=>row[0]).sort(),
    'unregistered or missing fixture');
  for (const [name,sha] of pins) {
    const bytes=readFixture(name);
    assert.ok(bytes instanceof Uint8Array && bytes.length>0 && bytes.length<=131072,
      'invalid fixture bytes: '+name);
    assert.equal(blob(bytes),sha,'fixture blob drift: '+name);
  }
  return {source_fixtures_verified:pins.length, target_profiles:backends.length,
    candidate_cells:pins.length*backends.length, guest_executions:0,
    evidence_kind:'SOURCE_INTEGRITY_ONLY'};
}

// This is a checkout integrity gate, not a sandbox or execution attestation.
function readRegular(name) {
  const path=new URL(name,root), st=lstatSync(path);
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink===1 &&
    st.size>0 && st.size<=131072,'unsafe fixture file: '+name);
  const bytes=readFileSync(path);
  assert.equal(bytes.length,st.size,'fixture size drift');
  return bytes;
}
export function verifyCheckout() {
  const manifest=parsePinnedCheckedUnwrapManifest(readRegular('manifest.json'));
  const names=readdirSync(root).filter(name=>name.endsWith('.atto'));
  return verifyCheckedUnwrapManifest(manifest,readRegular,names);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url)
  console.log(JSON.stringify(verifyCheckout()));
