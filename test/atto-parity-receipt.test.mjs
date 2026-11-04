import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParityReceipt, validateScalarParityReceipt } from '../src/atto-parity-receipt.mjs';
const h = 'a'.repeat(40), d = 'b'.repeat(64), a = 'c'.repeat(64);
const v1 = () => ({schema:'attolang.parity-receipt/1',backend:'java',head_sha:h,tree_sha:h,compiler:'javac',compiler_sha256:d,run_id:1,run_attempt:1,executed_steps:4,job_conclusion:'success',cases:[{id:'returns_42',source_sha256:d,kind:'positive',compile_exit:0,executed:true,run_exit:0,stdout:'42\n',expected_stdout:'42\n'},{id:'unknown_symbol',source_sha256:d,kind:'negative',compile_exit:1,executed:false,diagnostic:'unknown symbol'}]});
const v2 = () => ({schema:'attolang.parity-receipt/2',backend:'llvm',head_sha:h,tree_sha:h,compiler:'oreslang-llvmc',compiler_sha256:d,run_id:2,run_attempt:1,executed_steps:6,job_conclusion:'success',cases:[{id:'returns_42',source_sha256:d,kind:'positive',compile_exit:0,artifact_sha256:a,executed:true,result_i64:'42',expected_i64:'42',result_channel:'native-return'},{id:'checked_overflow',source_sha256:d,kind:'negative',compile_exit:0,artifact_sha256:a,executed:true,failure_stage:'runtime',runtime_outcome:'trap',diagnostic:'checked overflow'},{id:'unknown_symbol',source_sha256:d,kind:'negative',compile_exit:1,executed:false,failure_stage:'compile',diagnostic:'unknown symbol'}]});

test('v1 preserves its legacy return shape',()=>assert.deepEqual(validateParityReceipt(v1()),{consistent:true,authenticity_attested:false,publicly_promotable:false,backend:'java',case_count:2}));
test('v1 cannot satisfy scalar-core validation',()=>assert.throws(()=>validateScalarParityReceipt(v1()),/scalar core requires receipt v2/));
test('generic v2 represents typed result plus compile and runtime negatives',()=>assert.equal(validateParityReceipt(v2()).case_count,3));
test('generic v2 is insufficient for the 19-case scalar profile',()=>assert.throws(()=>validateScalarParityReceipt(v2()),/complete canonical case set/));

