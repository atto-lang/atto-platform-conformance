// Untrusted trace-bundle *shape* intake. Never emits a compiler/CI attestation.
// Input traces may be synthetic, fabricated, or reordered. Real source-org job
// authentication must be done independently with provider read-back.
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayDesignTrace} from './replay.mjs';
import {assertDesignManifest} from './check-manifest.mjs';

const BACKENDS=new Set(['java','llvm','net','wasm','forge']);
const SCENARIOS=['critical-generation','panic-control','reliable-pubsub'];
const SOURCE_BLOB='fe10d9e5018a3f030a10bc31586e851198aaa4a3';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function check(ok,why){if(!ok)throw new Error('UNTRUSTED_TRACE_INTAKE_REJECTED: '+why);}
function exact(obj,fields,label){
  check(object(obj),label+' must be plain object');
  const names=Reflect.ownKeys(obj);
  check(names.length===fields.length&&fields.every(k=>names.includes(k)&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(obj,k),'value')),
    label+' unexpected, accessor, or missing fields');
}
function blobSha(bytes){
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
export function inspectUntrustedGuestTraceBundle(bundle,{manifest,fixtureBytes}){
  // This function deliberately cannot return `EXECUTED`, `ATTESTED`, or `PASSED`.
  check(Buffer.isBuffer(fixtureBytes)&&fixtureBytes.length>0&&fixtureBytes.length<=131072,
    'missing or oversized source bytes');
  check(blobSha(fixtureBytes)===SOURCE_BLOB,'candidate fixture byte identity');
  check(object(manifest),'missing design manifest');
  assertDesignManifest(manifest,fixtureBytes);
  exact(bundle,['schema','backend','fixtureBlobSha','traces'],'trace bundle');
  check(bundle.schema==='attolang.formal.untrusted-trace-bundle.v1','bundle schema');
  check(BACKENDS.has(bundle.backend),'backend identifier');
  check(bundle.fixtureBlobSha===SOURCE_BLOB,'bundle fixture identity');
  check(Array.isArray(bundle.traces)&&bundle.traces.length===SCENARIOS.length,
    'must include every bounded scenario exactly once');
  const names=new Set();
  const accepted=[];
  for(const entry of bundle.traces){
    // Never trust a scenario name alone; the existing replay validates events.
    check(object(entry)&&typeof entry.scenario==='string'&&SCENARIOS.includes(entry.scenario),
      'unknown scenario');
    check(!names.has(entry.scenario),'duplicated scenario');
    names.add(entry.scenario);
    const result=replayDesignTrace(entry);
    check(result.classification==='DESIGN_TRACE_SHAPE_ONLY'&&
      result.traceShapeValid===true&&result.compiledGuestAuthenticated===false&&
      result.runtimeAuthenticated===false&&result.fiveBackendParity===false&&
      result.mergerReady===false,'replay returned promoting claims');
    accepted.push(entry.scenario);
  }
  check(SCENARIOS.every(x=>names.has(x)),'missing scenario');
  return Object.freeze({
    classification:'UNAUTHENTICATED_TRACE_SHAPE_ONLY',
    backend:bundle.backend,
    candidateSourceBlob:SOURCE_BLOB,
    designScenariosChecked:accepted.length,
    sourceOrgRunnerAuthenticated:false,
    compiledGuestAuthenticated:false,
    runtimeAuthenticated:false,
    fiveBackendParity:false,
    mergeEligible:false
  });
}
const current=process.argv[1]?resolve(process.argv[1]):null;
if(current&&current===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=='--trace-file'){
    process.stderr.write('Usage: node guest-trace-intake.mjs --trace-file path.json\n');
    process.exitCode=2;
  } else {
    try{
      const pathname=resolve(process.argv[3]);
      check(statSync(pathname).size<=65536,'trace file too large');
      const traces=JSON.parse(readFileSync(pathname,'utf8'));
      const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
      const fixtureBytes=readFileSync(new URL('./reliable-join-receive.atto',import.meta.url));
      process.stdout.write(JSON.stringify(inspectUntrustedGuestTraceBundle(traces,{manifest,fixtureBytes}))+'\n');
    }catch(e){
      process.stderr.write(String(e.message||e)+'\n');
      process.exitCode=1;
    }
  }
}
