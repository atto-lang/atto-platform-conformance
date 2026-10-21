import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROFILES} from './platforms.mjs';
import {BACKENDS,CASES} from './differential.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=s=>{throw Error('wave6-manifest: '+s)};
function exact(o,k){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).length!==k.length||k.some(x=>!Object.hasOwn(o,x)))fail('invalid object schema')}
const git=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const sha=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const TASKS=Object.freeze(['mobile-app-native-aot','embedded-source-firmware','iot-secure-gateways','desktop-distribution','differential-release-certification']);
const files=['scalar-42.ores','actor-state-read.ores','actor-state-loan-escape-reject.ores'];
const pinnedBlobs=['015f8b0f79aafa796a148d2adeff1574e8d6c491','a7d2e367fb4cc8f0bd3f59fa58c046c16b84dd74','bcbd630e455855773e1411eddd6dfa984c8452bc'];
const pinnedHashes=['08a415734e9992f47702dc9b1ccf2c5dceb74df05245eaa5fbb00512d18afc8a','62a535aa462a90d0398fedf0441c35638968f02bc6968a78d5c44de2fc90ef03','324d5a628c88bc495012c32a4682ecb472e0c3f86d36b49d067055f9bb528f4b'];
export function validate(m){
 exact(m,['schemaVersion','wave','status','certifiedParity','tasks','profiles','backends','cases','fixtures','evidenceRequirements']);
 if(m.schemaVersion!==1||m.wave!==6||m.status!=='unverified-cross-platform-release-gates'||m.certifiedParity!==false)fail('unsupported manifest / parity claim');
 if(!Array.isArray(m.tasks)||m.tasks.length!==5)fail('task count');
 for(let i=0;i<5;i++){const t=m.tasks[i];exact(t,['id','name','goal','verified']);if(t.id!==i+26||t.name!==TASKS[i]||t.verified!==false||typeof t.goal!=='string'||t.goal.length<25)fail('task identity/claim changed')}
 if(JSON.stringify(m.profiles)!==JSON.stringify(Object.keys(PROFILES))||JSON.stringify(m.backends)!==JSON.stringify(BACKENDS)||JSON.stringify(m.cases)!==JSON.stringify(CASES))fail('profiles or source backends changed');
 if(!Array.isArray(m.fixtures)||m.fixtures.length!==3)fail('source fixture count');
 for(let i=0;i<files.length;i++){const f=m.fixtures[i];exact(f,['file','gitBlob','sha256','status']);if(f.file!==files[i]||!git(f.gitBlob)||!sha(f.sha256)||f.gitBlob!==pinnedBlobs[i]||f.sha256!==pinnedHashes[i]||f.status!=='UNEXECUTED')fail('invalid or promoted source fixture')}
 if(!Array.isArray(m.evidenceRequirements)||m.evidenceRequirements.length!==6||m.evidenceRequirements.some(x=>typeof x!=='string'||x.length<15))fail('incomplete proof requirements');
 return m;
}
export async function load(){
 const path=resolve(root,'manifest.json'),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())fail('unsafe manifest path');
 const m=validate(JSON.parse(await readFile(path,'utf8')));
 for(const f of m.fixtures){const path=resolve(root,'fixtures',f.file),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())fail('unsafe source fixture');
  const data=await readFile(path),blob=createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex'),digest=createHash('sha256').update(data).digest('hex');
  if(blob!==f.gitBlob||digest!==f.sha256)fail('source fixture bytes mismatch '+f.file);
 }
 return m;
}
