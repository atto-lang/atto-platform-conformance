/**
 * Parses untrusted, claimed compiled-guest DATA mailbox trace envelopes.
 * A declaration about a run is NEVER authentication of a real compiler,
 * runtime execution, GitHub Actions job, or guest instrumentation.
 */
import {checkMailboxLinearizability} from './mailbox-linearizability-v1.mjs';

const MODES={java:'GRAALVM_GUEST',llvm:'LLVM_NATIVE',wasm:'WASM_GUEST',
  net:'DOTNET_NATIVE_AOT',forge:'FORGE_NATIVE'};
const REPO_SUFFIX={java:'oreslang-source.java',llvm:'oreslang-source.llvm',
  wasm:'oreslang-source.wasm',net:'oreslang-source.net',forge:'oreslang-source.forge'};
const FIXTURES={
  ACTOR_SEND_STOP:'3050260bd65b019a2b00191fba9086971409511b',
  ACTOR_INTERLEAVED_STOP:'c7488835f34e926dfa4c8766c8917301fe84da09'
};
const BAD=msg=>{throw new Error('INVALID_GUEST_MAILBOX_TRACE: '+msg);};
const isObject=o=>o!==null && typeof o==='object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o)===Object.prototype || Object.getPrototypeOf(o)===null);
function exact(obj,keys){
  if(!isObject(obj)||Reflect.ownKeys(obj).some(k=>typeof k!=='string'||!keys.includes(k)))
    BAD('unexpected or unsafe envelope fields');
  for(const k of keys) if(!Object.hasOwn(obj,k)) BAD('missing '+k);
}
const SHA1=/^[a-f0-9]{40}$/, SHA256=/^[a-f0-9]{64}$/;
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>=1;

export function auditClaimedGuestMailboxTrace(envelope){
  exact(envelope,['schema','backend','fixtureId','fixtureGitBlobSha','run','actors']);
  if(envelope.schema!=='oreslang.claimed_guest_mailbox_trace.v1')BAD('schema');
  const b=envelope.backend;
  if(!Object.hasOwn(MODES,b))BAD('unsupported backend');
  if(!Object.hasOwn(FIXTURES,envelope.fixtureId)||
      envelope.fixtureGitBlobSha!==FIXTURES[envelope.fixtureId])
    BAD('unknown or unpinned fixture');
  const run=envelope.run;
  exact(run,['repository','headSha','treeSha','compilerSha256','executionMode',
    'runId','jobId','stepsExecuted','compiledGuest','guestExecuted','logSha256']);
  if(run.repository!=='ores-truffle-oreslang/'+REPO_SUFFIX[b] ||
      run.executionMode!==MODES[b])BAD('repository or execution mode mismatch');
  if(!SHA1.test(run.headSha)||!SHA1.test(run.treeSha)||
      !SHA256.test(run.compilerSha256)||!SHA256.test(run.logSha256))
    BAD('invalid immutable provenance hash');
  if(!positive(run.runId)||!positive(run.jobId)||!positive(run.stepsExecuted)||
      run.compiledGuest!==true||run.guestExecuted!==true)
    BAD('absent claimed native-guest step execution');
  if(!Array.isArray(envelope.actors)||!envelope.actors.length||
      envelope.actors.length>4)BAD('bounded actors required');
  const actorIds=new Set();
  const results=[];
  for(const a of envelope.actors){
    exact(a,['actorId','incarnation','history']);
    if(!id(a.actorId)||actorIds.has(a.actorId)||!positive(a.incarnation))
      BAD('invalid or duplicated actor identity');
    actorIds.add(a.actorId);
    let result;
    try{result=checkMailboxLinearizability(a.history);}
    catch(e){BAD('malformed actor history: '+String(e.message||e));}
    results.push({actorId:a.actorId,incarnation:a.incarnation,
      status:result.status,witness:result.witness,explored:result.explored});
  }
  return {
    schema:'oreslang.guest_mailbox_shape_audit.v1',
    status:results.some(x=>x.status==='NOT_LINEARIZABLE')?'MODEL_REFINEMENT_CONFLICT_CANDIDATE':
      results.some(x=>x.status==='INCONCLUSIVE')?'BOUNDED_CHECK_INCONCLUSIVE':
      'HISTORY_SHAPE_LINEARIZABLE',
    classification:'UNTRUSTED_SELF_REPORTED_NATIVE_TRACE_SHAPE_ONLY',
    modelResults:results,
    compilerExecutedAuthenticated:false,
    guestExecutedAuthenticated:false,
    nativeExecutionAuthenticated:false,
    parityCertified:false,
    releaseReady:false,
    separateChecksRequired:['source_run_authentication','physical_task_quiescence',
      'supervisor_control_priority','generation_fencing','borrow_and_arena_lifetime']
  };
}
