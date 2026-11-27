// Runs unchanged portable fixtures with a real attoc -> Wasm compiler.
// Deliberately does not publish backend status or certify independent review.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {encoding:'utf8',timeout:10000}).trim();
const hex40 = /^[0-9a-f]{40}$/;
export function classifyNegative(f, positivePassed, run, artifact) {
  if (!run || run.error || run.signal !== null || !Number.isSafeInteger(run.status) || run.status === 2) return 'INFRA_ERROR';
  if (artifact === true || run.status === 0) return 'UNSAFE_ACCEPT_OR_ARTIFACT';
  if (artifact !== false) return 'INFRA_ERROR';
  if (run.status !== 1) return 'UNEXPECTED_EXIT';
  if (positivePassed !== true) return 'PAIRED_POSITIVE_NOT_EXECUTED';
  if (typeof run.stderr !== 'string' || typeof f?.path !== 'string' || !Number.isSafeInteger(f.diagnostic_line) || f.diagnostic_line < 1 || !/^E_COPY_READONLY(?:_SLOT)?$/.test(f.expect?.compile_reject ?? '')) return 'WRONG_DIAGNOSTIC';
  const line = run.stderr.replace(/\r?\n$/, '');
  const prefix = f.path + ':';
  const d = !/[\r\n]/.test(line) && line.startsWith(prefix)
    ? /^ ?([1-9]\d*):([1-9]\d*): (E_[A-Z0-9_]+): \S[^\r\n]*$/.exec(line.slice(prefix.length)) : null;
  return d && Number(d[1]) === f.diagnostic_line && Number.isSafeInteger(Number(d[2])) &&
    d[3] === f.expect.compile_reject ? 'EXPECTED_REJECT' : 'WRONG_DIAGNOSTIC';
}
const guest = String.raw`
const fs=require('node:fs'), assert=require('node:assert/strict');
const bytes=fs.readFileSync(process.argv[1]);
assert.ok(WebAssembly.validate(bytes));
const mod=new WebAssembly.Module(bytes), atto=Object.create(null);
const allowed=new Set(['print_i64','print_bool','print_f64','print_str','print_newline','actor_spawn','actor_send']);
for(const i of WebAssembly.Module.imports(mod)){
  assert.equal(i.module,'atto'); assert.equal(i.kind,'function'); assert.ok(allowed.has(i.name));
  atto[i.name]=()=>{throw Error('unexpected guest host effect '+i.name);};
}
const instance=new WebAssembly.Instance(mod,{atto});
assert.equal(typeof instance.exports.main,'function');
const result=instance.exports.main();
assert.equal(typeof result,'bigint');
assert.equal(result,BigInt(process.argv[2]));
assert.equal(instance.exports.panic_code.value,0);
process.stdout.write(result.toString());
`;
function runMain() {
  const [compilerRoot, binaryPath, compilerHead, compilerTree, corpusHead, corpusTree] = process.argv.slice(2);
  if(process.argv.length!==8 || ![compilerHead,compilerTree,corpusHead,corpusTree].every(v=>hex40.test(v??''))) {
    throw Error('usage: node scripts/run-copy-readonly-rust-wasm-v1.mjs COMPILER_ROOT ATTOC COMPILER_HEAD COMPILER_TREE CORPUS_HEAD CORPUS_TREE');
  }
  const cwd=process.cwd(), root=realpathSync(compilerRoot), binary=realpathSync(binaryPath);
  if(!binary.startsWith(root+'/')) throw Error('compiler binary outside pinned checkout');
  for(const [dir,h,t] of [[root,compilerHead,compilerTree],[cwd,corpusHead,corpusTree]]) {
    if(git(dir,'rev-parse','HEAD')!==h || git(dir,'rev-parse','HEAD^{tree}')!==t ||
       git(dir,'write-tree')!==t || git(dir,'status','--porcelain','--untracked-files=no')!=='') throw Error('source identity mismatch');
  }
  const manifestPath='contracts/copy-readonly-sharing-v1.json';
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const known=new Map();
  for(const f of manifest.fixtures) {
    if(!/^[a-z0-9-]+$/.test(f.id) || known.has(f.id) ||
       f.path!=='fixtures/copy-readonly-sharing-v1/'+f.id+'.atto') throw Error('bad fixture inventory');
    known.set(f.id,f);
    if(f.status!=='NOT_EXECUTED') throw Error('unexpected promoted fixture');
    if(!Number.isSafeInteger(f.expect.main_result) && !/^E_COPY_READONLY(?:_SLOT)?$/.test(f.expect.compile_reject??'')) throw Error('bad expectation');
  }
  for(const f of known.values()) if(f.expect.compile_reject) {
    const p=known.get(f.paired_positive);
    if(!p || !Number.isSafeInteger(p.expect.main_result)) throw Error('missing positive control');
    const a=readFileSync(f.path,'utf8').split('\n'), b=readFileSync(p.path,'utf8').split('\n');
    const d=a.flatMap((l,i)=>l!==b[i]?[i+1]:[]);
    if(a.length!==b.length || d.length!==1 || d[0]!==f.diagnostic_line ||
       a[f.diagnostic_line-1]?.trim()!==f.forbidden_statement) throw Error('bad rejection witness '+f.id);
  }
  const binarySha256=sha256(readFileSync(binary));
  const dir=mkdtempSync(join(tmpdir(),'atto-copy-parity-'));
  const results=new Map();
  try {
    for(const f of [...known.values()].sort((a,b)=>Number(!!a.expect.compile_reject)-Number(!!b.expect.compile_reject))) {
      const output=join(dir,f.id+'.wasm');
      const source=readFileSync(f.path);
      const fixtureBlob=git(cwd,'hash-object',f.path);
      if(fixtureBlob!==git(cwd,'rev-parse',corpusHead+':'+f.path)) throw Error('fixture blob mismatch '+f.id);
      const run=spawnSync(binary,[f.path,'-o',output],{cwd,encoding:'utf8',timeout:30000,maxBuffer:1048576});
      const artifact=existsSync(output);
      let status, guestResult=null, guestError=null;
      if(f.expect.compile_reject) status=classifyNegative(f,results.get(f.paired_positive)==='GUEST_PASS',run,artifact);
      else if(run.error || run.signal || run.status===null || run.status===2) status='INFRA_ERROR';
      else if(run.status!==0 || !artifact) status='POSITIVE_NOT_ADMITTED';
      else {
        const g=spawnSync(process.execPath,['-e',guest,output,String(f.expect.main_result)],{encoding:'utf8',timeout:10000,maxBuffer:1048576});
        guestResult=g.stdout; guestError=g.stderr?.slice(0,2048);
        status=!g.error&&!g.signal&&g.status===0&&guestResult===String(f.expect.main_result)?'GUEST_PASS':'GUEST_FAILED';
      }
      results.set(f.id,status);
      console.log(JSON.stringify({case:f.id,status,compilerHead,compilerTree,corpusHead,corpusTree,binarySha256,
        fixtureBlob,sourceSha256:sha256(source),compileExit:run.status,signal:run.signal,error:run.error?.message??null,
        artifact,artifactSha256:artifact?sha256(readFileSync(output)):null,diagnostic:run.stderr?.slice(0,2048),
        guestResult,guestError,pairedPositive:f.paired_positive??null,expected:f.expect}));
    }
    const counts={}; for(const s of results.values()) counts[s]=(counts[s]??0)+1;
    console.log(JSON.stringify({scope:'EXECUTED_COMPILER_GUEST_CANDIDATE_NOT_INDEPENDENTLY_REVIEWED',counts,fullParity:false}));
    if([...results.values()].some(s=>s!=='GUEST_PASS'&&s!=='EXPECTED_REJECT')) process.exitCode=1;
  } finally {rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) runMain();
