// This verifier checks a design-evidence manifest, never actual CI/guest origins.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const SHA = /^[0-9a-f]{40}$/;
const read = path => readFileSync(new URL('../../'+path, import.meta.url));
function blobSha(contents) {return createHash('sha1').update('blob '+contents.length+'\0').update(contents).digest('hex');}
export function assertDesignManifest(m, programContents) {
 assert.equal(m.schemaVersion,1);
 assert.equal(m.contract,'attolang.formal-actor-runtime-refinement.v1');
 assert.equal(m.evidenceLevel,'design-trace-shape-only');
 assert.deepEqual(m.verifiedCompilerGuestBackends,[]);
 assert.equal(m.traceVerifier,'formal/refinement-v1/replay.mjs');
 assert.equal(m.guestFixture.path,'formal/refinement-v1/reliable-join-receive.atto');
 assert.equal(m.guestFixture.status,'CANDIDATE_NOT_COMPILED');
 assert.equal(m.guestFixture.dialect,'suspends');
 assert.equal(m.guestFixture.expectedStdout,'subscribed|p-1');
 assert(SHA.test(m.guestFixture.gitBlobSha1));
 assert.equal(m.guestFixture.gitBlobSha1, blobSha(programContents),'fixture blob drift');
 assert(!programContents.toString('utf8').includes('pub async routine'), 'legacy async admitted');
 const knownHeads={actorCriticalGeneration:'36756f78d0b1a07c0733f32e8e45507ddb9b1582',panicControl:'c31a04e1d6c3ee70b4df2486cc2ee375e047b887',reliablePubsub:'1c18689718d6648b533685fcf3aa0886c33f619f',pubsubGeneration:'677344370305f1d90fbc987536d008de0af8c794'};
 const keys=['actorCriticalGeneration','panicControl','reliablePubsub','pubsubGeneration'];
 assert.deepEqual(Object.keys(m.relatedFormalPullRequests).sort(),keys.sort());
 assert.deepEqual(keys.map(k=>m.relatedFormalPullRequests[k].number).sort((a,b)=>a-b),[458,459,460,461]);
 assert(keys.every(k=>SHA.test(m.relatedFormalPullRequests[k].head) && m.relatedFormalPullRequests[k].head === knownHeads[k]), 'formal model heads not pinned');
 assert.equal(new Set(keys.map(k=>m.relatedFormalPullRequests[k].head)).size,4);
 assert.deepEqual([...m.scenarios].sort(),['critical-generation','panic-control','reliable-pubsub']);
 assert.deepEqual(Object.keys(m.backends).sort(),['forge','java','llvm','net','wasm']);
 assert(Object.values(m.backends).every(x=>x.status==='NOT_EXECUTED' &&
   x.guestCompiled===false && x.guestExecuted===false && x.executedSteps===0));
 assert(Array.isArray(m.requiredAuthentication) && m.requiredAuthentication.length>=6);
 assert.equal(new Set(m.requiredAuthentication).size,m.requiredAuthentication.length);
 assert(m.requiredAuthentication.every(x=>typeof x==='string'&&x.length>=15));
 assert(Array.isArray(m.notEstablishedByReplay) && m.notEstablishedByReplay.length>=5);
 assert.equal(m.mergeEligible,false);
 return {classification:'DESIGN_TRACE_SHAPE_ONLY',verifiedGuestBackends:0,cases:m.scenarios.length};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const m=JSON.parse(read('formal/refinement-v1/manifest.json'));
 console.log(JSON.stringify(assertDesignManifest(m,read(m.guestFixture.path))));
}
