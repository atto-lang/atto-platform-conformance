import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AOT_V2_TARGET_TRIPLES} from '../lib/aot-artifact-v2.mjs';
const root=new URL('../contracts/v2/aot-artifact/',import.meta.url);
const file=name=>readFileSync(new URL(name,root),'utf8');
const manifest=JSON.parse(file('manifest.schema.json'));
const detached=JSON.parse(file('signature.schema.json'));
const typespec=file('main.tsp');
const field=(m,...keys)=>keys.reduce((a,k)=>a[k],m);

test('closed target/compiler vocabulary stays aligned',()=>{
  assert.deepEqual(field(manifest,'properties','artifact','properties','target_triple','enum'),AOT_V2_TARGET_TRIPLES);
  for(const target of AOT_V2_TARGET_TRIPLES)assert.ok(typespec.includes('"'+target+'"'),target+' missing in TypeSpec');
  assert.deepEqual(field(manifest,'properties','compiler','properties','backend','enum'),['java-graalvm','llvm','wasm-wasmtime','dotnet-nativeaot']);
  for(const name of ['java-graalvm','llvm','wasm-wasmtime','dotnet-nativeaot'])assert.ok(typespec.includes('"'+name+'"'));
  assert.equal(manifest.additionalProperties,false);
  assert.equal(field(manifest,'properties','artifact','additionalProperties'),false);
  assert.equal(field(manifest,'properties','runtime','properties','guest_jit','const'),false);
  assert.ok(manifest.allOf.length>=20);
});
test('detached signature and external key policy never enter signed payload',()=>{
  assert.equal(field(detached,'properties','algorithm','const'),'ed25519');
  assert.equal(detached.additionalProperties,false);
  assert.equal(detached.properties.signature_base64.pattern,'^[A-Za-z0-9+/]{85}[AQgw]==$');
  assert.deepEqual(Object.keys(manifest.properties.provenance.properties),['builder_id']);
  assert.equal(Object.hasOwn(manifest.properties,'signature'),false);
  assert.equal(Object.hasOwn(manifest.properties.provenance.properties,'signature'),false);
});
