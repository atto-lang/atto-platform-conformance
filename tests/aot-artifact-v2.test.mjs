import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {parseStrictJson,canonicalizeJcs,verifyAotArtifactV2} from '../lib/aot-artifact-v2.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const sha=x=>createHash('sha256').update(x).digest('hex');
const raw=x=>Buffer.from(JSON.stringify(x),'utf8');
const binary=Buffer.alloc(64);binary.set([127,69,76,70,2,1],0);binary.writeUInt16LE(62,18);
const good=()=>({
  schema_version:'atto.aot-artifact.v2',
  compiler:{backend:'llvm',version:'1.0.0',git_commit:'a'.repeat(40),mode:'per-guest-aot'},
  source:{sha256:'a'.repeat(64),expanded_sha256:'b'.repeat(64),ast_sha256:'c'.repeat(64)},
  artifact:{sha256:sha(binary),size_bytes:binary.length,kind:'native-executable',format:'elf',os:'linux',arch:'x86_64',abi:'gnu',target_triple:'x86_64-unknown-linux-gnu'},
  runtime:{guest_jit:false,interpreter_fallback:false,runtime_guest_compilation:false},
  provenance:{builder_id:'trusted-builder'}
});
const signEnvelope=m=>{
  const canonical=Buffer.from(canonicalizeJcs(m));
  return {schema_version:'atto.aot-artifact-signature.v2',manifest_sha256:sha(canonical),algorithm:'ed25519',key_id:'test-root',signature_base64:sign(null,canonical,privateKey).toString('base64')};
};
const run=(m=good(),s=signEnvelope(m),buf=binary,keys={'test-root':publicKey.export({type:'spki',format:'pem'})})=>
  verifyAotArtifactV2({manifestBytes:raw(m),signatureBytes:raw(s),artifactBytes:buf,trustAnchors:keys});
const rejected=fn=>assert.throws(fn,/AOT_V2_REJECTED/);

test('real detached Ed25519 trust anchor verifies bytes, never claims guest execution',()=>{
  const r=run();assert.equal(r.classification,'AUTHENTICATED_NOT_EXECUTED');
  assert.equal(r.guest_executed,false);assert.equal(r.release_ready,false);
});
test('canonical property order is stable and signature is detached',()=>{
  assert.equal(canonicalizeJcs({b:1,a:2}),'{"a":2,"b":1}');
  assert.deepEqual(parseStrictJson(raw({b:1,a:2})),{b:1,a:2});
});
test('unknown fields and all altered signed metadata fail closed',()=>{
  for(const mutate of [
    m=>m.extra='x',m=>m.compiler.backend='dotnet-nativeaot',m=>m.artifact.abi='msvc',
    m=>m.artifact.target_triple='aarch64-unknown-linux-gnu',m=>m.runtime.guest_jit=true,
    m=>m.artifact.format='pe',m=>m.artifact.size_bytes=0,
    m=>m.artifact.kind='native-wasm-host',m=>m.compiler.mode='portable-wasm',
    m=>m.provenance.signature='fake',m=>m.artifact.os='windows',
  ]) {const m=good();const sig=signEnvelope(m);mutate(m);rejected(()=>run(m,sig));}
});
test('correctly resigned but invalid backend, target and AOT combinations reject',()=>{
  for(const mutate of [
    m=>m.compiler.backend='unknown',m=>m.artifact.format='wasm',
    m=>m.runtime.interpreter_fallback=true,m=>m.runtime.runtime_guest_compilation=true,
    m=>m.compiler.mode='wasmtime-precompiled',m=>m.artifact.arch='aarch64',
    m=>m.artifact.size_bytes=2**53,
  ]) {const m=good();mutate(m);rejected(()=>run(m,signEnvelope(m)));}
});
test('tampered artifact and wrong native architecture reject',()=>{
  const bad=Buffer.from(binary);bad[40]=1;rejected(()=>run(good(),signEnvelope(good()),bad));
  const badArch=Buffer.from(binary);badArch.writeUInt16LE(183,18);
  const m=good();m.artifact.sha256=sha(badArch);rejected(()=>run(m,signEnvelope(m),badArch));
});
test('signature substitution, unknown trust anchors and signature mutation reject',()=>{
  const m=good(),sig=signEnvelope(m);rejected(()=>run(m,sig,binary,{}));
  rejected(()=>run(m,{...sig,key_id:'other'}));
  rejected(()=>run(m,{...sig,signature_base64:Buffer.alloc(64).toString('base64')}));
  rejected(()=>run(m,{...sig,manifest_sha256:'f'.repeat(64)}));
});
test('rejects duplicate decoded keys, lexical garbage, invalid UTF-8, unsafe Unicode and depth',()=>{
  for(const str of ['{"a":1,"\\u0061":2}','{"a":1,"a":2}','{"x":NaN}','{"x":01}','{"x":1e9999}','{"x":"\\uD800"}','{"x":1,}', '[1,]','{} trailing'])
    rejected(()=>parseStrictJson(Buffer.from(str)));
  rejected(()=>parseStrictJson(Buffer.from([0xc3,0x28])));
  rejected(()=>parseStrictJson(Buffer.from('['.repeat(65)+'0'+']'.repeat(65))));
  rejected(()=>parseStrictJson(Buffer.alloc(65537,65)));
});
test('does not promote Wasm packaging from authenticated bytes to guest-native proof',()=>{
  const m=good(); const wasm=Buffer.from('0061736d01000000','hex');
  m.compiler={backend:'wasm-wasmtime',version:'1.0.0',git_commit:'a'.repeat(40),mode:'portable-wasm'};
  m.artifact={sha256:sha(wasm),size_bytes:wasm.length,kind:'portable-wasm',format:'wasm',os:'wasi',arch:'wasm32',abi:'wasi',target_triple:'wasm32-wasi'};
  const r=run(m,signEnvelope(m),wasm);assert.equal(r.guest_executed,false);assert.equal(r.release_ready,false);
});

