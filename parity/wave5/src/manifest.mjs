import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bad=s=>{throw Error('wave5-manifest: '+s)};
function shape(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||keys.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!keys.includes(k)))bad('unknown/missing fields')}
const B=['java','llvm','net','forge','wasm'];
const expected=[
[21,'actor-memory-read','java','admit'],
[21,'actor-memory-escape-reject','java','reject'],
[22,'llvm-native-main','llvm','native-guest'],
[23,'net-native-main','net','native-guest'],
[24,'forge-native-main','forge','native-guest'],
[25,'wasm-native-main','wasm','wasm-guest']
];
export function validateManifest(m){
 shape(m,['schemaVersion','wave','status','certifiedParity','backends','tasks','fixtures','requiredProof']);
 if(m.schemaVersion!==1||m.wave!==5||m.status!=='candidate-fixtures-and-artifact-shape-gates-only'||m.certifiedParity!==false)bad('false parity promotion');
 if(JSON.stringify(m.backends)!==JSON.stringify(B))bad('backend inventory changed');
 if(!Array.isArray(m.tasks)||m.tasks.length!==5||!Array.isArray(m.fixtures)||m.fixtures.length!==6||!Array.isArray(m.requiredProof)||m.requiredProof.length!==5)bad('task/fixture/proof inventory changed');
 const names=['actor-memory-domains','llvm-native-application-aot','net-nativeaot-program','forge-independent-native-codegen','llvm-to-wasm-profiles'];
 m.tasks.forEach((t,i)=>{
  shape(t,['id','name','proof','refs']);
  if(t.id!==i+21||t.name!==names[i]||typeof t.proof!=='string'||t.proof.length<30||!Array.isArray(t.refs)||!t.refs.length||t.refs.some(x=>!/[a-z]+#[0-9]+/.test(x)))bad('task contract changed');
 });
 m.fixtures.forEach((c,i)=>{
  shape(c,['id','path','task','backend','mode','gitBlob','verified']);
  const [task,id,backend,mode]=expected[i];
  if(c.id!==id||c.path!=='fixtures/'+id+'.ores'||c.task!==task||c.backend!==backend||c.mode!==mode||c.verified!==false||!/^[0-9a-f]{40}$/.test(c.gitBlob))bad('fixture identity/status changed');
 });
 if(m.fixtures.slice(2).some(c=>c.gitBlob!==m.fixtures[2].gitBlob))bad('native scalar control diverged');
 return m;
}
async function regular(path){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())bad('nonregular manifest/fixture')}
export async function loadManifest(){
 const path=resolve(root,'manifest.json');await regular(path);
 const manifest=validateManifest(JSON.parse(await readFile(path,'utf8')));
 for(const c of manifest.fixtures){
  const f=resolve(root,c.path);await regular(f);const bytes=await readFile(f);
  const digest=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(digest!==c.gitBlob)bad('fixture Git blob mismatch '+c.id);
 }
 return manifest;
}
