import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../fixtures/std-time-parity-v1/cases.json',import.meta.url),'utf8'));
const guest=readFileSync(new URL('../fixtures/std-time-parity-v1/manual-deadline.atto',import.meta.url),'utf8');
const BACKENDS=['java','llvm','net','wasm','forge','rs','cranelift','js','hdl','atto','realtime'];
const MAX=(1n<<63n)-1n;
const SHA=/^[0-9a-f]{40}$/;
const reject=(reason)=>{throw new Error(reason);};

function validCandidate(contract) {
  if(contract?.schema!=='atto.std-time.eleven-backend-candidate.v1'||
     contract.status!=='CANDIDATE_NOT_GUEST_VERIFIED'||
     !Array.isArray(contract.backends) || contract.backends.length!==11)
    reject('invalid candidate envelope');
  const ids=contract.backends.map(b=>b.id);
  if(JSON.stringify(ids)!==JSON.stringify(BACKENDS))reject('missing, reordered or duplicated backend');
  if(!Array.isArray(contract.reference_vectors)||contract.reference_vectors.length!==23)
    reject('missing checked nanosecond vectors');
  if(!Array.isArray(contract.guest_expected_stdout)||
     contract.guest_expected_stdout.length!==12||
     contract.guest_expected_stdout.some(v=>typeof v!=='string'))
    reject('invalid guest output oracle');
  const seen=new Set();
  for(const c of contract.reference_vectors) {
    if(!c||typeof c.id!=='string'||seen.has(c.id)||typeof c.expected!=='string')
      reject('duplicate or malformed reference vector');
    seen.add(c.id);
  }
  for(const backend of contract.backends) {
    if(backend.repo!==`atto-lang/atto-source.${backend.id}`||
       backend.guest_execution!=='NOT_EXECUTED' ||
       backend.full_tree_verified!==false ||
       backend.compiler_artifact_verified!==false ||
       Object.hasOwn(backend,'pass') || Object.hasOwn(backend,'guest_result'))
      reject('unverified backend is falsely promoted');
    if(backend.id==='atto'||backend.id==='realtime') {
      if(backend.target_profile!=='BOOTSTRAP_ONLY' ||
         Object.hasOwn(backend,'source_head_sha')||
         Object.hasOwn(backend,'implementation_pr'))
        reject('bootstrap backend falsely advertises executable compiler');
      continue;
    }
    if(!SHA.test(backend.source_head_sha)||!SHA.test(backend.library_blob_sha)||
       !Number.isInteger(backend.implementation_pr)||backend.implementation_pr<1 ||
       backend.library_path!==(backend.id==='java'?'stdlib/time.atto':'stdlib/std/time.atto'))
      reject('invalid exact candidate source identity');
    if(backend.id==='hdl' &&
       backend.target_profile!=='DETERMINISTIC_HARDWARE_SUBSET_TARGET')
      reject('hardware source falsely advertises OS-clock support');
  }
  return true;
}

function reference(v) {
  const bi=x=>BigInt(x);
  let a,b;
  switch(v.kind) {
    case 'ceil_ms':
      a=bi(v.ns);
      return (a/1000000n+(a%1000000n===0n?0n:1n)).toString();
    case 'scaled_ns':
      a=bi(v.amount);b=bi(v.unit_ns);
      return a<0n||a*b>MAX?'DurationOverflow':(a*b).toString();
    case 'nonnegative_ns':
      a=bi(v.ns);
      return a<0n?'NegativeDuration':a>MAX?'DurationOverflow':a.toString();
    case 'checked_add':
      a=bi(v.left);b=bi(v.right);
      return a+b>MAX?'DurationOverflow':(a+b).toString();
    case 'checked_sub':
      a=bi(v.left);b=bi(v.right);
      return a<b?'DurationUnderflow':(a-b).toString();
    case 'duration_since':
      if(v.later_clock!==v.earlier_clock)return 'ClockDomainMismatch';
      a=bi(v.later);b=bi(v.earlier);
      return a<b?'ClockWentBackwards':(a-b).toString();
    case 'expired':
      return String(bi(v.now)>=bi(v.due));
    case 'interval_next_due':
      a=bi(v.now);b=bi(v.period);
      return a+b>MAX?'IntervalRangeExhausted':(a+b).toString();
    default:reject('unknown time vector '+v.kind);
  }
}

test('all eleven compiler backends are tracked but none receives fake guest PASS',()=>{
  assert.equal(validCandidate(manifest),true);
  assert.deepEqual(manifest.backends.map(x=>x.id),BACKENDS);
  assert.equal(manifest.backends.filter(x=>x.implementation_pr).length,9);
  assert.equal(manifest.backends.filter(x=>x.target_profile==='BOOTSTRAP_ONLY').length,2);
  assert.ok(manifest.forbidden_claims.includes('cross_org_private_export_without_independent_approval'));
});
test('23 signed-i64 time references are independently checked with BigInt',()=>{
  for(const c of manifest.reference_vectors)assert.equal(reference(c),c.expected,c.id);
  assert.equal(manifest.reference_vectors.length,23);
});
test('portable guest fixture has independent 12-line output and explicit .atto import',()=>{
  assert.match(guest,/import module time from "std\/time";/);
  assert.match(guest,/pub routine main\(\): void/);
  assert.match(guest,/\.as_ms_ceil\(\)/);
  assert.match(guest,/manual\.advance\(half\)/);
  assert.match(guest,/time\.deadline_after\(/);
  assert.match(guest,/time\.one_shot\(/);
  assert.match(guest,/time\.interval\(/);
  assert.deepEqual(manifest.guest_expected_stdout,[
    '1','2','true','true','true','true','false','1500000000','true','true','false','1500000000'
  ]);
  assert.doesNotMatch(guest,/Thread\.sleep|setTimeout|process\.monotonic|java:/);
});
test('mutants cannot promote a host test, zero-step run or scaffold to guest success',()=>{
  const mutate=(fn,pattern)=>{
    const copy=structuredClone(manifest);fn(copy);
    assert.throws(()=>validCandidate(copy),pattern);
  };
  mutate(c=>c.backends[0].guest_execution='PASSED',/falsely promoted/);
  mutate(c=>c.backends[0].full_tree_verified=true,/falsely promoted/);
  mutate(c=>c.backends[0].compiler_artifact_verified=true,/falsely promoted/);
  mutate(c=>c.backends[0].pass=true,/falsely promoted/);
  mutate(c=>c.backends[0].library_blob_sha='0'.repeat(39),/identity/);
  mutate(c=>c.backends[0].library_path='../time.atto',/identity/);
  mutate(c=>c.backends[10].source_head_sha='a'.repeat(40),/bootstrap backend/);
  mutate(c=>c.backends[8].target_profile='HOSTED_OR_NATIVE_TARGET',/hardware/);
  mutate(c=>c.backends.pop(),/envelope/);
  mutate(c=>c.backends[1].id='java',/missing, reordered or duplicated/);
  mutate(c=>c.reference_vectors[0].id=c.reference_vectors[1].id,/duplicate or malformed/);
});