test('three native backends authenticate synthetic ELF headers without claiming guest execution',()=>{
  for(const backend of ['java-graalvm','llvm','dotnet-nativeaot']){
    const m=good();m.compiler.backend=backend;
    const result=run(m,signEnvelope(m));
    assert.equal(result.backend,backend);assert.equal(result.loader_verified,false);
  }
});
test('signed PE and Mach-O headers are arch/OS checked, not executable proof',()=>{
  const pe=Buffer.alloc(128);pe.write('MZ');pe.writeUInt32LE(64,0x3c);pe.write('PE\0\0',64,'binary');pe.writeUInt16LE(0x8664,68);
  const mac=Buffer.alloc(64);mac.writeUInt32LE(0xfeedfacf,0);mac.writeUInt32LE(0x0100000c,4);
  for(const [buf,os,arch,abi,triple,format] of [
    [pe,'windows','x86_64','msvc','x86_64-pc-windows-msvc','pe'],
    [mac,'macos','aarch64','darwin','aarch64-apple-darwin','macho']
  ]){
    const m=good();Object.assign(m.artifact,{sha256:sha(buf),size_bytes:buf.length,os,arch,abi,target_triple:triple,format});
    assert.equal(run(m,signEnvelope(m),buf).guest_executed,false);
    const forged=Buffer.from(buf);forged[4]=255;
    rejected(()=>run(m,signEnvelope(m),forged));
  }
});
test('raw parser denies BOM and malformed Unicode without normalization',()=>{
  rejected(()=>parseStrictJson(Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d])));
  rejected(()=>parseStrictJson(Buffer.from('{"x":"\\uDC00"}')));
  rejected(()=>parseStrictJson(Buffer.from('{"x":"\\uD800\\uD800"}')));
  assert.equal(parseStrictJson(Buffer.from('{"x":"\\uD83D\\uDE00"}')).x,'😀');
});
test('resigned adversarial target triple cannot smuggle another CPU or ABI',()=>{
  for(const triple of ['aarch64-x86_64-unknown-linux-gnu','x86_64-unknown-linux-musl-gnu','x86_64-unknown-windows-msvc-linux-gnu']){
    const m=good();m.artifact.target_triple=triple;rejected(()=>run(m,signEnvelope(m)));
  }
});

