// Real two-backend guest conformance: source .atto -> independently compiled
// Rust/Wasm or Forge-native -> executed guest result; never a host matcher.
// Requires pinned compiler Git-tree integrity, not just an executable name.
// NO execution means NO PASS receipt. No Python.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const manifest=JSON.parse(readFileSync(join(root,'contracts/typed-pattern-fragments-v1.json'),'utf8'));
const backend=process.argv[2];
assert.ok(['rust-wasm','forge-native'].includes(backend),
  'usage: node tests/typed-patterns-cross-backend-guests.mjs rust-wasm|forge-native');
const compilerRepo=process.env.ATTO_COMPILER_REPO;
const expectedTree=process.env.ATTO_EXPECTED_COMPILER_TREE;
assert.ok(compilerRepo && expectedTree && /^[a-f0-9]{40}$/.test(expectedTree),
  'ATTO_COMPILER_REPO and exact ATTO_EXPECTED_COMPILER_TREE are required');
const git=(...args)=>{
  const p=spawnSync('git',['-C',compilerRepo,...args],{encoding:'utf8',timeout:10000,maxBuffer:1<<20});
  assert.equal(p.error,undefined,'git proof subprocess failed');
  assert.equal(p.status,0,'git proof failed: '+p.stderr);
  return p.stdout.trim();
};
const tree=git('rev-parse','HEAD^{tree}');
assert.equal(tree,expectedTree,'actual compiler tree differs from required exact source tree');
assert.equal(git('status','--porcelain'),'','compiler tree must be clean');
const head=git('rev-parse','HEAD');
const compiler=backend==='rust-wasm'
  ? resolve(compilerRepo,process.env.ATTOC_RELATIVE??'target/release/attoc')
  : resolve(compilerRepo,process.env.FORGE_RELATIVE??'build/forge_scalar');
assert.ok(existsSync(compiler),'production compiler executable is absent');
const cxx=process.env.CXX??'c++';
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const gitBlob=buffer=>createHash('sha1').update('blob '+buffer.length+'\0').update(buffer).digest('hex');
const expected=[
  ['list-pattern-rest-60.atto',60],
  ['list-pattern-guard-once-0.atto',0],
  ['list-pattern-infix-30.atto',30],
  ['list-pattern-anchored-no-match-7.atto',7],
  ['list-pattern-full-width-1.atto',1],
  ['list-pattern-leftmost-3.atto',3],
  ['list-pattern-max-length-32.atto',32],
  ['list-pattern-overflow-panic.atto',null],
];
const commands=(program,args,timeout=30000)=>spawnSync(program,args,{
  encoding:'utf8',timeout,maxBuffer:1<<20,
});
const scratch=mkdtempSync(join(tmpdir(),'atto-sequence-parity-'));
const receipt=[];
try{
  for(const [name,want] of expected){
    const relative='fixtures/typed-pattern-fragments/'+name;
    const entry=manifest.portable_guest_fixtures.find(x=>x.path===relative);
    assert.ok(entry,'fixture missing from canonical registry: '+name);
    const source=resolve(root,relative);
    assert.equal(lstatSync(source).isSymbolicLink(),false,'fixture symlink refused');
    const bytes=readFileSync(source);
    assert.equal(gitBlob(bytes),entry.blob_sha,'fixture Git blob changed: '+name);
    const generated=join(scratch,name+(backend==='rust-wasm'?'.wasm':'.cpp'));
    const compile=commands(compiler,[source,'-o',generated]);
    assert.equal(compile.error,undefined,name+': compiler process error');
    assert.equal(compile.status,0,name+': compiler error: '+compile.stderr);
    assert.ok(existsSync(generated),name+': no generated guest artifact');
    const generatedBytes=readFileSync(generated);
    let actual,panicCode=0;
    if(backend==='rust-wasm'){
      assert.ok(WebAssembly.validate(generatedBytes),name+': compiler emitted invalid Wasm');
      const module=new WebAssembly.Module(generatedBytes);
      assert.deepEqual(WebAssembly.Module.imports(module),[],name+': host matcher import prohibited');
      const guest=new WebAssembly.Instance(module,{});
      assert.equal(typeof guest.exports.main,'function',name+': guest main missing');
      if(want===null){
        assert.throws(()=>guest.exports.main(),WebAssembly.RuntimeError,
          name+': overflowing guest must trap');
        panicCode=guest.exports.panic_code.value;
        assert.equal(panicCode,1,name+': expected native Wasm checked-add trap');
        actual='OVERFLOW';
      }else{
        actual=Number(guest.exports.main());
        assert.equal(actual,want,name+': guest returned incorrect value');
        assert.equal(guest.exports.panic_code.value,0,name+': unexpected guest panic');
        assert.ok(guest.exports.memory instanceof WebAssembly.Memory,
          name+': missing guest-owned List storage');
      }
    }else{
      const cpp=generatedBytes.toString('utf8');
      assert.ok(cpp.includes('std::array<atto::forge::i64,') &&
        cpp.includes('values[start+'),name+': native compiler did not emit List access');
      const binary=join(scratch,name+'.bin');
      const native=commands(cxx,['-std=c++20','-Wall','-Wextra','-Werror','-pedantic',
        '-I'+resolve(compilerRepo,'include'),generated,'-o',binary],60000);
      assert.equal(native.error,undefined,name+': native compiler process error');
      assert.equal(native.status,0,name+': generated C++ failed: '+native.stderr);
      const guest=commands(binary,[],10000);
      assert.equal(guest.error,undefined,name+': native guest process error');
      if(want===null){
        assert.equal(guest.status,70,name+': wrong overflow runtime status');
        assert.equal(guest.stdout,'',name+': overflow printed success');
        assert.equal(guest.stderr,'E_OVERFLOW\n',name+': wrong overflow category');
        panicCode=1; // semantic normalization ONLY, not a claim of Wasm ABI.
        actual='OVERFLOW';
      }else{
        assert.equal(guest.status,0,name+': native guest failed: '+guest.stderr);
        assert.equal(guest.stdout,String(want)+'\n',name+': native guest returned wrong result');
        assert.equal(guest.stderr,'',name+': unexpected native guest stderr');
        actual=want;
      }
    }
    receipt.push({
      fixture:relative,source_blob_sha:entry.blob_sha,
      compiled_artifact_sha256:sha(generatedBytes),expected:want===null?'OVERFLOW':want,
      actual,semantic_panic_code:panicCode,source_compiled:true,guest_executed:true
    });
  }
  const report={
    schema:'atto.patterns.cross-backend-guests.v1',
    backend,compiler_head:head,compiler_tree:tree,
    target:backend==='rust-wasm'?'wasm32-guest':'native-cxx20-guest',
    cases:receipt,passed:receipt.length,failed:0,executed:true
  };
  assert.equal(receipt.length,8);
  console.log(JSON.stringify(report,null,2));
}finally{
  rmSync(scratch,{recursive:true,force:true});
}
