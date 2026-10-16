import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const BACKENDS=Object.freeze(['java','llvm','net','forge','wasm']);
export const AREAS=Object.freeze(['numeric','dispatch','capture','ownership','effects']);
const hex40=/^[0-9a-f]{40}$/;
const hex64=/^[0-9a-f]{64}$/;
const error=(msg)=>{throw Error('wave2: '+msg);};
function keys(obj,required,optional=[]) {
 if(obj===null||typeof obj!=='object'||Array.isArray(obj))error('expected object');
 const allowed=new Set([...required,...optional]);
 if(required.some(k=>!Object.hasOwn(obj,k))||Object.keys(obj).some(k=>!allowed.has(k)))error('unexpected/missing key');
}
function blobHash(data){return createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');}
export function validateManifest(manifest){
 keys(manifest,['schemaVersion','policy','backends','areas','cases']);
 if(manifest.schemaVersion!==1||manifest.policy!=='unattested-receipts-never-certify-parity')error('invalid policy');
 if(JSON.stringify(manifest.backends)!==JSON.stringify(BACKENDS)||JSON.stringify(manifest.areas)!==JSON.stringify(AREAS))error('backend/area registry changed');
 if(!Array.isArray(manifest.cases)||manifest.cases.length!==10)error('expected exactly ten cases');
 const ids=new Set(),coverage=new Map();
 for(const c of manifest.cases) {
  keys(c,['id','area','mode','file','gitBlob','oracle','targets']);
  if(typeof c.id!=='string'||!/^[a-z][a-z0-9-]{0,70}$/.test(c.id)||ids.has(c.id)||c.file!==c.id+'.ores'||!hex40.test(c.gitBlob))error('invalid fixture identity');
  ids.add(c.id);
  if(!AREAS.includes(c.area)||!['execute','check','reject'].includes(c.mode))error('invalid area/mode');
  keys(c.targets,BACKENDS);
  for(const b of BACKENDS)if(!['candidate','not-targeted'].includes(c.targets[b]))error('invalid candidate state');
  if(c.targets.java!=='candidate')error('Java baseline missing');
  if(!coverage.has(c.area))coverage.set(c.area,0);
  coverage.set(c.area,coverage.get(c.area)+1);
  if(c.mode==='execute') {
   keys(c.oracle,['kind','value']);
   if(c.oracle.kind==='integer') {if(!Number.isSafeInteger(c.oracle.value)||typeof c.oracle.value!=='number')error('invalid integer oracle');}
   else if(c.oracle.kind==='stdout') {if(typeof c.oracle.value!=='string'||c.oracle.value.length>256)error('invalid stdout oracle');}
   else error('invalid execution oracle');
  } else if(c.mode==='check') {
   keys(c.oracle,['kind','value']);
   if(c.oracle.kind!=='admission'||c.oracle.value!=='accepted')error('invalid check oracle');
  } else {
   keys(c.oracle,['kind','category','subject']);
   if(c.oracle.kind!=='diagnostic'||!['capture','ownership','effect'].includes(c.oracle.category)||
      typeof c.oracle.subject!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(c.oracle.subject))error('invalid rejection oracle');
  }
 }
 for(const area of AREAS)if(coverage.get(area)!==2)error('each area needs two cases: '+area);
 return manifest;
}
async function regular(path){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())error('not a regular file');}
export async function loadManifest(){
 const path=resolve(ROOT,'manifest.json');await regular(path);
 const manifest=validateManifest(JSON.parse(await readFile(path,'utf8')));
 for(const c of manifest.cases) {
  const file=resolve(ROOT,'fixtures',c.file);await regular(file);
  const data=await readFile(file);
  if(blobHash(data)!==c.gitBlob)error('fixture Git blob SHA mismatch: '+c.id);
 }
 return manifest;
}
function diagnosticMatches(stderr,oracle){
 if(typeof stderr!=='string'||stderr.length>65536)return false;
 if(/\b(?:segmentation fault|uncaught exception|stack trace|internal compiler error|panic|assertion failed)\b/i.test(stderr))return false;
 for(const line of stderr.split(/\r?\n/)) {
  const m=/^(?:(?:[^\r\n]*?):\d+(?::\d+)?:\s*)?error(?:\[[A-Za-z0-9_-]+\])?\s*:\s*(.+)$/i.exec(line.trim());
  if(!m)continue;
  const reason=m[1];
  if(oracle.category==='capture'&&/\bself\b/i.test(reason)&&/\b(captur\w*|scope|lexic\w*|visib\w*|bound|reference)\b/i.test(reason))return true;
  if(oracle.category==='ownership'&&/\b(borrow\w*|loan|owned)\b/i.test(reason)&&/\b(await|suspend\w*|yield|lifetime|escap\w*|across)\b/i.test(reason))return true;
  if(oracle.category==='effect'&&/\b(state|read|write|effect)\b/i.test(reason)&&/\b(mutat\w*|write|immut\w*|denied|cannot|forbid\w*|read-only)\b/i.test(reason))return true;
 }
 return false;
}
export function evaluateReport(manifest,report){
 validateManifest(manifest);
 keys(report,['schemaVersion','backend','area','sourceCommit','adapterSha256','observations']);
 if(report.schemaVersion!==1||!BACKENDS.includes(report.backend)||!hex40.test(report.sourceCommit)||!hex64.test(report.adapterSha256))error('invalid report identity');
 if(report.area!==null&&!AREAS.includes(report.area))error('invalid area filter');
 if(!Array.isArray(report.observations)||report.observations.length>10)error('invalid observations');
 const expected=manifest.cases.filter(c=>c.targets[report.backend]==='candidate'&&(report.area===null||c.area===report.area));
 if(expected.length===0)error('no candidate cases for selected backend/area');
 const byId=new Map(expected.map(c=>[c.id,c])),seen=new Set(),results=[];
 for(const o of report.observations) {
  keys(o,['caseId','gitBlob','phase','exitCode','stderr'],['observed']);
  if(typeof o.caseId!=='string'||!byId.has(o.caseId)||seen.has(o.caseId))error('unknown, untargeted or duplicate case');
  seen.add(o.caseId);
  const c=byId.get(o.caseId);
  if(o.gitBlob!==c.gitBlob||typeof o.stderr!=='string'||o.stderr.length>65536)error('source/diagnostic mismatch');
  let matched=false;
  if(c.mode==='execute') {
   // A failed adapter or compiler-only observation has no guest value.
   // Preserve a visible MISMATCH instead of throwing or manufacturing a value.
   if(Object.hasOwn(o,'observed')) {
    keys(o.observed,['kind','value']);
    matched=o.phase==='guest-executed'&&o.exitCode===0&&
     o.observed.kind===c.oracle.kind&&o.observed.value===c.oracle.value&&
     (c.oracle.kind!=='integer'||Number.isSafeInteger(o.observed.value))&&!/\berror\s*:/i.test(o.stderr);
   }
  } else if(c.mode==='check') {
   if(Object.hasOwn(o,'observed'))error('compile-only check cannot assert executed value');
   matched=o.phase==='compiler-accepted'&&o.exitCode===0&&!/\berror\s*:/i.test(o.stderr);
  } else {
   if(Object.hasOwn(o,'observed'))error('rejection cannot assert executed value');
   matched=o.phase==='compiler-rejected'&&o.exitCode===1&&diagnosticMatches(o.stderr,c.oracle);
  }
  results.push({caseId:o.caseId,status:matched?'ORACLE_MATCH_UNATTESTED':'MISMATCH'});
 }
 for(const c of expected)if(!seen.has(c.id))results.push({caseId:c.id,status:'MISSING'});
 const matched=results.filter(x=>x.status==='ORACLE_MATCH_UNATTESTED').length;
 return {backend:report.backend,area:report.area,expected:expected.length,matched,
  consistent:matched===expected.length,verified:false,authenticityAttested:false,
  semanticParityCertified:false,sourceCommitDeclared:report.sourceCommit,adapterSha256Declared:report.adapterSha256,
  note:'Receipt/schema consistency only; does not authenticate actual compiler or guest execution, CI steps, binary provenance, or cross-backend semantic parity.',results};
}