const scalarCase = (id,source,kind,extra) => ({
  id, source_sha256:source, kind, compile_exit: kind==='positive' ? 0 : 1,
  ...(kind==='positive'
    ? {artifact_sha256:a,executed:true,result_channel:'native-return',...extra}
    : {executed:false,failure_stage:'compile',diagnostic:'expected rejection',...extra})
});
const scalar = () => ({schema:'attolang.parity-receipt/2',backend:'llvm',head_sha:h,tree_sha:h,
  compiler:'oreslang-llvmc',compiler_sha256:d,run_id:7,run_attempt:1,executed_steps:5,
  job_conclusion:'success',cases:[
    scalarCase('canonical-add','08a415734e9992f47702dc9b1ccf2c5dceb74df05245eaa5fbb00512d18afc8a','positive',{result_i64:'42',expected_i64:'42'}),
    scalarCase('precedence','0dedccfdeff013995e1e5d784bf1767acf61b0c0485fa50aba6aa9dd473331f2','positive',{result_i64:'14',expected_i64:'14'}),
    scalarCase('parentheses','730d7fe277125aa17abadaea1222d867fcc9e97fbd7f5b0af1f95da862857ade','positive',{result_i64:'20',expected_i64:'20'}),
    scalarCase('signed-minimum','8b5b69ec25fda12bd6a695c7a2ab986634bcbf37f8b129507582597e662c0b49','positive',{result_i64:'-9223372036854775808',expected_i64:'-9223372036854775808'}),
    scalarCase('signed-max-minus-one','d27086270301951421718bcf3c82d5fe988b5dd076d43153f3aed3a6bebb7c99','positive',{result_i64:'9223372036854775806',expected_i64:'9223372036854775806'}),
    scalarCase('type-first-readonly','723e8163a685eaf1bb5c1a958430719dadc72ce23624960e88c50c0538045ee7','positive',{result_i64:'42',expected_i64:'42'}),
    scalarCase('typed-const-readonly','d97b7e9d1b39f3dbe38b09fecf1336a1902bdb8dc1526d6718df5740248a0e99','positive',{result_i64:'42',expected_i64:'42'}),
    scalarCase('inferred-const-readonly','0fd0d878d29431433ab57c65f7234b8b7cf0125d2e0cd587bb9de1bf827c56cd','positive',{result_i64:'42',expected_i64:'42'}),
    scalarCase('pure-call','05fd54126d6c2a630a430d0d4a38c01ae589d04b745da00597f02a2a63ee9d1e','positive',{result_i64:'42',expected_i64:'42'}),
    scalarCase('type-first-parameter','2b06a5d5f53a6b551d7f7bf1ff03c8515dbadb2bc76aba9198e77c8a1bb0ae3e','positive',{result_i64:'42',expected_i64:'42'}),
    scalarCase('checked-add-overflow','f1707d7b751858fe61bac9c13e68deca63f6dfa12305a9e51ad44d214b78b74d','negative',{}),
    scalarCase('checked-sub-overflow','cc8c26829b910c376d8b242da5cc3831f594a5ac883805e0e5a13f1b6dcd78f1','negative',{}),
    scalarCase('checked-mul-overflow','65e6807353a4a6f8c1a37a5e56ed3ac5b5da5fc20c36b1ca38db51c8c36e0e58','negative',{}),
    scalarCase('type-first-reassignment','dc5950e366fbf7189fc95693f6cb05abd4f1998ca5646f57edfd786110e4b293','negative',{}),
    scalarCase('typed-const-reassignment','3fc7f33d994509c2cda3ec8a98a91516ef9b8ac9d8eb660008ae79b96ef04c50','negative',{}),
    scalarCase('eager-unused-overflow','0fd9c69e25455c9cd716c692b676a97fedc5e25093bbd1bc8386eb7de792f70a','negative',{}),
    scalarCase('removed-modulo','aeecb295613d331f6decbb83707b62813f11b1d91f226a1ee81177e5a26ba838','negative',{}),
    scalarCase('removed-caret','0d2b65e35fe88d01c0f5881bc0b8bb3f20a145ae7d5a09719fb79f959089ce2b','negative',{}),
    scalarCase('removed-double-caret','0032984d2f6463a82d85e4fd3025741dfbdb52ce2fdb96c727e82ccb262cfa09','negative',{})
  ]});

test('complete canonical scalar v2 receipt validates but remains non-promoting',()=>{
  const result=validateScalarParityReceipt(scalar());
  assert.equal(result.case_count,19);
  assert.equal(result.scalar_core_eligible,true);
  assert.equal(result.publicly_promotable,false);
});

for(const [name,mutate] of [
 ['missing positive artifact',r=>delete r.cases[0].artifact_sha256],
 ['bad positive artifact digest',r=>r.cases[0].artifact_sha256='bad'],
 ['missing runtime-negative artifact',r=>delete r.cases[1].artifact_sha256],
 ['compile-negative claims artifact',r=>r.cases[2].artifact_sha256=a],
 ['typed mismatch',r=>r.cases[0].result_i64='41'],
 ['noncanonical i64',r=>r.cases[0].result_i64='+42'],
 ['i64 overflow',r=>r.cases[0].result_i64='9223372036854775808'],
 ['unknown result channel',r=>r.cases[0].result_channel='magic'],
 ['positive failure stage',r=>r.cases[0].failure_stage='runtime'],
 ['runtime negative did not execute',r=>r.cases[1].executed=false],
 ['runtime negative compile failed',r=>r.cases[1].compile_exit=1],
 ['runtime negative claims return',r=>r.cases[1].runtime_outcome='returned'],
 ['compile negative executed',r=>r.cases[2].executed=true],
 ['compile negative accepted',r=>r.cases[2].compile_exit=0],
 ['compile negative has runtime outcome',r=>r.cases[2].runtime_outcome='trap'],
 ['missing negative stage',r=>delete r.cases[1].failure_stage],
 ['missing negative diagnostic',r=>delete r.cases[1].diagnostic],
 ['zero steps',r=>r.executed_steps=0],
 ['failed job',r=>r.job_conclusion='failure'],
 ['duplicate case',r=>r.cases.push({...r.cases[0]})]
]) test('v2 rejects '+name,()=>{const r=v2();mutate(r);assert.throws(()=>validateScalarParityReceipt(r),/parity receipt rejected/)});

