// Native counterparts to durable-counter-compiler-parity.mjs.
// Caller-composed replay only: no persistence or mailbox guarantee.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const [backend,compilerPath]=process.argv.slice(2);
assert.ok(['forge','cranelift','llvm','net','java','llvm-wasm'].includes(backend)&&compilerPath&&process.argv.length===4,
  'usage: node tests/durable-counter-native-replay.mjs forge|cranelift|llvm|net|java|llvm-wasm /path/to/compiler (Java: absolute classpath)');
const compiler=backend==='java'?compilerPath:resolve(compilerPath);
const fixture=fileURLToPath(new URL('../fixtures/actors/persistence/durable_counter_broker_v1.atto',import.meta.url));
const source=readFileSync(fixture);
const dir=mkdtempSync(join(tmpdir(),'atto-native-replay-'));
const limit=1000000000n,min=-(1n<<63n),max=(1n<<63n)-1n;
const vectors=[],expected=[];
const oracle=(s,op,d)=>{
  if(s<0n||s>limit)return -1n;
  if(op===2n)return d===0n?s:-1n;
  if(op!==1n||d<=0n||d>limit||d>limit-s)return -1n;
  return s+d;
};
function add(s,o,d){
  vectors.push([s,o,d]);
  const result=oracle(s,o,d);expected.push(result);
  return result;
}
let state=0n;
for(let i=0;i<100;i++)state=add(state,1n,1n);
assert.equal(state,100n);
for(const s of [-1n,0n,100n,999999999n,limit,limit+1n])
  for(const o of [0n,1n,2n,3n])
    for(const d of [-1n,0n,1n,42n,limit,limit+1n])add(s,o,d);
assert.equal(vectors.length,244);
for(const v of [[min,1n,1n],[max,1n,1n],[0n,min,0n],[0n,max,0n],
  [0n,1n,min],[0n,1n,max],[limit,1n,max],[0n,2n,min],[0n,2n,max],
  [999999999n,1n,1n],[limit,2n,0n],[limit,1n,1n]])add(...v);
assert.equal(vectors.length,256);
const replayStats={accepted:0,rejected:0,reads:0};
const terminal=[];
for(const initial of [0n,1n,999999999n,limit]){
  let s=initial,seed=0x12345678n^initial;
  for(let i=0;i<128;i++){
    seed=(1664525n*seed+1013904223n)&0xffffffffn;
    const room=limit-s;
    const [op,delta]=[[1n,room>0n?1n+seed%room:1n],[1n,0n],[1n,-1n],
      [1n,room+1n],[2n,0n],[2n,1n],[3n,0n],[1n,max]][i%8];
    const result=add(s,op,delta);
    if(result!==-1n){s=result;replayStats.accepted++;}
    else replayStats.rejected++;
    assert.equal(add(s,2n,0n),s);replayStats.reads++;
  }
  terminal.push(s.toString());
}
assert.deepEqual(replayStats,{accepted:95,rejected:417,reads:512});
assert.deepEqual(terminal,['1000000000','999999979','1000000000','1000000000']);
assert.equal(vectors.length,1280);

