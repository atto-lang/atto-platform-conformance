/**
 * Source-only AOT V2 reference admission. NOT a native loader, not proof of guest execution.
 * Keep ABI parsing/compiler receipt enforcement in each backend. No trust-on-first-use keys.
 */
import {createHash, createPublicKey, verify as verifySignature, timingSafeEqual} from 'node:crypto';

const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const VERSION = 'atto.aot-artifact.v2';
const SIGNATURE_VERSION = 'atto.aot-artifact-signature.v2';
const OS = new Set(['linux', 'windows', 'macos', 'wasi']);
const ARCH = new Set(['x86_64', 'aarch64', 'wasm32']);
const ABI = {linux: new Set(['gnu', 'musl']), windows: new Set(['msvc']), macos: new Set(['darwin']), wasi: new Set(['wasi'])};
const BACKENDS = new Set(['java-graalvm', 'llvm', 'wasm-wasmtime', 'dotnet-nativeaot']);
const FORMATS = new Set(['elf', 'pe', 'macho', 'wasm', 'wasmtime-serialized']);
const KINDS = new Set(['native-executable', 'portable-wasm', 'precompiled-wasmtime', 'native-wasm-host']);
const TARGETS = Object.freeze({
  'x86_64-unknown-linux-gnu': ['linux','x86_64','gnu'],
  'aarch64-unknown-linux-gnu': ['linux','aarch64','gnu'],
  'x86_64-unknown-linux-musl': ['linux','x86_64','musl'],
  'aarch64-unknown-linux-musl': ['linux','aarch64','musl'],
  'x86_64-pc-windows-msvc': ['windows','x86_64','msvc'],
  'aarch64-pc-windows-msvc': ['windows','aarch64','msvc'],
  'x86_64-apple-darwin': ['macos','x86_64','darwin'],
  'aarch64-apple-darwin': ['macos','aarch64','darwin'],
  'wasm32-wasi': ['wasi','wasm32','wasi']
});
export const AOT_V2_TARGET_TRIPLES = Object.freeze(Object.keys(TARGETS));
function fail(message) { throw new Error('AOT_V2_REJECTED: ' + message); }
function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(label + ' must be a plain object');
  const actual = Object.keys(value).sort();
  if (actual.join('\0') !== keys.slice().sort().join('\0')) fail(label + ' has unknown/missing fields');
}
function str(v, re, label) { if(typeof v !== 'string' || !re.test(v)) fail('invalid ' + label); }
function isSafeUnicode(s) {
  for(let i=0;i<s.length;i++) {
    const c=s.charCodeAt(i);
    if(c>=0xd800 && c<=0xdbff) { if(++i>=s.length || s.charCodeAt(i)<0xdc00 || s.charCodeAt(i)>0xdfff) return false; }
    else if(c>=0xdc00 && c<=0xdfff) return false;
  }
  return true;
}
/** Bounded strict JSON parser; unlike JSON.parse it rejects decoded duplicate keys. */
export function parseStrictJson(bytes) {
  if(!(bytes instanceof Uint8Array) || bytes.byteLength===0 || bytes.byteLength>65536) fail('JSON input is absent or over 64KiB');
  let s; try{s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('invalid UTF-8');}
  // UTF-8 BOM is forbidden (ignoreBOM:true retains it for subsequent rejection).
  let p=0; const space=()=>{while(p<s.length && /[\t\n\r ]/.test(s[p]))p++;};
  const string=()=>{
    const start=p++;
    let done=false;
    while(p<s.length){
      const c=s[p++];
      if(c==='"'){done=true;break;}
      if(c==='\\'){
        if(p>=s.length)fail('truncated JSON escape');
        const e=s[p++];
        if(e==='u'){
          if(!/^[0-9a-fA-F]{4}$/.test(s.slice(p,p+4)))fail('bad Unicode escape');
          p+=4;
        } else if(!'"\\/bfnrt'.includes(e))fail('bad JSON escape');
      } else if(c.charCodeAt(0)<32)fail('unescaped control character');
    }
    if(!done)fail('unterminated string');
    let value;try{value=JSON.parse(s.slice(start,p));}catch{fail('malformed JSON string');}
    if(!isSafeUnicode(value))fail('unpaired Unicode surrogate');
    return value;
  };
  const value=(depth)=>{
    if(depth>64)fail('JSON depth exceeded');
    space();const c=s[p];
    if(c==='"')return string();
    if(c==='{'){
      p++;const out=Object.create(null);const seen=new Set();space();
      if(s[p]==='}') {p++;return Object.fromEntries(Object.entries(out));}
      while(true){
        space();if(s[p]!=='"')fail('object key expected');
        const k=string();if(seen.has(k))fail('duplicate decoded JSON key');seen.add(k);
        space();if(s[p++]!==':')fail('missing colon');
        const v=value(depth+1);Object.defineProperty(out,k,{value:v,enumerable:true,configurable:true,writable:true});
        space();if(s[p]==='}') {p++;break;}
        if(s[p++]!==',')fail('missing comma');
      }
      return Object.fromEntries(Object.entries(out));
    }
    if(c==='['){
      p++;const out=[];space();if(s[p]===']'){p++;return out;}
      while(true){out.push(value(depth+1));space();if(s[p]===']'){p++;break;}if(s[p++]!==',')fail('missing array comma');}
      return out;
    }
    for(const [literal,result] of [['true',true],['false',false],['null',null]]){
      if(s.startsWith(literal,p)){p+=literal.length;return result;}
    }
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(s.slice(p));
    if(match){p+=match[0].length;const n=Number(match[0]);if(!Number.isFinite(n)||Object.is(n,-0))fail('nonfinite or negative-zero number');return n;}
    fail('invalid JSON token');
  };
  const out=value(0);space();if(p!==s.length)fail('trailing JSON');return out;
}
export function canonicalizeJcs(value) {
  if(value===null)return 'null';
  if(typeof value==='string') {if(!isSafeUnicode(value))fail('unsafe Unicode');return JSON.stringify(value);}
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='number') {if(!Number.isFinite(value)||Object.is(value,-0))fail('unsafe number');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(canonicalizeJcs).join(',')+']';
  if(value && typeof value==='object' && Object.getPrototypeOf(value)===Object.prototype) {
    return '{'+Object.keys(value).sort().map(k=>canonicalizeJcs(k)+':'+canonicalizeJcs(value[k])).join(',')+'}';
  }
  fail('unsupported canonical JSON value');
}
function validateManifest(m) {
  exact(m,['schema_version','compiler','source','artifact','runtime','provenance'],'manifest');
  if(m.schema_version!==VERSION)fail('wrong manifest version');
  exact(m.compiler,['backend','version','git_commit','mode'],'compiler');
  if(!BACKENDS.has(m.compiler.backend))fail('unrecognized compiler');
  str(m.compiler.version,/^[\w.+-]{1,100}$/,'compiler.version');str(m.compiler.git_commit,COMMIT,'compiler.git_commit');
  if(!['per-guest-aot','portable-wasm','wasmtime-precompiled'].includes(m.compiler.mode))fail('invalid compiler mode');
  exact(m.source,['sha256','expanded_sha256','ast_sha256'],'source');
  for(const key of ['sha256','expanded_sha256','ast_sha256'])str(m.source[key],SHA,'source.'+key);
  exact(m.artifact,['sha256','size_bytes','kind','format','os','arch','abi','target_triple'],'artifact');
  str(m.artifact.sha256,SHA,'artifact.sha256');
  if(!Number.isSafeInteger(m.artifact.size_bytes)||m.artifact.size_bytes<1)fail('invalid artifact size');
  if(!KINDS.has(m.artifact.kind)||!FORMATS.has(m.artifact.format)||!OS.has(m.artifact.os)||!ARCH.has(m.artifact.arch)||!ABI[m.artifact.os]?.has(m.artifact.abi))fail('invalid target/format');
  str(m.artifact.target_triple,/^[a-zA-Z0-9._+-]{3,120}$/,'target triple');
  const {kind,format,os,arch,abi,target_triple:triple}=m.artifact;
  if(os==='wasi' ? arch!=='wasm32' : arch==='wasm32')fail('target architecture mismatch');
  const target=Object.hasOwn(TARGETS,triple)?TARGETS[triple]:null;
  if(!target||target[0]!==os||target[1]!==arch||target[2]!==abi)fail('target triple OS/architecture/ABI mismatch');
  if(os!=='wasi' && format!==({linux:'elf',windows:'pe',macos:'macho'}[os]) && kind!=='precompiled-wasmtime')fail('native format/OS mismatch');
  if(kind==='native-executable' && (!['java-graalvm','llvm','dotnet-nativeaot'].includes(m.compiler.backend)||m.compiler.mode!=='per-guest-aot'||os==='wasi'))fail('native executable backend/mode mismatch');
  if(kind==='native-wasm-host' && (m.compiler.backend!=='wasm-wasmtime'||m.compiler.mode!=='per-guest-aot'||os==='wasi'))fail('native Wasm host mismatch');
  if(kind==='portable-wasm' && (m.compiler.backend!=='wasm-wasmtime'||m.compiler.mode!=='portable-wasm'||format!=='wasm'||os!=='wasi'||arch!=='wasm32'))fail('portable Wasm product mismatch');
  if(kind==='precompiled-wasmtime' && (m.compiler.backend!=='wasm-wasmtime'||m.compiler.mode!=='wasmtime-precompiled'||format!=='wasmtime-serialized'||os==='wasi'))fail('precompiled Wasmtime mismatch');
  if(['native-executable','native-wasm-host'].includes(kind)&&format!==({linux:'elf',windows:'pe',macos:'macho'}[os]))fail('native executable format mismatch');
  exact(m.runtime,['guest_jit','interpreter_fallback','runtime_guest_compilation'],'runtime');
  if(m.runtime.guest_jit!==false||m.runtime.interpreter_fallback!==false||m.runtime.runtime_guest_compilation!==false)fail('AOT runtime policy not strict');
  exact(m.provenance,['builder_id'],'provenance');str(m.provenance.builder_id,NAME,'builder id');
}
function validateSignature(sig) {
  exact(sig,['schema_version','manifest_sha256','algorithm','key_id','signature_base64'],'signature envelope');
  if(sig.schema_version!==SIGNATURE_VERSION || sig.algorithm!=='ed25519')fail('unsupported signature envelope');
  str(sig.manifest_sha256,SHA,'manifest SHA');str(sig.key_id,NAME,'trust key id');
  if(typeof sig.signature_base64!=='string'||! /^[A-Za-z0-9+/]{85}[AQgw]==$/.test(sig.signature_base64))fail('invalid detached signature');
}
function sameHex(a,b){const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');return x.length===y.length&&timingSafeEqual(x,y);}
function inspectHeader(bytes,format,arch){
  if(format==='elf'){
    if(bytes.length<20||bytes[0]!==127||bytes.toString('ascii',1,4)!=='ELF'||bytes[4]!==2||bytes[5]!==1||bytes.readUInt16LE(18)!==({x86_64:62,aarch64:183}[arch]))fail('wrong ELF header/class/architecture');
  }else if(format==='pe'){
    if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')fail('missing PE header');
    const off=bytes.readUInt32LE(0x3c);
    if(off>bytes.length-6||bytes.toString('ascii',off,off+4)!=='PE\0\0'||bytes.readUInt16LE(off+4)!==({x86_64:0x8664,aarch64:0xaa64}[arch]))fail('wrong PE architecture');
  }else if(format==='macho'){
    if(bytes.length<12||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==({x86_64:0x01000007,aarch64:0x0100000c}[arch]))fail('wrong Mach-O architecture');
  }else if(format==='wasm'){
    if(bytes.length<8||bytes.toString('hex',0,8)!=='0061736d01000000')fail('wrong Wasm header');
  }
  // Wasmtime serialized modules require a version-matched, platform-specific loader.
  // No stable magic here is sufficient to attest a Wasmtime AOT artifact.
}
/** Returns authentication only, NEVER executed guest or release-parity evidence. */
export function verifyAotArtifactV2({manifestBytes, signatureBytes, artifactBytes, trustAnchors}){
  const m=parseStrictJson(manifestBytes),sig=parseStrictJson(signatureBytes);validateManifest(m);validateSignature(sig);
  if(!trustAnchors||Object.getPrototypeOf(trustAnchors)!==Object.prototype||!Object.hasOwn(trustAnchors,sig.key_id))fail('untrusted key ID');
  const canonical=Buffer.from(canonicalizeJcs(m),'utf8');
  if(!sameHex(createHash('sha256').update(canonical).digest('hex'),sig.manifest_sha256))fail('manifest digest mismatch');
  const raw=Buffer.from(sig.signature_base64,'base64');if(raw.length!==64||raw.toString('base64')!==sig.signature_base64)fail('signature encoding mismatch');
  let verified=false;
  try{verified=verifySignature(null,canonical,createPublicKey(trustAnchors[sig.key_id]),raw);}catch{fail('signature trust-anchor validation failed');}
  if(!verified)fail('detached signature invalid');
  if(!(artifactBytes instanceof Uint8Array)||artifactBytes.length!==m.artifact.size_bytes)fail('artifact size mismatch');
  const binary=Buffer.from(artifactBytes);
  if(!sameHex(createHash('sha256').update(binary).digest('hex'),m.artifact.sha256))fail('artifact hash mismatch');
  inspectHeader(binary,m.artifact.format,m.artifact.arch);
  return Object.freeze({classification:'AUTHENTICATED_NOT_EXECUTED',backend:m.compiler.backend,product_kind:m.artifact.kind,target_triple:m.artifact.target_triple,artifact_sha256:m.artifact.sha256,manifest_sha256:sig.manifest_sha256,loader_verified:false,guest_executed:false,release_ready:false});
}
