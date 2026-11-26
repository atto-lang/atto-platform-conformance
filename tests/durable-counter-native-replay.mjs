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
assert.ok(['forge','cranelift','llvm'].includes(backend)&&compilerPath&&process.argv.length===4,
  'usage: node tests/durable-counter-native-replay.mjs forge|cranelift|llvm /path/to/compiler');
const compiler=resolve(compilerPath);
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
  const input=join(dir,'counter.atto'),driverFile=join(dir,'driver.cpp'),guest=join(dir,'guest');
  writeFileSync(input,source);writeFileSync(driverFile,driver);
  let artifact;
  if(backend==='forge'){
    artifact=join(dir,'counter.cpp');
    run(compiler,['--durable-counter-actor-v1',input,'-o',artifact]);
  }else if(backend==='llvm'){
    artifact=join(dir,'counter.ll');
    writeFileSync(artifact,run(compiler,['--durable-counter-actor-v1',input]));
  }else{
    artifact=join(dir,'counter.o');
    const bytes=run(compiler,['emit-durable-counter-object',input]);
    assert.deepEqual(bytes.subarray(0,4),Buffer.from([127,69,76,70]));
    writeFileSync(artifact,bytes);
  }
  const bytes=readFileSync(artifact);assert.ok(bytes.length>0);
  run(backend==='llvm'?(process.env.CLANGXX||'clang++'):(process.env.CXX||'c++'),['-std=c++20','-O2','-Wall','-Wextra','-Werror','-pedantic',
    '-fsanitize=undefined','-fno-sanitize-recover=all',
    ...(backend==='forge'?['-DFORGE']:backend==='llvm'?['-DLLVM','-Wno-override-module']:[]),driverFile,artifact,'-o',guest]);
  const result=run(guest,[],vectors.map(v=>v.join(' ')).join('\n')+'\n').toString();
  const lines=result.split('\n');assert.equal(lines.pop(),'');
  assert.equal(lines.shift(),descriptorHex);
  assert.equal(lines.length,expected.length);
  for(let i=0;i<expected.length;i++)assert.equal(lines[i],expected[i].toString(),`vector ${i}: ${vectors[i].join(' ')}`);
  console.log(JSON.stringify({status:'NATIVE_RESTRICTED_COUNTER_REPLAY_PASS',backend,
    originalCases:244,extendedSignedI64Cases:12,replayStats,terminal,
    totalCases:vectors.length,fixtureSha256:hash(source),artifactSha256:hash(bytes),
    descriptorSha256:hash(Buffer.from(descriptorHex,'hex')),diskRecoveryExecuted:false,fullDurableActorParity:false}));
}finally{rmSync(dir,{recursive:true,force:true});}
