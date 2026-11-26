import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const PIN='752d1ad3fb3564eed9067a0a530eb2150d1c14b4';
const mode=process.env.ATTO_U64_FORGE_TARGET_REQUIRED;
assert.ok(mode===undefined||mode==='0'||mode==='1','ATTO_U64_FORGE_TARGET_REQUIRED must be 0 or 1');
const path=process.env.ATTO_U64_FORGE_SOURCE;
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const MAX=(1n<<64n)-1n,M=0xffffffffn;
const clang=process.env.CLANGXX??'clang++',gcc=process.env.GXX??'g++';
const targets=['i386-linux-gnu','armv7-none-eabi','thumbv7m-none-eabi','aarch64-linux-gnu','riscv32-unknown-elf','riscv64-unknown-elf'];
test('exact Forge C++ target matrix',{timeout:120000,skip:!path&&mode!=='1'?'NOT_EXECUTED: exact Forge compiler source unavailable':false},async t=>{
  assert.ok(path,'ATTO_U64_FORGE_SOURCE required');const bytes=readFileSync(resolve(path));assert.equal(blob(bytes),PIN);
  const root=mkdtempSync(join(tmpdir(),'atto-forge-targets-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const run=(cmd,args,input)=>spawnSync(cmd,args,{cwd:root,input,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  const ok=r=>{assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout;};
  const put=(name,data)=>writeFileSync(join(root,name),data);
  put('compiler.cpp',bytes);ok(run(clang,['-std=c++20','-O2','-Wall','-Wextra','-Werror','compiler.cpp','-o','frontend']));
  const lower=(a,b)=>ok(run(join(root,'frontend'),['--emit=cpp'],`pub fnc main():u64{return product(${a},${b});} fnc product(u64 a,u64 b):u64{return a*b;}`));
  const generated=lower(M+2n,M);
  const fault='std::fputs("E_U64_OVERFLOW\\n", stderr); std::exit(70);',main='int main() {';
  assert.equal(generated.split(fault).length,2);assert.equal(generated.split(main).length,2);
  // Instrument only the fault observer for repeated calls, never the arithmetic.
  put('dynamic.cpp',generated.replace(fault,'throw 70;').replace(main,'int original_guest_main() {')+`
#include <iostream>
int main(){U a,b;while(std::cin>>a>>b){try{U value=checked_mul(a,b);std::cout<<value<<'\\n';}catch(int code){if(code!=70)return 71;std::cout<<"overflow\\n";}}return std::cin.eof()?0:72;}
`);
  const pairs=[[0n,MAX],[MAX,0n],[MAX,1n],[1n,MAX],[MAX,2n],[M,M],[M+1n,M+1n],[M+1n,M],[M,M+1n],[M+2n,M],[M,M+2n],[0x100000001n,M],[0x100000002n,M],[1n<<63n,1n],[1n<<63n,2n],[0x100000001n,0xfffffffen],[0xffffffffffffn,65536n],[0x1000000000000n,65536n],[0x100000001n,0x100000001n],[3n,7n]];
  let state=0x9e3779b97f4a7c15n;const next=()=>{state^=(state<<13n)&MAX;state^=state>>7n;state^=(state<<17n)&MAX;return state;};
  for(let i=0;i<10000;i++){const x=next(),y=next();pairs.push(i%4===0?[x,y]:i%4===1?[x&M,y&M]:i%4===2?[x,y&15n]:[x&15n,y]);}
  const expected=pairs.map(([a,b])=>a*b>MAX?'overflow':String(a*b));assert.ok(expected.filter(x=>x==='overflow').length>2500&&expected.filter(x=>x!=='overflow').length>2500);
  for(const host of [clang,gcc])for(const opt of ['-O0','-O2'])await t.test(host+' '+opt+' guest + dynamic UBSan',()=>{
    const flags=['-std=c++20',opt,'-Wall','-Wextra','-Werror','-fsanitize=undefined','-fno-sanitize-recover=all'];
    for(const [a,b] of [[M+1n,M],[M+2n,M]]){put('guest.cpp',lower(a,b));ok(run(host,[...flags,'guest.cpp','-o','guest']));const r=run(join(root,'guest'),[]);assert.ifError(r.error);assert.equal(r.signal,null);if(a*b>MAX){assert.equal(r.status,70);assert.equal(r.stdout,'');assert.equal(r.stderr,'E_U64_OVERFLOW\n');}else{assert.equal(ok(r),a*b+'\n');assert.equal(r.stderr,'');}}
    ok(run(host,[...flags,'dynamic.cpp','-o','dynamic']));const r=run(join(root,'dynamic'),[],pairs.map(([a,b])=>a+' '+b+'\n').join(''));assert.equal(ok(r),expected.join('\n')+'\n');assert.equal(r.stderr,'');
  });
  await t.test('freestanding C++ objects (shim headers, NOT execution)',()=>{
    mkdirSync(join(root,'shim'));
    put('shim/cstdint','namespace std { using uint64_t = __UINT64_TYPE__; }\n');
    put('shim/cinttypes','#define PRIu64 __UINT64_FMTu__\n');
    put('shim/cstdio','extern "C" int printf(const char*, ...); extern "C" int fputs(const char*, void*); extern "C" void* stderr; namespace std { using ::printf; using ::fputs; }\n');
    put('shim/cstdlib','extern "C" [[noreturn]] void exit(int); namespace std { using ::exit; }\n');
    put('shim/limits','namespace std { template<class T> struct numeric_limits { static constexpr T max(){return static_cast<T>(-1);} }; }\n');
    // Runtime inputs keep the arithmetic reachable at O2.
    put('guest.cpp',generated+'\nextern "C" U dynamic_multiply(U a,U b){return checked_mul(a,b);}\n');
    for(const target of targets)for(const opt of ['-O0','-O2']){
      ok(run(clang,['--target='+target,opt,'-std=c++20','-ffreestanding','-nostdinc++','-Ishim','-c','guest.cpp','-o','target.o']));
      const syms=ok(run('readelf',['-Ws','target.o']));assert.match(syms,/\bdynamic_multiply\b/);
      for(const line of syms.split('\n').filter(l=>/\bUND\b/.test(l))){const name=line.trim().split(/\s+/).at(-1);assert.ok(['UND','_GLOBAL_OFFSET_TABLE_','__aeabi_unwind_cpp_pr0','__aeabi_unwind_cpp_pr1','stderr','fputs','exit','printf'].includes(name),target+' '+opt+' unexpected undefined symbol '+name);}
      assert.match(ok(run('readelf',['-h','target.o'])),target.startsWith('aarch64')||target.startsWith('riscv64')?/Class:\s+ELF64/:/Class:\s+ELF32/);
    }
  });
  assert.equal(blob(readFileSync(resolve(path))),PIN);
});
