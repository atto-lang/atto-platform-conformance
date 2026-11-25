import fs from 'node:fs';
const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
function check(a,c,e){
 const problems=[],names=["java","llvm","net","wasm","forge","cranelift","js","rs","hdl"],five=names.slice(0,5),steps=["sourceAdmission","semanticCompile","guestExecution","actorIsolation","nativeAot"],sha=/^[0-9a-f]{40}$/;
 if(a?.contract!=="singleton-all-source-admission-v1"||a?.schemaVersion!==1)problems.push("id");
 if(a?.keyword!=="singleton"||a?.declaration!=="define singleton"||a?.identityScope!=="application-domain")problems.push("semantics");
 if(a?.canonicalFive!=="contracts/singleton-shared-state-v1.json"||a?.canonicalEvidence!=="evidence/singleton-shared-state-v1.json")problems.push("canonical refs");
 if(a?.freshness!=="SNAPSHOT_ONLY"||a?.claim!=="NOT_CERTIFIED"||a?.conformant!==false)problems.push("false certification");
 if(c?.contract!=="singleton-shared-state-v1"||c?.scenarios?.length!==20||c?.semantics?.singletonIdentityScope!=="application-domain")problems.push("canonical cases");
 if(JSON.stringify([...(c?.backendTargets||[])].sort())!==JSON.stringify([...five].sort())||e?.conformant!==false)problems.push("five target scope");
 if(!Array.isArray(a?.backends)||a.backends.length!==9)return [...problems,"nine backend count"];
 const seen=a.backends.map(x=>x.name);
 if(new Set(seen).size!==9||JSON.stringify([...seen].sort())!==JSON.stringify([...names].sort()))problems.push("backend set");
 for(const b of a.backends){
  if(!sha.test(b.mainSha??"")||!sha.test(b.blobSha??""))problems.push(b.name+": invalid SHA");
  if(typeof b.frontend!=="string"||!b.frontend.length)problems.push(b.name+": missing frontend");
  if(b.role!==(five.includes(b.name)?"canonical-five":"additional"))problems.push(b.name+": role");
  if(Object.keys(b.stages??{}).length!==5||steps.some(s=>b.stages?.[s]!=="NOT_EXECUTED"))problems.push(b.name+": stages not executed");
  if(!Array.isArray(b.guestCaseIds)||b.guestCaseIds.length||b.certification!=="NOT_CERTIFIED")problems.push(b.name+": fake guest claim");
 }
 for(const n of five)if((e?.backends?.[n]?.executedCaseIds??[]).length)problems.push(n+": canonical guest claim not attested by this inventory");
 return problems;
}
const inventory=read('contracts/singleton-all-source-admission-v1.json');
const contract=read('contracts/singleton-shared-state-v1.json');
const evidence=read('evidence/singleton-shared-state-v1.json');
const problems=check(inventory,contract,evidence);
if(problems.length){for(const p of problems)console.error('ERROR:',p);process.exit(1)}
const clone=x=>JSON.parse(JSON.stringify(x));
const mutations=[
 x=>x.backends.pop(),x=>x.backends[0].mainSha='abc',x=>x.backends[0].stages.guestExecution='PASS',
 x=>x.backends[0].guestCaseIds.push('fake'),x=>x.backends[0].name='net',
 x=>x.claim='CERTIFIED',x=>x.freshness='CURRENT',x=>x.identityScope='process-global',
 x=>x.backends[5].role='canonical-five',x=>x.backends[0].blobSha='bad'
];
mutations.forEach((f,i)=>{const a=clone(inventory);f(a);if(!check(a,contract,evidence).length)throw Error('unrejected adversarial mutation '+i)});
console.log('PASS: 9-backend singleton structural snapshot; 10 adversarial mutations rejected; guest execution NOT_CERTIFIED');
