import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalizeJcs,verifyAotArtifactV2} from '../lib/aot-artifact-v2.mjs';
const fixture=JSON.parse(readFileSync(new URL('../contracts/v2/aot-artifact/detached-golden-vector.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=Buffer.from(fixture.artifact_hex,'hex');
const trustAnchors={[fixture.signature.key_id]:fixture.public_key_pem};
const run=(manifest=fixture.manifest,sig=fixture.signature,artifact=bytes,keys=trustAnchors)=>verifyAotArtifactV2({manifestBytes:Buffer.from(JSON.stringify(manifest)),signatureBytes:Buffer.from(JSON.stringify(sig)),artifactBytes:artifact,trustAnchors:keys});

test('pinned vector has real external Ed25519 detached signature over fixed canonical bytes',()=>{
  assert.equal(fixture.evidence_tier,'SYNTHETIC_NOT_GUEST_EXECUTED');
  assert.equal(bytes.toString('hex'),fixture.artifact_hex);
  assert.equal(bytes.byteLength,128);
  assert.equal(hash(bytes),fixture.manifest.artifact.sha256);
  const payload=Buffer.from(canonicalizeJcs(fixture.manifest),'utf8');
  assert.equal(hash(payload),fixture.canonical_manifest_sha256);
  assert.equal(fixture.signature.manifest_sha256,fixture.canonical_manifest_sha256);
  const publicKey=createPublicKey(fixture.public_key_pem);
  assert.equal(publicKey.asymmetricKeyType,'ed25519');
  assert.ok(verify(null,payload,publicKey,Buffer.from(fixture.signature.signature_base64,'base64')));
});
test('cross-language signed fixture can be admitted, never promoted to executed guest',()=>{
  const result=run();assert.equal(result.classification,'AUTHENTICATED_NOT_EXECUTED');
  assert.equal(result.loader_verified,false);assert.equal(result.guest_executed,false);
  assert.equal(result.release_ready,false);
});
test('fixed golden vector rejects modified build identity, artifact or signing-key lookup',()=>{
  const m=structuredClone(fixture.manifest);m.provenance.builder_id='adversary';
  assert.throws(()=>run(m),/AOT_V2_REJECTED/);
  const modified=Buffer.from(bytes);modified[40]^=1;
  assert.throws(()=>run(fixture.manifest,fixture.signature,modified),/AOT_V2_REJECTED/);
  assert.throws(()=>run(fixture.manifest,fixture.signature,bytes,{}),/AOT_V2_REJECTED/);
});
