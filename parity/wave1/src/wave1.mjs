import {createHash} from 'node:crypto';
import {readFile, lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BACKENDS = Object.freeze(['java', 'llvm', 'net', 'wasm', 'forge']);
export const CATEGORIES = Object.freeze(['scalar', 'grammar', 'scope', 'types']);
const STATES = new Set(['reported', 'partial', 'unsupported', 'unknown']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(message) { throw new Error('wave1: ' + message); }
function exactKeys(value, required, optional=[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object');
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key=>!allowed.has(key)) || required.some(key=>!Object.hasOwn(value,key))) fail('unexpected or missing keys');
}
export function validateCatalog(catalog) {
  exactKeys(catalog, ['schemaVersion','policy','backends','features','cases']);
  if (catalog.schemaVersion!==1 || catalog.policy!=='reported-status-is-not-execution-evidence') fail('unsupported catalog policy');
  if (JSON.stringify(catalog.backends)!==JSON.stringify(BACKENDS)) fail('backend inventory mismatch');
  if (!Array.isArray(catalog.features) || !catalog.features.length || !Array.isArray(catalog.cases) || !catalog.cases.length) fail('empty feature/case inventory');
  const featureIds = new Set();
  for (const feature of catalog.features) {
    exactKeys(feature,['id','title','implementation','verified']);
    if (!/^[a-z][a-z0-9-]{0,50}$/.test(feature.id) || featureIds.has(feature.id) || !feature.title) fail('invalid/duplicate feature');
    featureIds.add(feature.id);
    exactKeys(feature.implementation,BACKENDS); exactKeys(feature.verified,BACKENDS);
    for (const backend of BACKENDS) {
      if (!STATES.has(feature.implementation[backend]) || feature.verified[backend]!==false) fail('unattested feature cannot be verified');
    }
  }
  const ids=new Set(), files=new Set(), groups=new Map();
  for(const c of catalog.cases) {
    exactKeys(c,['id','feature','file','sha256','expect','targets'],['diagnostic','symbol']);
    if(!/^[a-z][a-z0-9-]{0,60}$/.test(c.id)||ids.has(c.id))fail('invalid/duplicate case');
    ids.add(c.id);
    if(!featureIds.has(c.feature) || !CATEGORIES.includes(c.feature))fail('unsupported fixture category');
    if(c.file!==c.id+'.ores'||files.has(c.file))fail('invalid/duplicate fixture file');
    files.add(c.file);
    if(!/^[a-f0-9]{64}$/.test(c.sha256))fail('invalid fixture hash');
    if(!['accept','reject'].includes(c.expect))fail('invalid expectation');
    if(JSON.stringify(c.targets)!==JSON.stringify(BACKENDS))fail('partial backend inventory');
    if(c.expect==='accept' && (c.diagnostic!==undefined||c.symbol!==undefined))fail('accept cannot carry diagnostic');
    if(c.expect==='reject' && !['identifier','syntax','arity'].includes(c.diagnostic))fail('missing diagnostic category');
    if(c.diagnostic==='identifier' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.symbol||''))fail('invalid unresolved identifier');
    if(c.diagnostic!=='identifier' && c.symbol!==undefined)fail('unexpected identifier');
    if(!groups.has(c.feature))groups.set(c.feature,new Set());
    groups.get(c.feature).add(c.expect);
  }
  for(const category of CATEGORIES)if(!groups.get(category)?.has('accept')||!groups.get(category)?.has('reject'))fail('missing positive/negative '+category);
  return catalog;
}
async function regularFile(path) {
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink())fail('non-regular or symlink file');
}
export async function loadCatalog() {
  const path=resolve(root,'manifest.json'); await regularFile(path);
  const obj=JSON.parse(await readFile(path,'utf8'));
  validateCatalog(obj);
  for(const c of obj.cases){
    const path=resolve(root,'fixtures',c.file);
    await regularFile(path);
    if(sha256(await readFile(path))!==c.sha256)fail('fixture hash mismatch: '+c.file);
  }
  return obj;
}
export function validateInvocation(argv, sourceSha) {
  if(!/^[0-9a-f]{40}$/.test(sourceSha||''))fail('exact source commit SHA required');
  if(!Array.isArray(argv)||argv.length<2||argv.some(s=>typeof s!=='string'||!s||s.includes('\0')))fail('invalid argv');
  if(!isAbsolute(argv[0])||argv.filter(x=>x==='{file}').length!==1||argv.some(x=>x.includes('{file}')&&x!=='{file}'))fail('absolute executable and exactly one standalone {file} required');
}
function primaryDiagnostic(output, c) {
  const lines=output.split(/\r?\n/).map(x=>x.trim());
  for(const line of lines) {
    const match=/(?:^|:\d+(?::\d+)?:\s*)(?:fatal\s+)?error(?:\[[A-Za-z0-9_-]+\])?\s*:\s*(.*)/i.exec(line);
    if(!match)continue;
    const reason=match[1];
    if(c.diagnostic==='syntax' && /\b(syntax|parse|token|expected|unexpected|malformed)\b/i.test(reason))return true;
    if(c.diagnostic==='arity' && /\b(arity|arguments?|parameters?|expects?|requires?)\b/i.test(reason))return true;
    if(c.diagnostic==='identifier'){
      const escaped=c.symbol;
      if(new RegExp('(?:unresolved|undefined|undeclared|unknown|unbound|cannot find|cannot resolve)\\s+(?:(?:identifier|name|symbol|variable|reference)\\s+)?["\x27]?'+escaped+'\\b','i').test(reason) ||
         new RegExp('^["\x27]?'+escaped+'["\x27]?\\s+(?:is\\s+)?(?:not found|not defined|undefined|undeclared|unresolved|unknown|unbound)\\b','i').test(reason))return true;
    }
  }
  return false;
}
const hasError = output=>/(?:^|\n)\s*(?:[^\n]*?:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error(?:\[[A-Za-z0-9_-]+\])?\s*:/i.test(output);
export async function runWave1({backend,category,argv,sourceSha,timeoutMs=10000,spawn=spawnSync}={}) {
  if(!BACKENDS.includes(backend))fail('invalid backend');
  if(category!==undefined&&!CATEGORIES.includes(category))fail('invalid category');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)fail('invalid timeout');
  const catalog=await loadCatalog();
  const relevant=catalog.cases.filter(c=>c.targets.includes(backend)&&(!category||c.feature===category));
  if(!argv)return {backend,category:category||'all',configured:false,ok:false,verified:false,status:'UNCONFIGURED',results:relevant.map(c=>({id:c.id,status:'UNCONFIGURED'}))};
  validateInvocation(argv,sourceSha);
  await regularFile(argv[0]);
  const executableSha256=sha256(await readFile(argv[0]));
  const results=[];
  for(const c of relevant){
    const file=resolve(root,'fixtures',c.file);
    const args=argv.map(x=>x==='{file}'?file:x);
    const output=spawn(args[0],args.slice(1),{encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,cwd:root,windowsHide:true,shell:false});
    const combined=(output.stdout||'')+'\n'+(output.stderr||'');
    let status='MISMATCH';
    if(output.error)status=output.error.code==='ETIMEDOUT'?'TIMEOUT':'SPAWN_ERROR';
    else if(output.signal)status='SIGNALED';
    else if(!Number.isSafeInteger(output.status)||output.status<0)status='INVALID_EXIT';
    else if(c.expect==='accept'&&output.status===0&&!hasError(combined))status='OBSERVED_PASS';
    else if(c.expect==='reject'&&output.status===1&&primaryDiagnostic(combined,c))status='OBSERVED_PASS';
    results.push({id:c.id,status,exitCode:output.status??null,signal:output.signal||null,fixtureSha256:c.sha256,stdout:output.stdout||'',stderr:output.stderr||''});
  }
  return {backend,category:category||'all',configured:true,status:results.length&&results.every(x=>x.status==='OBSERVED_PASS')?'ADMISSION_OBSERVED':'INCOMPLETE',
    ok:results.length>0&&results.every(x=>x.status==='OBSERVED_PASS'),verified:false,parityVerified:false,
    provenanceVerified:false,sourceShaDeclared:sourceSha,executableSha256,
    note:'Observed compiler admissions only; no source-binary provenance, guest execution, or cross-backend semantic parity is attested.',results};
}
