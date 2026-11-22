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
  const sourceAudit=contract.source_parity_audit;
  if(!sourceAudit ||
     sourceAudit.status!=='SOURCE_ONLY_NORMALIZED_BODY_IDENTICAL_NO_EXECUTION' ||
     sourceAudit.active_compilers!==9 ||
     sourceAudit.expected_common_body_length!==6751)
    reject('source audit erroneously certified as guest parity');
  const pos=contract.borrow_mutability_positive;
  if(!pos || pos.id!=='val_mutable_referent_methods' ||
     pos.binding!=='val' ||
     pos.guest_execution!=='NOT_EXECUTED' ||
     pos.file!=='fixtures/std-time-parity-v1/borrow-positive-val-mutable-referent.atto' ||
     JSON.stringify(pos.expected_stdout)!==JSON.stringify(['1','true','true']) ||
     !SHA.test(pos.source_blob_sha) ||
     Object.hasOwn(pos,'pass') || Object.hasOwn(pos,'guest_result'))
    reject('positive val receiver candidate falsely promoted');
  const negatives=contract.borrow_mutability_negatives;
  const expectedBorrowIds=['immutable_manual_clock_advance','immutable_timer_poll',
    'immutable_interval_cancel'];
  if(contract.borrow_conformance_status!=='NOT_EXECUTED_ALL_ELEVEN_BACKENDS'||
     !Array.isArray(negatives)||negatives.length!==3||
     JSON.stringify(negatives.map(v=>v.id))!==JSON.stringify(expectedBorrowIds)||
     negatives.some(v=>v.expected!=='COMPILE_REJECT_MUTABLE_RECEIVER_REQUIRED'||
       v.guest_artifact!=='FORBIDDEN' ||
       !SHA.test(v.source_blob_sha) ||
       typeof v.file!=='string' ||
       !v.file.startsWith('fixtures/std-time-parity-v1/borrow-negative-')||
       Object.hasOwn(v,'execution_passed')))
    reject('borrow negative candidate falsely promoted');
  const pair=contract.java_llvm_same_source_guest_candidate;
  if(!pair ||
     pair.status!=='SOURCE_BLOB_IDENTICAL_GUEST_NOT_EXECUTED' ||
     pair.executable_guest_evidence!=='NOT_EXECUTED' ||
     !SHA.test(pair.identical_git_blob_sha) ||
     pair.expected_unique_pass_labels!==52 ||
     pair.expected_final_stdout_line!=='TIME-CONTRACT-DONE' ||
     pair.paths?.java!=='examples/atto-time-contract.atto' ||
     pair.paths?.llvm!=='examples/atto-time-contract.atto')
    reject('Java/LLVM same-source candidate falsely certified');
  const ids=contract.backends.map(b=>b.id);
  if(JSON.stringify(ids)!==JSON.stringify(BACKENDS))reject('missing, reordered or duplicated backend');
  if(!Array.isArray(contract.reference_vectors)||contract.reference_vectors.length!==28)
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
    if(backend.borrow_positive_guest_status!=='NOT_EXECUTED' ||
       backend.borrow_negative_compile_status!=='NOT_EXECUTED')
      reject('backend borrow evidence falsely promoted');
    if((backend.id==='java'||backend.id==='llvm') &&
       !SHA.test(backend.candidate_root_tree_sha))
      reject('current candidate root tree SHA invalid');
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
      return a<0n?'NegativeDuration':a*b>MAX?'DurationOverflow':(a*b).toString();
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
test('28 signed-i64 time references are independently checked with BigInt',()=>{
  for(const c of manifest.reference_vectors)assert.equal(reference(c),c.expected,c.id);
  assert.equal(manifest.reference_vectors.length,28);
  const units=['microseconds','milliseconds','seconds','minutes','hours'];
  for(const unit of units){
    const item=manifest.reference_vectors.find(v=>v.id===unit+'_negative');
    assert.ok(item,unit+' negative duration check missing');
    assert.equal(item.expected,'NegativeDuration');
    assert.equal(reference(item),'NegativeDuration');
  }
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
test('positive time guest has mutable receivers, three const-receiver negatives require compiler rejection',()=>{
  assert.match(guest,/let mut manual = time\.manual_clock\(/);
  assert.match(guest,/let mut one_shot = time\.one_shot\(/);
  assert.match(guest,/let mut every = time\.interval\(/);
  const required=[
    ['immutable_manual_clock_advance','clock','clock.advance('],
    ['immutable_timer_poll','timer','timer.poll('],
    ['immutable_interval_cancel','repeat','repeat.cancel(']
  ];
  for(const [id,receiver,call] of required){
    const vector=manifest.borrow_mutability_negatives.find(v=>v.id===id);
    assert.ok(vector,'missing borrow vector '+id);
    assert.equal(vector.receiver,receiver);
    const relative=vector.file.replace(/^fixtures\//,'');
    const source=readFileSync(new URL('../fixtures/'+relative,import.meta.url),'utf8');
    assert.match(source,/import module time from "std\/time";/);
    assert.ok(source.includes('const '+receiver+' = time.'),id+': missing immutable-referent binding');
    assert.ok(source.includes(call),id+': missing mutable receiver call');
    assert.doesNotMatch(source,new RegExp('let mut '+receiver+'\\b'),
      id+': negative fixture accidentally grants mutable borrow');
    assert.equal(vector.expected,'COMPILE_REJECT_MUTABLE_RECEIVER_REQUIRED');
    assert.equal(vector.guest_artifact,'FORBIDDEN');
  }
  const positive=readFileSync(new URL(
    '../fixtures/std-time-parity-v1/borrow-positive-val-mutable-referent.atto',
    import.meta.url),'utf8');
  assert.match(positive,/import module time from "std\/time";/);
  for(const [name,call] of [['clock','clock.advance('],
    ['timer','timer.poll('],['repeating','repeating.cancel(']]){
    assert.ok(positive.includes('val '+name+' = time.'),'val const-mut source binding '+name);
    assert.ok(positive.includes(call),'mut self call on val '+name);
  }
  assert.deepEqual(manifest.borrow_mutability_positive.expected_stdout,['1','true','true']);
  assert.equal(manifest.borrow_mutability_positive.guest_execution,'NOT_EXECUTED');
  assert.equal(manifest.borrow_conformance_status,'NOT_EXECUTED_ALL_ELEVEN_BACKENDS');
});

test('mutants cannot promote a host test, zero-step run or scaffold to guest success',()=>{
  const mutate=(fn,pattern)=>{
    const copy=structuredClone(manifest);fn(copy);
    assert.throws(()=>validCandidate(copy),pattern);
  };
  mutate(c=>c.backends[2].borrow_positive_guest_status='PASSED',
    /backend borrow evidence falsely promoted/);
  mutate(c=>c.backends[3].borrow_negative_compile_status='PASSED',
    /backend borrow evidence falsely promoted/);
  mutate(c=>c.source_parity_audit.status='GUEST_VERIFIED',
    /source audit erroneously certified as guest parity/);
  mutate(c=>c.borrow_mutability_negatives[0].source_blob_sha='not-a-sha',
    /borrow negative candidate falsely promoted/);
  mutate(c=>c.borrow_mutability_positive.guest_execution='PASSED',
    /positive val receiver candidate falsely promoted/);
  mutate(c=>c.borrow_mutability_positive.expected_stdout[0]='42',
    /positive val receiver candidate falsely promoted/);
  mutate(c=>c.borrow_conformance_status='PASSED',
    /borrow negative candidate falsely promoted/);
  mutate(c=>c.borrow_mutability_negatives[1].execution_passed=true,
    /borrow negative candidate falsely promoted/);
  mutate(c=>c.borrow_mutability_negatives[0].expected='ACCEPT',
    /borrow negative candidate falsely promoted/);
  mutate(c=>c.java_llvm_same_source_guest_candidate.executable_guest_evidence='PASSED',
    /same-source candidate falsely certified/);
  mutate(c=>c.java_llvm_same_source_guest_candidate.expected_unique_pass_labels=0,
    /same-source candidate falsely certified/);
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
