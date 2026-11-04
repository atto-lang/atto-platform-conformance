import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParityReceipt, validateScalarParityReceipt } from '../src/atto-parity-receipt.mjs';
const h = 'a'.repeat(40), d = 'b'.repeat(64), a = 'c'.repeat(64);
const v1 = () => ({schema:'attolang.parity-receipt/1',backend:'java',head_sha:h,tree_sha:h,compiler:'javac',compiler_sha256:d,run_id:1,run_attempt:1,executed_steps:4,job_conclusion:'success',cases:[{id:'returns_42',source_sha256:d,kind:'positive',compile_exit:0,executed:true,run_exit:0,stdout:'42\n',expected_stdout:'42\n'},{id:'unknown_symbol',source_sha256:d,kind:'negative',compile_exit:1,executed:false,diagnostic:'unknown symbol'}]});
const v2 = () => ({schema:'attolang.parity-receipt/2',backend:'llvm',head_sha:h,tree_sha:h,compiler:'oreslang-llvmc',compiler_sha256:d,artifact_sha256:a,run_id:2,run_attempt:1,executed_steps:6,job_conclusion:'success',cases:[{id:'returns_42',source_sha256:d,kind:'positive',compile_exit:0,executed:true,result_i64:'42',expected_i64:'42',result_channel:'native-return'},{id:'checked_overflow',source_sha256:d,kind:'negative',compile_exit:0,executed:true,failure_stage:'runtime',runtime_outcome:'trap',diagnostic:'checked overflow'},{id:'unknown_symbol',source_sha256:d,kind:'negative',compile_exit:1,executed:false,failure_stage:'compile',diagnostic:'unknown symbol'}]});

test('v1 remains readable but is not scalar-core eligible',()=>assert.deepEqual(validateParityReceipt(v1()),{consistent:true,authenticity_attested:false,publicly_promotable:false,scalar_core_eligible:false,schema:'attolang.parity-receipt/1',backend:'java',case_count:2}));
test('v1 cannot satisfy scalar-core validation',()=>assert.throws(()=>validateScalarParityReceipt(v1()),/scalar core requires receipt v2/));
test('v2 represents typed result plus compile and runtime negatives',()=>assert.deepEqual(validateScalarParityReceipt(v2()),{consistent:true,authenticity_attested:false,publicly_promotable:false,scalar_core_eligible:true,schema:'attolang.parity-receipt/2',backend:'llvm',case_count:3}));

for(const [name,mutate] of [
 ['missing artifact',r=>delete r.artifact_sha256],
 ['bad artifact digest',r=>r.artifact_sha256='bad'],
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