// Fixed schema golden independently pinned by the existing shared contract.
const descriptorHex='0107436f756e74657205636f756e7401244154544f53543031013782cc560597ec4601000100000000000000002b35b70ef92e387a';
const hash=b=>createHash('sha256').update(b).digest('hex');
const run=(bin,args,input)=>{
  const r=spawnSync(bin,args,{cwd:dir,input,timeout:120000,maxBuffer:8<<20});
  assert.equal(r.error,undefined,String(r.error));
  assert.equal(r.status,0,r.stderr?.toString());
  assert.equal(r.stderr.length,0,r.stderr.toString());
  return r.stdout;
};
const inputVectors=vectors.map(v=>v.join(' ')).join('\n')+'\n';
function verifyOutput(bytes,profile){
  const lines=bytes.toString().split('\n');assert.equal(lines.pop(),'');
  assert.equal(lines.shift(),descriptorHex,profile+' descriptor');
  assert.equal(lines.length,expected.length,profile+' result count');
  for(let i=0;i<expected.length;i++)assert.equal(lines[i],expected[i].toString(),`${profile} vector ${i}: ${vectors[i].join(' ')}`);
}
const driver=`#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <iostream>
#ifdef FORGE
extern "C" std::int64_t atto_durable_transition_v1(std::int64_t,std::int64_t,std::int64_t) noexcept;
extern "C" const unsigned char* atto_durable_state_v1(std::size_t*) noexcept;
#else
extern "C" std::int64_t atto_durable_transition_v1(std::int64_t,std::int64_t,std::int64_t);
#ifdef LLVM
extern "C" std::uint64_t atto_durable_state_size_v1();
extern "C" const unsigned char* atto_durable_state_v1();
#else
extern "C" const unsigned char atto_durable_descriptor_v1[53];
#endif
#endif
int main(){
  std::size_t n=53;
#ifdef FORGE
  const auto* p=atto_durable_state_v1(&n);
  if(!p||n!=53)return 2;
#elif defined(LLVM)
  const auto* p=atto_durable_state_v1();
  n=atto_durable_state_size_v1();
  if(!p||n!=53)return 2;
#else
  const auto* p=atto_durable_descriptor_v1;
#endif
  for(std::size_t i=0;i<n;i++)std::printf("%02x",static_cast<unsigned>(p[i]));
  std::puts("");
  std::int64_t s,o,d;
  while(std::cin>>s>>o>>d)std::cout<<atto_durable_transition_v1(s,o,d)<<'\\n';
  return std::cin.eof()?0:3;
}
`;
try{
  const input=join(dir,'counter.atto'),driverFile=join(dir,'driver.cpp');
  let guest=join(dir,'guest');
  writeFileSync(input,source);writeFileSync(driverFile,driver);
  let artifact;
  if(backend==='forge'){
    artifact=join(dir,'counter.cpp');
    run(compiler,['--durable-counter-actor-v1',input,'-o',artifact]);
  }else if(backend==='java'){
    artifact=join(dir,'AttoDurableCounterV1.java');
    run('java',['-cp',compiler,'dev.oreslang.launcher.OresMain','--durable-counter-actor-v1',input,'-o',artifact]);
  }else if(backend==='net'){
    artifact=join(dir,'Counter.g.cs');
    run(compiler,['emit-durable-counter-v1',input,'--out',artifact]);
  }else if(backend==='llvm'||backend==='llvm-wasm'){
    artifact=join(dir,'counter.ll');
    writeFileSync(artifact,run(compiler,['--durable-counter-actor-v1',input]));
  }else{
    artifact=join(dir,'counter.o');
    const bytes=run(compiler,['emit-durable-counter-object',input]);
    assert.deepEqual(bytes.subarray(0,4),Buffer.from([127,69,76,70]));
    writeFileSync(artifact,bytes);
  }
  const bytes=readFileSync(artifact);assert.ok(bytes.length>0);
  if(backend==='llvm-wasm'){
    const wasmPath=join(dir,'counter.wasm');
    run(process.env.CLANG||'clang',['--target=wasm32-unknown-unknown',
      '-Wno-override-module','-nostdlib','-O2','-Wl,--no-entry',
      '-Wl,--export=atto_durable_transition_v1','-Wl,--export=atto_durable_state_size_v1',
      '-Wl,--export=atto_durable_state_v1','-Wl,--export-memory',
      '-Wl,--initial-memory=131072','-Wl,--max-memory=131072',artifact,'-o',wasmPath]);
    const wasm=readFileSync(wasmPath);assert.ok(wasm.length<=1024*1024);
    const module=new WebAssembly.Module(wasm);
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    assert.deepEqual(WebAssembly.Module.exports(module).map(x=>x.name).sort(),
      ['atto_durable_state_size_v1','atto_durable_state_v1','atto_durable_transition_v1','memory']);
    const e=new WebAssembly.Instance(module,{}).exports;
    assert.equal(e.memory.buffer.byteLength,131072);
    assert.throws(()=>e.memory.grow(1),RangeError);
    function descriptor(){
      const size=e.atto_durable_state_size_v1(),ptr=e.atto_durable_state_v1();
      assert.equal(size,53n);
      assert.ok(Number.isInteger(ptr)&&ptr>=0&&ptr+Number(size)<=e.memory.buffer.byteLength);
      return Buffer.from(new Uint8Array(e.memory.buffer,ptr,Number(size)));
    }
    const before=descriptor();
    assert.equal(before.toString('hex'),descriptorHex);
    for(let i=0;i<vectors.length;i++){
      assert.equal(e.atto_durable_transition_v1(...vectors[i]),expected[i],`llvm-wasm vector ${i}`);
      assert.deepEqual(descriptor(),before,`descriptor mutated at vector ${i}`);
    }
    console.log(JSON.stringify({status:'LLVM_WASM_RESTRICTED_COUNTER_REPLAY_PASS',
      backend,compilerFrontend:'llvm',totalCases:vectors.length,replayStats,terminal,
      fixtureSha256:hash(source),artifactSha256:hash(wasm),irSha256:hash(bytes),
      descriptorSha256:hash(before),imports:0,maxPages:2,strictNoJit:false,
      diskRecoveryExecuted:false,fullDurableActorParity:false}));
  }else if(backend==='java'){
    const javaDriver=join(dir,'Driver.java');
    writeFileSync(javaDriver,`public final class Driver {
      public static void main(String[] args) throws Exception {
        System.out.println(java.util.HexFormat.of().formatHex(AttoDurableCounterV1.descriptor()));
        var reader=new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
        for(String line;(line=reader.readLine())!=null;) {
          String[] p=line.split(" ");
          if(p.length!=3)throw new IllegalArgumentException("bad vector");
          System.out.println(AttoDurableCounterV1.transition(Long.parseLong(p[0]),Long.parseLong(p[1]),Long.parseLong(p[2])));
        }
      }
    }`);
    run('javac',['-d',dir,'-Xlint:all','-Werror',artifact,javaDriver]);
    verifyOutput(run('java',['-cp',dir,'Driver'],inputVectors),'java-jvm');
    // Native Image must be present and succeed; JVM-only cannot satisfy this gate.
    const ni=spawnSync('native-image',['--no-fallback','-cp',dir,'Driver',guest],
      {cwd:dir,encoding:'utf8',timeout:240000,maxBuffer:8<<20});
    assert.equal(ni.error,undefined,String(ni.error));
    assert.equal(ni.status,0,ni.stdout+'\n'+ni.stderr);
    assert.deepEqual(readFileSync(guest).subarray(0,4),Buffer.from([127,69,76,70]));
  }else if(backend==='net'){
    writeFileSync(join(dir,'Guest.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
      <TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType><AssemblyName>guest</AssemblyName>
      <PublishAot>true</PublishAot><SelfContained>true</SelfContained><InvariantGlobalization>true</InvariantGlobalization>
      <TreatWarningsAsErrors>true</TreatWarningsAsErrors><ImplicitUsings>enable</ImplicitUsings>
      <Nullable>enable</Nullable>
    </PropertyGroup></Project>`);
    writeFileSync(join(dir,'Program.cs'),`using System.Globalization;
Console.WriteLine(Convert.ToHexString(AttoDurableCounterV1.Descriptor()).ToLowerInvariant());
string? line;
while ((line=Console.ReadLine()) is not null) {
    var p=line.Split(' ');
    if(p.Length!=3)return 3;
    Console.WriteLine(AttoDurableCounterV1.Transition(long.Parse(p[0],CultureInfo.InvariantCulture),long.Parse(p[1],CultureInfo.InvariantCulture),long.Parse(p[2],CultureInfo.InvariantCulture)).ToString(CultureInfo.InvariantCulture));
}
return 0;
`);
    const published=spawnSync('dotnet',['publish','Guest.csproj','-c','Release','-r','linux-x64','-o','native','-warnaserror'],
      {cwd:dir,encoding:'utf8',timeout:240000,maxBuffer:8<<20});
    assert.equal(published.error,undefined,String(published.error));
    assert.equal(published.status,0,published.stdout+'\n'+published.stderr);
    guest=join(dir,'native','guest');
    assert.deepEqual(readFileSync(guest).subarray(0,4),Buffer.from([127,69,76,70]));
    assert.match(run('file',[guest]).toString(),/ELF/);
    assert.doesNotMatch(run('ldd',[guest]).toString(),/libcoreclr|libhostfxr/i);
  }else run(backend==='llvm'?(process.env.CLANGXX||'clang++'):(process.env.CXX||'c++'),['-std=c++20','-O2','-Wall','-Wextra','-Werror','-pedantic',
    '-fsanitize=undefined','-fno-sanitize-recover=all',
    ...(backend==='forge'?['-DFORGE']:backend==='llvm'?['-DLLVM','-Wno-override-module']:[]),driverFile,artifact,'-o',guest]);
  if(backend!=='llvm-wasm'){
  verifyOutput(run(guest,[],inputVectors),backend==='java'?'java-native-image':backend);
  console.log(JSON.stringify({status:'NATIVE_RESTRICTED_COUNTER_REPLAY_PASS',backend,
    originalCases:244,extendedSignedI64Cases:12,replayStats,terminal,
    totalCases:vectors.length,executedProfiles:backend==='java'?['java-jvm','java-native-image']:[backend],fixtureSha256:hash(source),artifactSha256:hash(bytes),
    descriptorSha256:hash(Buffer.from(descriptorHex,'hex')),diskRecoveryExecuted:false,fullDurableActorParity:false}));
  }
}finally{rmSync(dir,{recursive:true,force:true});}