test('prototype-shaped extra JSON fields never disappear during decoding',()=>{
  const base=JSON.stringify(good());
  const injected=Buffer.from('{"__proto__":"hidden",'+base.slice(1));
  assert.equal(Object.hasOwn(parseStrictJson(injected),'__proto__'),true);
  const signature=raw(signEnvelope(good()));
  rejected(()=>verifyAotArtifactV2({manifestBytes:injected,signatureBytes:signature,artifactBytes:binary,trustAnchors:{'test-root':publicKey.export({type:'spki',format:'pem'})}}));
});


test('exact integer semantics reject binary64 rounding but accept integral decimal/exponent notation',()=>{
  // All values below would round to a valid integer through plain JSON.parse.
  for(const value of ['1.0000000000000001', '64.00000000000001', '64.000000000000001', '9007199254740991.0001']){
    const manifest=JSON.stringify(good()).replace('"size_bytes":64','"size_bytes":'+value);
    rejected(()=>parseStrictJson(Buffer.from(manifest)));
  }
  assert.equal(parseStrictJson(Buffer.from('{"n":1e0}')).n,1);
  assert.equal(parseStrictJson(Buffer.from('{"n":64.0}')).n,64);
  assert.equal(parseStrictJson(Buffer.from('{"n":6.4e1}')).n,64);
  rejected(()=>parseStrictJson(Buffer.from('{"n":9007199254740993}')));
  assert.equal(parseStrictJson(Buffer.from('{"n":9007199254740991}')).n,9007199254740991);
});
test('field-list validation rejects NUL-joined key substitutions',()=>{
  // The pre-hardening exact() used keys.join("\\0"), so an embedded NUL
  // could disguise a missing field and cause the wrong error or policy path.
  const m=good();delete m.source;
  m['schema_version\u0000source']='injected';
  rejected(()=>run(m,signEnvelope(m)));
  const m2=good();delete m2.source.sha256;
  m2.source['expanded_sha256\u0000sha256']='forged';
  rejected(()=>run(m2,signEnvelope(m2)));
});
test('canonicalizer follows RFC8785 negative zero and number semantics',()=>{
  assert.equal(canonicalizeJcs(-0),'0');
  assert.equal(canonicalizeJcs({z:1e30,a:0.0000001}),'{"a":1e-7,"z":1e+30}');
  // JCS normalizes -0 to 0; V2 typed admission rejects zero size.
  assert.equal(parseStrictJson(Buffer.from('{"size_bytes":-0}')).size_bytes,0);
  const m=good();m.artifact.size_bytes=0;rejected(()=>run(m,signEnvelope(m)));
});
test('host trust anchors are Ed25519 public keys only',()=>{
  const {publicKey:rsa}=generateKeyPairSync('rsa',{modulusLength:2048});
  const m=good();
  rejected(()=>run(m,signEnvelope(m),binary,{'test-root':rsa.export({type:'spki',format:'pem'})}));
});


test('mathematically integral exponent manifest authenticates against the same JCS signature',()=>{
  const m=good(),sig=signEnvelope(m);
  const rendered=JSON.stringify(m).replace('"size_bytes":64','"size_bytes":6.4e1');
  const result=verifyAotArtifactV2({manifestBytes:Buffer.from(rendered),signatureBytes:raw(sig),artifactBytes:binary,trustAnchors:{'test-root':publicKey.export({type:'spki',format:'pem'})}});
  assert.equal(result.classification,'AUTHENTICATED_NOT_EXECUTED');
  const rounded=JSON.stringify(m).replace('"size_bytes":64','"size_bytes":64.00000000000001');
  rejected(()=>verifyAotArtifactV2({manifestBytes:Buffer.from(rounded),signatureBytes:raw(sig),artifactBytes:binary,trustAnchors:{'test-root':publicKey.export({type:'spki',format:'pem'})}}));
});
test('JCS keys sort by unsigned UTF-16 code units and reject unpaired surrogate keys',()=>{
  assert.equal(canonicalizeJcs({'\uE000':2,'😀':1}),'{"😀":1,"":2}');
  rejected(()=>canonicalizeJcs({'\uD800':42}));
});
