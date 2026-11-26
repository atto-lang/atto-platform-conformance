import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Explicit candidate-only gate; no downloads or implicit skips.
const PIN='1d3e23affb2853f545912585fcb4f046592d4e25';
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const MAX=(1n<<64n)-1n,M=0xffffffffn;
const pairs=[[0n,MAX],[MAX,0n],[MAX,1n],[1n,MAX],[MAX,2n],[M,M],
  [M+1n,M+1n],[M+1n,M],[M,M+1n],[M+2n,M],[M,M+2n],
  [0x100000001n,M],[0x100000002n,M],[1n<<63n,1n],[1n<<63n,2n],
  [0x100000001n,0xfffffffen],[0xffffffffffffn,65536n],[0x1000000000000n,65536n],
  [0x100000001n,0x100000001n],[3n,7n]];
const source=(a,b)=>`pub fnc main():u64{return product(${a},${b});} fnc product(u64 a,u64 b):u64{return a*b;}`;
const clang=process.env.CLANG??'clang',cxx=process.env.CLANGXX??'clang++';
const targets=['i386-linux-gnu','armv7-none-eabi','thumbv7m-none-eabi','aarch64-linux-gnu','riscv32-unknown-elf','riscv64-unknown-elf'];
test('exact candidate target matrix',{timeout:240000},async t=>{
  const path=process.env.ATTO_U64_LLVM_SOURCE;assert.ok(path,'ATTO_U64_LLVM_SOURCE required');
  const bytes=readFileSync(resolve(path));assert.equal(blob(bytes),PIN);
  const root=mkdtempSync(join(tmpdir(),'atto-u64-targets-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const run=(cmd,args,input)=>spawnSync(cmd,args,{cwd:root,input,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const ok=r=>{assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout;};
  const put=(name,data)=>writeFileSync(join(root,name),data);
  put('frontend.cpp',bytes);
  put('observer.c','#include <stdint.h>\n#include <inttypes.h>\n#include <stdio.h>\nextern uint64_t atto_guest_main(void);\nint main(void){printf("%" PRIu64 "\\n",atto_guest_main());return 0;}\n');
  ok(run(cxx,['-std=c++20','-O2','-Wall','-Wextra','-Werror','frontend.cpp','-o','frontend']));
  const lower=(s,mode='llvm')=>ok(run(join(root,'frontend'),['--emit='+mode],s));
  const flags=['-Wno-override-module'];
  for(const opt of ['-O0','-O2'])await t.test('native LLVM, Forge UBSan and Wasm '+opt,async()=>{
    for(const [a,b] of pairs){
      const p=a*b;put('guest.ll',lower(source(a,b)));
      ok(run(clang,[...flags,opt,'guest.ll','observer.c','-o','guest']));
      const r=run(join(root,'guest'),[]);assert.ifError(r.error);
      if(p>MAX){assert.equal(r.stdout,'');assert.ok(['SIGILL','SIGTRAP'].includes(r.signal));}
      else assert.equal(ok(r),p+'\n');
      put('guest.cpp',lower(source(a,b),'cpp'));
      ok(run(cxx,['-std=c++20',opt,'-Wall','-Wextra','-Werror','-fsanitize=undefined','-fno-sanitize-recover=all','guest.cpp','-o','forge']));
      const f=run(join(root,'forge'),[]);assert.ifError(f.error);
      if(p>MAX){assert.equal(f.signal,null);assert.equal(f.status,70);assert.equal(f.stdout,'');assert.equal(f.stderr,'E_U64_OVERFLOW\n');}
      else {assert.equal(ok(f),p+'\n');assert.equal(f.stderr,'');}
      ok(run(clang,['--target=wasm32-unknown-unknown',...flags,opt,'-nostdlib','-Wl,--no-entry','-Wl,--export=atto_guest_main','guest.ll','-o','guest.wasm']));
      const {instance}=await WebAssembly.instantiate(readFileSync(join(root,'guest.wasm')));
      const main=instance.exports.atto_guest_main;
      if(p>MAX)assert.throws(()=>main(),WebAssembly.RuntimeError);
      else assert.equal(BigInt.asUintN(64,main()),p);
    }
  });
  // Expose the emitted helper ONLY for testing dynamic inputs; not the guest ABI.
  const helper=lower(source(1n,1n)).replace('define internal i64 @checked_mul(', 'define i64 @checked_mul(');
  assert.match(helper,/define i64 @checked_mul\(/);put('helper.ll',helper);
  for(const opt of ['-O0','-O2'])await t.test('Wasm dynamic multiply helper '+opt,async()=>{
    ok(run(clang,['--target=wasm32-unknown-unknown',...flags,opt,'-nostdlib','-Wl,--no-entry','-Wl,--export=checked_mul','helper.ll','-o','helper.wasm']));
    const {instance}=await WebAssembly.instantiate(readFileSync(join(root,'helper.wasm')));const mul=instance.exports.checked_mul;
    let state=0x9e3779b97f4a7c15n,values=0,faults=0;
    const next=()=>{state^=(state<<13n)&MAX;state^=state>>7n;state^=(state<<17n)&MAX;return state;};
    const check=(a,b)=>{const p=a*b;if(p>MAX){faults++;assert.throws(()=>mul(a,b),WebAssembly.RuntimeError);}else{values++;assert.equal(BigInt.asUintN(64,mul(a,b)),p);}};
    for(const [a,b] of pairs)check(a,b);
    for(let i=0;i<10000;i++){
      const x=next(),y=next();switch(i%4){case 0:check(x,y);break;case 1:check(x&M,y&M);break;case 2:check(x,y&15n);break;default:check(x&15n,y);}
    }
    assert.equal(values+faults,10020);assert.ok(values>2500&&faults>2500);
  });
  await t.test('cross-target object generation (NOT execution)',()=>{
    for(const target of targets)for(const opt of ['-O0','-O2']){
      ok(run(clang,['--target='+target,...flags,opt,'-ffreestanding','-c','helper.ll','-o','target.o']));
      const syms=ok(run('readelf',['-Ws','target.o']));
      for(const line of syms.split('\n').filter(l=>/\bUND\b/.test(l))){
        const name=line.trim().split(/\s+/).at(-1);
        assert.ok(['UND','_GLOBAL_OFFSET_TABLE_','__aeabi_unwind_cpp_pr0'].includes(name),target+' '+opt+' unexpected undefined symbol '+name);
      }
      const hdr=ok(run('readelf',['-h','target.o']));
      assert.match(hdr,target.startsWith('aarch64')||target.startsWith('riscv64')?/Class:\s+ELF64/:/Class:\s+ELF32/);
    }
  });
  assert.equal(blob(readFileSync(resolve(path))),PIN);
});
