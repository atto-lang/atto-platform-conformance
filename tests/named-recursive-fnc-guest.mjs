// Real guest gate, separate from source/oracle checks. Run only with trusted pinned compiler checkouts.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=join(root,'fixtures/named-recursive-fnc-v1');
const manifest=JSON.parse(readFileSync(join(fixtures,'manifest.json'),'utf8'));
const backend=process.argv[2];
assert.ok(['rust-wasm','forge-native'].includes(backend),'usage: node tests/named-recursive-fnc-guest.mjs rust-wasm|forge-native');
assert.equal(process.env.ATTOC_RELATIVE,undefined,'prebuilt override denied');
assert.equal(process.env.FORGE_RELATIVE,undefined,'prebuilt override denied');
const pin=(key)=>{const v=process.env[key];assert.match(v??'',/^[0-9a-f]{40}$/,key+' must be an independent immutable pin');return v;};
const repo=realpathSync(process.env.ATTO_COMPILER_REPO??'');
const run=(exe,args,timeout=30000,extra={})=>spawnSync(exe,args,{encoding:'utf8',timeout,maxBuffer:4<<20,...extra});
const ok=(p,label)=>{assert.equal(p.error,undefined,label+' process error');assert.equal(p.signal,null,label+' signal');assert.equal(p.status,0,label+': '+p.stderr);return p.stdout;};
const git=(cwd,...args)=>ok(run('git',['-C',cwd,...args],10000),'git '+args.join(' ')).trim();
const proof=(cwd,head,tree)=>{
 assert.equal(git(cwd,'rev-parse','HEAD'),head,'head mismatch');
 assert.equal(git(cwd,'rev-parse','HEAD^{tree}'),tree,'tree mismatch');
 assert.equal(git(cwd,'status','--porcelain','--untracked-files=all'),'','dirty checkout');
};
const head=pin('ATTO_EXPECTED_COMPILER_HEAD'),tree=pin('ATTO_EXPECTED_COMPILER_TREE');
const fixtureHead=pin('ATTO_EXPECTED_CONFORMANCE_HEAD'),fixtureTree=pin('ATTO_EXPECTED_CONFORMANCE_TREE');
proof(repo,head,tree);proof(root,fixtureHead,fixtureTree);
const sha=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const expectedIds=['fib-0','fib-1','fib-10','fib-10-explicit-semicolon','fib-55-linear','fib-92-linear','fib-93-overflow','fib-name-does-not-escape'];
assert.equal(manifest.status,'CANDIDATE_SOURCE_NOT_EXECUTED');
assert.deepEqual(manifest.cases.filter(c=>c.tier==='smoke').map(c=>c.id),expectedIds);
const scratch=mkdtempSync(join(tmpdir(),'atto-recursive-guest-'));
const cases=[];
let compiler;
try {
 if(backend==='rust-wasm'){
   ok(run('cargo',['build','--locked','--release','--bin','attoc','--target-dir',join(scratch,'target')],600000,{cwd:repo}),'fresh compiler build');
   compiler=join(scratch,'target','release','attoc');
 }else{
   ok(run('cmake',['-S',repo,'-B',join(scratch,'build'),'-DATTO_FORGE_SANITIZERS=ON'],120000),'Forge configure');
   ok(run('cmake',['--build',join(scratch,'build'),'--target','forge_scalar','--parallel','2'],600000),'Forge build');
   compiler=join(scratch,'build','forge_scalar');
 }
 assert.ok(existsSync(compiler),'fresh compiler missing');
 proof(repo,head,tree);
 const compilerHash=sha(readFileSync(compiler));
 for(const id of expectedIds){
   const c=manifest.cases.find(x=>x.id===id);
   assert.equal(c.path,id+'.atto');
   const src=join(fixtures,c.path);
   assert.ok(lstatSync(src).isFile()&&!lstatSync(src).isSymbolicLink(),'fixture must be a regular file');
   assert.equal(blob(readFileSync(src)),c.blob,'fixture blob mismatch: '+id);
   const out=join(scratch,id+(backend==='rust-wasm'?'.wasm':'.cpp'));
   const built=run(compiler,[src,'-o',out]);
   const row={id,source_blob:c.blob,expected:c.expected,compiled:false,executed:false};
   if(built.error||built.signal!==null||built.status===null){
     cases.push({...row,status:'infrastructure_error',detail:String(built.error??built.signal)});continue;
   }
   if(c.expected.kind==='reject'){
     // Only an exact targeted unbound-name diagnostic at the outside call is accepted.
     // Forge diagnostic mapping is deliberately NOT certified until independently audited.
     const targeted=backend==='rust-wasm'&&built.status===1&&/:9:\d+: E_UNBOUND: unknown name 'fib'\s*$/.test(built.stderr);
     cases.push({...row,status:targeted&&!existsSync(out)?'pass':'fail',diagnostic:built.stderr.slice(0,4096),artifact_present:existsSync(out)});continue;
   }
   if(built.status!==0||!existsSync(out)){
     cases.push({...row,status:'fail',diagnostic:built.stderr.slice(0,4096),artifact_present:existsSync(out)});continue;
   }
   const bytes=readFileSync(out);
   row.compiled=true;row.artifact_sha256=sha(bytes);
   let guest;
   if(backend==='rust-wasm'){
     // A separate process is essential: malformed/infinite guests cannot hang this harness.
     const worker=`import {readFileSync} from 'node:fs';
const b=readFileSync(process.argv[1]);if(!WebAssembly.validate(b))throw Error('invalid Wasm');
const m=new WebAssembly.Module(b);if(WebAssembly.Module.imports(m).length)throw Error('unexpected imports');
const i=new WebAssembly.Instance(m,{});if(typeof i.exports.main!=='function'||!(i.exports.panic_code instanceof WebAssembly.Global))throw Error('missing exports');
try{const v=i.exports.main();if(typeof v!=='bigint'||i.exports.panic_code.value!==0)throw Error('wrong i64 ABI or unexpected panic');console.log(JSON.stringify({kind:'value',value:v.toString()}));}
catch(e){if(!(e instanceof WebAssembly.RuntimeError)||i.exports.panic_code.value!==1)throw e;console.log(JSON.stringify({kind:'error',code:'ArithmeticOverflowError'}));}`;
     guest=run(process.execPath,['--input-type=module','-e',worker,out],5000);
   }else{
     const binary=join(scratch,id+'.bin');
     const native=run('c++',['-std=c++20','-Wall','-Wextra','-Werror','-pedantic','-I'+join(repo,'include'),out,'-o',binary],60000);
     if(native.error||native.signal!==null||native.status!==0||!existsSync(binary)){
       cases.push({...row,status:'fail',diagnostic:String(native.error??native.stderr).slice(0,4096)});continue;
     }
     row.native_artifact_sha256=sha(readFileSync(binary));
     guest=run(binary,[],5000);
   }
   if(guest.error||guest.signal!==null||guest.status===null){
     cases.push({...row,status:'infrastructure_error',detail:String(guest.error??guest.signal)});continue;
   }
   row.executed=true;
   let actual=null;
   if(backend==='rust-wasm'&&guest.status===0&&guest.stderr===''){
     try{actual=JSON.parse(guest.stdout);}catch{}
   }else if(backend==='forge-native'){
     if(guest.status===0&&guest.stderr===''&&/^-?(?:0|[1-9][0-9]*)\n$/.test(guest.stdout))actual={kind:'value',value:guest.stdout.trim()};
     else if(guest.status===70&&guest.stdout===''&&guest.stderr==='E_OVERFLOW\n')actual={kind:'error',code:'ArithmeticOverflowError'};
   }
   const match=actual!==null&&actual.kind===c.expected.kind&&Object.keys(actual).length===2&&
     (c.expected.kind==='value'?actual.value===c.expected.value:actual.code===c.expected.code);
   cases.push({...row,status:match?'pass':'fail',actual,guest_status:guest.status});
 }
 proof(repo,head,tree);proof(root,fixtureHead,fixtureTree);
 const passed=cases.filter(c=>c.status==='pass').length;
 const report={schema:'atto.named-recursive-fnc.guest-probe.v1',backend,compiler_head:head,compiler_tree:tree,compiler_sha256:compilerHash,conformance_head:fixtureHead,conformance_tree:fixtureTree,cases,passed,failed:cases.length-passed,extended:'not_executed',status:passed===expectedIds.length?'smoke_pass':'smoke_incomplete'};
 console.log(JSON.stringify(report,null,2));
 if(passed!==expectedIds.length)process.exitCode=1;
}finally{rmSync(scratch,{recursive:true,force:true});}
