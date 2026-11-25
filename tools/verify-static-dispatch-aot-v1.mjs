// Static-dispatch parity *shape* checks, not provenance attestation.
// Every accepted candidate remains unverified pending independent GitHub run,
// artifact, compiler tree and native guest validation.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BACKENDS = ['llvm','java-graalvm','net-nativeaot','wasm','forge'];
const KINDS = ['DIRECT','STATIC_WITNESS','CLOSED_INDIRECT','ACTOR_MESSAGE'];
const REQUIRED_CASES = ['direct-counter','direct-overload','reject-wrong-arity',
  'reject-missing-method','reject-duplicate-slot','reject-private-access'];
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
function fail(message) { throw new Error('DISPATCH_PARITY_REJECT: ' + message); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function keys(v,expected,name) {
  if (!object(v) || Object.keys(v).sort().join('|') !== [...expected].sort().join('|'))
    fail(name + ': missing/unknown keys');
}
function same(v,w,name) { if(v !== w) fail(name); }
function boundText(v,name) {
  if(typeof v !== 'string' || v.length < 1 || v.length > 512 || /[\u0000-\u001f]/.test(v))
    fail(name + ': not a bounded text field');
}
function exactSet(v,expected,name) {
  if(!Array.isArray(v) || v.length!==expected.length ||
    new Set(v).size !== v.length || expected.some(x=>!v.includes(x)))
    fail(name + ': missing/duplicate/unknown identity');
}
function safeFixture(path) {
  if(!/^fixtures\/static-dispatch-aot-v1\/[a-z0-9-]+\.atto$/.test(path))
    fail('fixture outside pinned corpus');
  const full = resolve(ROOT,path);
  const stat = lstatSync(full);
  if(!stat.isFile() || stat.size<1 || stat.size>65536 || stat.nlink!==1)
    fail('fixture must be a bounded regular single-link file');
  const content=readFileSync(full);
  if(content.includes(0) || !content.toString('utf8').startsWith('define class '))
    fail('fixture invalid or not a class source');
  return createHash('sha256').update(content).digest('hex');
}
export function validateManifest(m) {
  keys(m,['schema','status','policy','baseline','note','kinds','backends','cases','pending'],'manifest');
  same(m.schema,'atto.static-dispatch-parity.v1','manifest schema');
  same(m.status,'SOURCE_CONTRACT_ONLY','manifest cannot claim backend evidence');
  same(m.policy,'https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/265','policy anchor');
  same(m.baseline,'https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1663','LLVM anchor');
  boundText(m.note,'note');
  exactSet(m.kinds,KINDS,'dispatch kinds');
  if(!Array.isArray(m.backends) || m.backends.length!==BACKENDS.length) fail('backend inventory');
  exactSet(m.backends.map(b=>b.id),BACKENDS,'backend IDs');
  for(const b of m.backends) {
    keys(b,['id','status','artifact'],'backend');
    same(b.status,'NOT_EXECUTED','no backend promotion from manifest');
    boundText(b.artifact,'artifact kind');
  }
  if(!Array.isArray(m.cases)) fail('cases missing');
  exactSet(m.cases.map(c=>c.id),REQUIRED_CASES,'cases');
  const out=new Map(), paths=new Set();
  for(const c of m.cases) {
    const positive=c.expect==='exit42';
    keys(c,positive?['id','file','expect','targets']:
      ['id','file','expect','diagnostic'],'case');
    if(positive !== c.id.startsWith('direct-')) fail('case expectation mismatch');
    if(positive) {
      exactSet(c.targets,c.id==='direct-counter'?
        ['Counter.add','Counter.read']:['Box.read$arity0','Box.read$arity1'],'direct symbols');
    } else {
      same(c.expect,'reject','negative expectation');
      same(c.diagnostic,{
        'reject-wrong-arity':'wrong-arity','reject-missing-method':'unknown-method',
        'reject-duplicate-slot':'duplicate-slot','reject-private-access':'private-access'
      }[c.id],'diagnostic class');
    }
    if(paths.has(c.file)) fail('duplicate source path');
    paths.add(c.file);
    out.set(c.id,{...c,sha256:safeFixture(c.file)});
  }
  if(!Array.isArray(m.pending) || m.pending.length!==3) fail('pending category list');
  exactSet(m.pending.map(c=>c.kind),KINDS.slice(1),'pending kinds');
  for(const p of m.pending) {
    keys(p,['kind','status','required'],'pending category');
    same(p.status,'NOT_IMPLEMENTED_IN_SHARED_GUEST_CORPUS','unproven category promoted');
    boundText(p.required,'category requirement');
  }
  return out;
}
export function verifyCandidateReceipt(receipt,manifest) {
  const cases=validateManifest(manifest);
  keys(receipt,['schema','backend','sourceHeadSha','sourceTreeSha','compilerSha256',
    'toolchain','artifactKind','jitRequired','runtimeCompilerRequired','job','results'],'receipt');
  same(receipt.schema,'atto.static-dispatch-evidence.v1','receipt schema');
  if(!BACKENDS.includes(receipt.backend)) fail('unknown backend');
  if(!SHA40.test(receipt.sourceHeadSha) || !SHA40.test(receipt.sourceTreeSha)
     || !SHA256.test(receipt.compilerSha256)) fail('missing exact source/compiler hash');
  boundText(receipt.toolchain,'toolchain');
  same(receipt.artifactKind,manifest.backends.find(b=>b.id===receipt.backend).artifact,'artifact kind mismatch');
  same(receipt.jitRequired,false,'JIT is forbidden as correctness dependency');
  same(receipt.runtimeCompilerRequired,false,'runtime compilation forbidden');
  keys(receipt.job,['runId','attempt','runnerId','steps'],'job');
  for(const k of ['runId','attempt','runnerId'])
    if(!Number.isSafeInteger(receipt.job[k]) || receipt.job[k]<=0) fail('zero-step/runner admission');
  if(!Array.isArray(receipt.job.steps) || receipt.job.steps.length<4) fail('insufficient executed steps');
  for(const step of receipt.job.steps) {
    keys(step,['name','conclusion'],'step');
    boundText(step.name,'step name');
    same(step.conclusion,'success','failed/not executed step');
  }
  const expected=[...cases.values()].flatMap(c=>c.expect==='exit42'?
    ['O0','O2'].map(opt=>c.id+':'+opt):[c.id+':NA']);
  if(!Array.isArray(receipt.results)) fail('missing source executions');
  exactSet(receipt.results.map(x=>x.id+':'+x.optimization),expected,'executed fixtures');
  for(const item of receipt.results) {
    keys(item,['id','optimization','sourceSha256','compilerExit','guestExit',
      'artifactSha256','emittedIr','diagnosticClass','callTargets'],'fixture result');
    const c=cases.get(item.id);
    if(!c || item.sourceSha256!==c.sha256) fail('source bytes were not pinned');
    if(c.expect==='exit42') {
      if(!['O0','O2'].includes(item.optimization) || item.compilerExit!==0 ||
        item.guestExit!==42 || !SHA256.test(item.artifactSha256) ||
        item.emittedIr!==true || item.diagnosticClass!==null)
        fail('positive guest was not compiled/linked/executed');
      exactSet(item.callTargets,c.targets,'observed compiled direct callees');
    } else {
      if(item.optimization!=='NA' || !Number.isInteger(item.compilerExit) ||
         item.compilerExit===0 || item.guestExit!==null ||
         item.artifactSha256!==null || item.emittedIr!==false ||
         item.diagnosticClass!==c.diagnostic || !Array.isArray(item.callTargets) ||
         item.callTargets.length!==0)
        fail('negative fixture emitted runnable output or lacks a rejection');
    }
  }
  return {status:'CANDIDATE_FORMAT_VALID_REQUIRES_INDEPENDENT_ATTESTATION',
    verified:false, checkedResults:receipt.results.length,
    warning:'Self-reported JSON cannot authenticate GitHub job steps, exact source tree, compiler build or native artifact.'};
}
export function readManifest() {
  return JSON.parse(readFileSync(resolve(ROOT,'contracts/static-dispatch-aot-parity-v1.json'),'utf8'));
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  try {
    if(process.argv.length!==3) fail('usage: node tools/verify-static-dispatch-aot-v1.mjs CANDIDATE_RECEIPT.json');
    const data=JSON.parse(readFileSync(process.argv[2],'utf8'));
    console.log(JSON.stringify(verifyCandidateReceipt(data,readManifest()),null,2));
  } catch(err) {
    console.error(String(err.message));
    process.exitCode=1;
  }
}
