import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
export const BACKENDS=Object.freeze(['java','llvm','net','wasm','forge']);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=s=>{throw Error('wave4 manifest: '+s)};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function only(o,expected){
 if(o===null||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!expected.includes(k))||expected.some(k=>!own(o,k)))fail('invalid object keys');
}
export function validate(m){
 only(m,['schemaVersion','wave','status','certifiedParity','backends','tasks','sourceCases','requiredEvidence']);
 if(m.schemaVersion!==1||m.wave!==4||m.status!=='reference-contract-and-unverified-backend-source'||m.certifiedParity!==false)fail('false proof claim');
 if(JSON.stringify(m.backends)!==JSON.stringify(BACKENDS))fail('backend inventory differs');
 if(!Array.isArray(m.tasks)||m.tasks.length!==5||!Array.isArray(m.sourceCases)||m.sourceCases.length!==6||!Array.isArray(m.requiredEvidence)||m.requiredEvidence.length!==5)fail('count mismatch');
 for(let i=0;i<5;i++){
  const t=m.tasks[i];only(t,['id','name','source','oracle']);
  if(t.id!==16+i||typeof t.name!=='string'||!t.name||typeof t.source!=='string'||!t.source||typeof t.oracle!=='string'||!t.oracle)fail('task identity or oracle');
 }
 const ids=new Set(),paths=new Set(),grouped=new Set();
 for(const c of m.sourceCases){
  only(c,['id','file','task','mode','purpose','gitBlob','verified']);
  if(c.verified!==false||!/^[a-z][a-z0-9-]{2,60}$/.test(c.id)||c.file!==c.id+'.ores'||ids.has(c.id)||paths.has(c.file))fail('unsupported case identity/promotion');
  if(!Number.isInteger(c.task)||c.task<16||c.task>20||!['admit','reject','execute'].includes(c.mode)||!c.purpose)fail('invalid case oracle');
  if(!/^[0-9a-f]{40}$/.test(c.gitBlob))fail('invalid git object identity');
  ids.add(c.id);paths.add(c.file);grouped.add(c.task);
 }
 if(grouped.size!==5||m.sourceCases.filter(c=>c.mode==='reject').length!==1||m.sourceCases.filter(c=>c.mode==='execute').length!==1||m.sourceCases.filter(c=>c.task===16&&c.mode==='admit').length!==1||m.sourceCases.filter(c=>c.task===16&&c.mode==='reject').length!==1)fail('coverage contract changed');
 return m;
}
async function regular(file){
 const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink())fail('nonregular fixture');
}
export async function load(){
 const file=resolve(root,'manifest.json');await regular(file);
 const manifest=validate(JSON.parse(await readFile(file,'utf8')));
 for(const c of manifest.sourceCases){
  const path=resolve(root,'fixtures',c.file);await regular(path);
  const bytes=await readFile(path);
  const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(sha!==c.gitBlob)fail('fixture bytes changed: '+c.id);
 }
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||process.argv[2]!=='--validate')fail('only --validate is supported');
  const m=await load();
  console.log(JSON.stringify({status:'CONTRACT_VALID_ONLY',tasks:m.tasks.length,fixtures:m.sourceCases.length,backends:m.backends,verified:false,compilerExecuted:false}));
 }catch(e){console.error(e.stack||e.message);process.exitCode=2}
}