test('scalar profile rejects a substituted source even with valid receipt shape',()=>{
  const r=v2();
  r.cases=Array.from({length:19},(_,i)=>({...r.cases[0],id:'case_'+i}));
  assert.throws(()=>validateScalarParityReceipt(r),/canonical scalar case|case ID|complete canonical case set/);
});

test('generic v2 never self-promotes into scalar-core eligibility',()=>{
  const result=validateParityReceipt(v2());
  assert.equal(Object.hasOwn(result,'scalar_core_eligible'),false);
});
test('process exit cannot pretend to carry a full-width i64',()=>{
  const r=v2();
  r.cases[0].result_channel='process-exit';
  r.cases[0].result_i64='9223372036854775806';
  r.cases[0].expected_i64='9223372036854775806';
  assert.throws(()=>validateParityReceipt(r),/process-exit cannot carry/);
});

test('scalar checked overflow may be proven by an executed runtime trap',()=>{
  const r=scalar();
  const c=r.cases.find(x=>x.id==='checked-add-overflow');
  c.compile_exit=0;
  c.artifact_sha256=a;
  c.executed=true;
  c.failure_stage='runtime';
  c.runtime_outcome='trap';
  assert.equal(validateScalarParityReceipt(r).case_count,19);
});
test('scalar removed operator cannot be reclassified as a runtime negative',()=>{
  const r=scalar();
  const c=r.cases.find(x=>x.id==='removed-modulo');
  c.compile_exit=0;
  c.artifact_sha256=a;
  c.executed=true;
  c.failure_stage='runtime';
  c.runtime_outcome='trap';
  assert.throws(()=>validateScalarParityReceipt(r),/invalid failure stage for removed-modulo/);
});
test('scalar canonical ID with substituted bytes is rejected',()=>{
  const r=scalar();
  r.cases.find(x=>x.id==='canonical-add').source_sha256=d;
  assert.throws(()=>validateScalarParityReceipt(r),/canonical source mismatch for canonical-add/);
});

test('process-exit value must be bound to the observed exit status',()=>{
  const r=v2();
  r.cases[0].result_channel='process-exit';
  // A receipt may not claim exit=42 solely from its self-reported result.
  assert.throws(()=>validateParityReceipt(r),/observed exit status/);
  r.cases[0].run_exit=41;
  assert.throws(()=>validateParityReceipt(r),/observed exit status/);
  r.cases[0].run_exit=42;
  assert.equal(validateParityReceipt(r).case_count,3);
});

test('typed i64 receipt text has a finite 20-character admission budget',()=>{
  for (const numeral of ['9'.repeat(100_000),'-'+'0'.repeat(100_000), '0'.repeat(100_000)]) {
    const r=v2();
    r.cases[0].result_i64=numeral;
    assert.throws(()=>validateParityReceipt(r),/positive i64 result/);
    r.cases[0].result_i64='42';
    r.cases[0].expected_i64=numeral;
    assert.throws(()=>validateParityReceipt(r),/expected i64 result/);
  }
  const r=v2();
  r.cases[0].result_i64='-9223372036854775808';
  r.cases[0].expected_i64='-9223372036854775808';
  assert.equal(validateParityReceipt(r).case_count,3);
});

test('v2 rejects noncanonical signed negative zero in observed or expected i64',()=>{
  const r=v2();
  r.cases[0].result_i64='-0';
  r.cases[0].expected_i64='-0';
  assert.throws(()=>validateParityReceipt(r),/positive i64 result/);
  r.cases[0].result_i64='0';
  assert.throws(()=>validateParityReceipt(r),/expected i64 result/);
  r.cases[0].expected_i64='0';
  assert.equal(validateParityReceipt(r).case_count,3);
});

