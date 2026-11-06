import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = new URL('../contracts/dop-inverted-v1/', import.meta.url);
const pins = new Map([
  ['swap-reuse.atto', '8f5599a9e0b11ded2929110b4936441fceb2ef21'],
  ['removed-index-trap.atto', 'c3c87cfd2515707932734e183bb5768436526a96']
]);
function gitBlobId(bytes) {
  const h = createHash('sha1');
  h.update(Buffer.from('blob ' + bytes.length + '\0'));
  h.update(bytes);
  return h.digest('hex');
}
function assertVector(manifest, vector, bytes) {
  assert.equal(manifest.contract, 'atto-dop-inverted-two-i64-guest-v1');
  assert.equal(manifest.scope, 'CANDIDATE_SOURCE_CONTRACT_ONLY');
  assert.equal(vector.blobSha1, pins.get(vector.file));
  assert.equal(gitBlobId(bytes), vector.blobSha1, 'source byte identity');
  assert.ok(vector.requires.includes('production-compiler'));
  assert.ok(vector.requires.includes('actual-native-executable'));
}
test('canonical .atto blobs remain identical to Java/LLVM contracts', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  assert.deepEqual(manifest.vectors.map(v=>v.file), [...pins.keys()]);
  for (const vector of manifest.vectors) {
    const source = await readFile(new URL(vector.file, base));
    assert.ok(source.length > 0 && source.length <= 65536);
    assertVector(manifest,vector,source);
    const text = source.toString('utf8');
    assert.match(text,/define inverted struct Row as/);
    assert.match(text,/rows\.erase_swap\(0\)/);
    assert.match(text,/return rows\.get\(1, value\)/);
  }
  assert.deepEqual(manifest.vectors.map(v=>v.expected.kind), ['native-exit','native-signal']);
  assert.equal(manifest.vectors[0].expected.code,42);
  assert.deepEqual(manifest.vectors[1].expected.allowed,['SIGILL','SIGTRAP']);
});

test('source-free manifest cannot declare five-backend guest parity', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  assert.deepEqual(Object.keys(manifest.backendEvidence).sort(),['forge','java','llvm','net','wasm']);
  assert.deepEqual(Object.values(manifest.backendEvidence),Array(5).fill('NOT_EXECUTED'));
  assert.equal(manifest.language,'AttoLang');
  assert.equal(manifest.sourceExtension,'.atto');
  assert.equal(manifest.dataSemantics,'dense-index-not-generational-row-handle');
  assert.equal(manifest.explicitLayout,'one-level-inverted-struct');
  assert.equal(manifest.fields.length,2);
});

test('mutated fixtures and fabricated source IDs reject instead of qualifying', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  const vector=manifest.vectors[0];
  const source=await readFile(new URL(vector.file,base));
  const mutated=Buffer.from(source);
  mutated[mutated.length-2] ^= 1;
  assert.notEqual(gitBlobId(mutated), vector.blobSha1);
  assert.throws(()=>assertVector(manifest,vector,mutated),assert.AssertionError);
  assert.throws(()=>assertVector(manifest,{...vector,blobSha1:'0'.repeat(40)},source),assert.AssertionError);
  assert.throws(()=>assertVector({...manifest,scope:'BACKEND_PASSED'},vector,source),assert.AssertionError);
});