test('compiler receipt metadata forbids log-control characters',()=>{
  for(const codepoint of [0,9,10,13,31,127]){
    const r=v2();r.compiler='compiler'+String.fromCharCode(codepoint)+'injected';
    assert.throws(()=>validateParityReceipt(r),/parity receipt rejected: compiler/);
  }
  const r=v2();r.compiler='C:/Program Files/AttoLang/llvmc.exe';
  assert.equal(validateParityReceipt(r).publicly_promotable,false);
});

test('compiler labels reject Unicode line and bidi controls without rejecting ordinary Unicode paths',()=>{
  for(const codepoint of [0x85,0x9b,0x2028,0x2029,0x202a,0x202e,0x2066,0x2069]){
    const r=v2();
    r.compiler='llvmc'+String.fromCodePoint(codepoint)+'spoof';
    assert.throws(()=>validateParityReceipt(r),/parity receipt rejected: compiler/);
  }
  const r=v2();
  r.compiler='Compilador Å/测试/atto';
  assert.equal(validateParityReceipt(r).publicly_promotable,false);
});

test('v1 and v2 diagnostics reject terminal and bidi spoofing but allow multiline',()=>{
  for(const sample of [v1,v2]){
    for(const point of [0,0x1b,0x7f,0x9b,0x202e,0x2067]){
      const r=sample();
      const negative=r.cases.find(c=>c.kind==='negative');
      negative.diagnostic='genuine error'+String.fromCodePoint(point)+'fake success';
      assert.throws(()=>validateParityReceipt(r),/parity receipt rejected: negative diagnostic/);
    }
    const r=sample();
    r.cases.find(c=>c.kind==='negative').diagnostic='line one\nline two: checked failure';
    assert.equal(validateParityReceipt(r).publicly_promotable,false);
  }
});

test('all ASCII controls and Unicode line separators are invalid compiler labels',()=>{
  for(const codepoint of [...Array(32).keys(),127,133,8232,8233]){
    const r=v2();
    r.compiler='llvm'+String.fromCodePoint(codepoint)+'forged';
    assert.throws(()=>validateParityReceipt(r),/parity receipt rejected: compiler/,String(codepoint));
  }
  const r=v1();
  r.compiler='C:/Program Files/AttoLang/native compiler';
  assert.equal(validateParityReceipt(r).case_count,2);
});

test('v1/v2 reject C1 and Unicode diagnostic line-spoofing while preserving LF',()=>{
  for(const make of [v1,v2]){
    for(const codepoint of [0x80,0x85,0x9a,0x9f,0x2028,0x2029]){
      const r=make();
      r.cases.find(c=>c.kind==='negative').diagnostic=
        'genuine failure'+String.fromCodePoint(codepoint)+'fake success';
      assert.throws(()=>validateParityReceipt(r),/negative diagnostic/);
    }
    const r=make();
    r.cases.find(c=>c.kind==='negative').diagnostic=
      'first line\\nsecond line: genuine compiler failure';
    assert.equal(validateParityReceipt(r).publicly_promotable,false);
  }
});

test('positive typed i64 cannot conceal failed guest process status',()=>{
  for(const channel of ['stdout','wasm-export','native-return','host-call']){
    for(const invalidExit of [-1,1,42,124,125,127,139,255,NaN,Infinity,1.5]){
      const r=v2();
      r.cases[0].result_channel=channel;
      r.cases[0].run_exit=invalidExit;
      assert.throws(()=>validateParityReceipt(r),/positive guest process exit/,
        channel+' run_exit='+String(invalidExit));
    }
    const valid=v2();
    valid.cases[0].result_channel=channel;
    valid.cases[0].run_exit=0;
    assert.equal(validateParityReceipt(valid).publicly_promotable,false);
  }
  const exitResult=v2();
  exitResult.cases[0].result_channel='process-exit';
  exitResult.cases[0].run_exit=42;
  assert.equal(validateParityReceipt(exitResult).case_count,3);
});
