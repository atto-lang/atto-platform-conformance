// All tests are host-only structural negative controls. No native guest executes here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED_PROFILES, REQUIRED_CASES, FIXTURE_SHA256, OBSERVATION_CHANNELS, validateFiveBackendScalarEligibility as admit}
  from '../verification/five-backend-scalar-gate.mjs';

const h40 = 'a'.repeat(40), tree = 'b'.repeat(40);
const h64 = 'c'.repeat(64);
const vectors = {
  'scalar.literal-42': '42\n',
  'scalar.precedence': '28\n',
  'scalar.unary': '-21\n',
  'scalar.i64-min': '-9223372036854775808\n',
  'scalar.i64-max': '9223372036854775807\n',
  'scalar.i64-max-minus-one': '9223372036854775806\n'
};
function makeEligible() {
  const fixtures = REQUIRED_CASES.map((id, i) => ({
    id, source_sha256: FIXTURE_SHA256[id]
  }));
  const executions = Object.entries(REQUIRED_PROFILES).flatMap(
    ([backend, modes]) => modes.map(mode => ({backend, mode})));
  return {
    schema_version: 1, certified: false, native_verified: false,
    source_transfer_authorized: false, fixture_profile: 'scalar-checked-i64-v1',
    fixtures,
    executions: executions.map((e, i) => ({
      ...e, repository: 'ores-truffle-oreslang/oreslang-source.' + e.backend,
      source: {commit_sha: h40, tree_sha: tree},
      compiler: {commit_sha: h40, tree_sha: tree, binary_sha256: h64},
      run: {id: 1000 + i, attempt: 1, status: 'completed', conclusion: 'success',
        admission_failed: false,
        jobs: [{
          id: 4000 + i, run_id: 1000 + i, run_attempt: 1, head_sha: h40,
          runner_id: 900 + i, runner_name: 'synthetic-runner-' + i,
          status: 'completed', conclusion: 'success',
          steps: [{number: 1, name: 'synthetic checkout', status: 'completed',
                   conclusion: 'success'},
                  {number: 2, name: 'synthetic guest', status: 'completed',
                   conclusion: 'success'}]
        }]
      },
      cases: fixtures.map(f => {
        const accept = Object.hasOwn(vectors, f.id);
        return {
          id: f.id, kind: accept ? 'accept' : 'overflow',
          source_sha256: f.source_sha256,
          stdout_sha256: h64, stderr_sha256: h64,
          exit_code: e.backend === 'wasm' ? null : (accept ? 0 : 1),
          value_i64: accept ? vectors[f.id].trim() : null,
          semantic_phase: accept ? 'guest-return' : 'guest-overflow',
          observation_channel: OBSERVATION_CHANNELS[e.backend],
          stdout: accept && ['cranelift','net'].includes(e.backend) ? vectors[f.id] : '',
          compiler_executed: true, guest_executed: true,
          guest_command: 'synthetic guest invocation',
          error_category: accept ? null : 'checked-i64-overflow',
          ...(e.backend === 'wasm' && !accept ? {trap_category: 'webassembly-runtime-error'} : {})
        };
      })
    }))
  };
}
test('complete synthetic seven-mode receipt is structurally eligible, NOT certified', () => {
  const doc = makeEligible();
  assert.equal(admit(doc), true);
  assert.equal(doc.certified, false);
  assert.equal(doc.native_verified, false);
});
function denies(name, mutate, pattern) {
  test(name, () => {
    const doc = makeEligible();
    mutate(doc);
    assert.throws(() => admit(doc), pattern);
  });
}
const badHeaders = [
  ['self-certified', d => d.certified = true],
  ['self-native-verified', d => d.native_verified = true],
  ['transfer-authorization claim', d => d.source_transfer_authorized = true],
  ['missing source transfer status', d => delete d.source_transfer_authorized],
  ['wrong schema', d => d.schema_version = 2],
];
for (const [name, change] of badHeaders)
  denies('reject '+name, change, /non-certifying/);
denies('reject incomplete fixture list', d => d.fixtures.pop(), /fixture coverage/);
denies('reject duplicate fixture id', d => d.fixtures[1].id=d.fixtures[0].id, /fixture/);
denies('reject malformed fixture SHA', d => d.fixtures[0].source_sha256='main', /fixture/);
denies('reject well-formed but wrong pinned SHA', d => d.fixtures[0].source_sha256='f'.repeat(64), /fixture/);
denies('reject unrecognized fixture id', d => d.fixtures[0].id='unlisted', /fixture/);
denies('reject absent execution mode', d => d.executions.pop(), /seven/);
denies('reject reused backend/mode credit', d => d.executions[1].mode=d.executions[0].mode, /duplicate backend/);
denies('reject wrong backend name', d => d.executions[0].backend='forge', /backend, mode/);
denies('reject wrong repository', d => d.executions[0].repository='ores-truffle-oreslang/oreslang-source.llvm', /backend, mode/);
denies('reject unrecognized execution mode', d => d.executions[0].mode='native-aot', /backend, mode/);
denies('reject source commit pinned to moving branch', d => d.executions[0].source.commit_sha='main', /source\/compiler/);
denies('reject missing compiler binary hash', d => d.executions[0].compiler.binary_sha256='', /source\/compiler/);
denies('reject no GitHub runner assignment', d => d.executions[0].run.jobs[0].runner_id=0, /unexecuted/);
denies('reject zero-step workflow', d => d.executions[0].run.jobs[0].steps=[], /unexecuted/);
denies('reject stale source head in job', d => d.executions[0].run.jobs[0].head_sha=tree, /unexecuted/);
denies('reject stale run attempt', d => d.executions[0].run.jobs[0].run_attempt=2, /unexecuted/);
denies('reject missing run ID', d => d.executions[0].run.id=0, /runner admission/);
denies('reject job admission failure', d => d.executions[0].run.admission_failed=true, /runner admission/);
denies('reject failed run', d => d.executions[0].run.conclusion='failure', /runner admission/);
denies('reject failed job', d => d.executions[0].run.jobs[0].conclusion='failure', /unexecuted/);
denies('reject skipped step', d => d.executions[0].run.jobs[0].steps[1].conclusion='skipped', /step/);
denies('reject forged step sequence', d => d.executions[0].run.jobs[0].steps[0].number=2, /step/);
denies('reject reused run for Java JIT+AOT', d => d.executions[1].run.id=d.executions[0].run.id, /run reused/);
denies('reject duplicate job ID in same repository', d => d.executions[1].run.jobs[0].id=d.executions[0].run.jobs[0].id, /unexecuted/);
denies('reject missing compiler execution', d => d.executions[0].cases[0].compiler_executed=false, /guest case/);
denies('reject absent native guest execution', d => d.executions[0].cases[0].guest_executed=false, /guest case/);
denies('reject omitted guest case', d => d.executions[0].cases.pop(), /guest case/);
denies('reject duplicate guest case', d => d.executions[0].cases[1].id=d.executions[0].cases[0].id, /guest case/);
denies('reject switched fixture hash', d => d.executions[0].cases[0].source_sha256=d.fixtures[1].source_sha256, /guest case/);
denies('reject forged successful guest exit', d => d.executions[0].cases[0].exit_code=1, /successful guest/);
denies('reject wrong output for precedence', d => d.executions[0].cases[1].value_i64='27', /successful guest/);
denies('reject silent accept without newline', d => d.executions.find(x=>x.backend==='net').cases[0].stdout='42', /stdout transport/);
denies('reject overflow reported as success', d => d.executions[0].cases[6].exit_code=0, /overflow/);
denies('reject overflow with stdout', d => d.executions[0].cases[6].stdout='0\n', /overflow/);
denies('reject overflow with wrong category', d => d.executions[0].cases[6].error_category='panic', /overflow/);
denies('reject wrong guest kind', d => d.executions[0].cases[6].kind='accept', /guest case/);
denies('reject invalid guest exit number', d => d.executions[0].cases[6].exit_code=NaN, /guest case/);
denies('reject whitespace-only guest command', d => d.executions[0].cases[0].guest_command='  ', /guest case/);
denies('reject wrong runtime observation channel',
 d => d.executions[0].cases[0].observation_channel='host-oracle', /guest case/);
denies('reject mismatched typed i64 value despite plausible stdout',
 d => d.executions[0].cases[0].value_i64='0', /successful guest/);
denies('reject WASM export claiming OS process exit',
 d => d.executions.find(x=>x.backend==='wasm').cases[0].exit_code=0, /guest case/);
denies('reject WASM trap without RuntimeError provenance',
 d => d.executions.find(x=>x.backend==='wasm').cases[6].trap_category='unknown', /overflow/);
denies('reject NativeAOT printed value inconsistent with normalized i64',
 d => d.executions.find(x=>x.backend==='net').cases[0].stdout='43\\n', /stdout transport/);
denies('reject Cranelift JIT CLI printed value inconsistent with normalized i64',
 d => d.executions.find(x=>x.backend==='cranelift').cases[0].stdout='', /stdout transport/);
denies('reject host oracle masquerading as runtime phase',
 d => d.executions[0].cases[0].semantic_phase='host-reference', /successful guest/);
denies('reject overflow falsely classified as compiler-stage error',
 d => d.executions[0].cases[6].semantic_phase='compile-reject', /overflow/);
test('Java and LLVM raw stdout need not carry typed result; adapter verification is independent', () => {
 const doc=makeEligible();
 doc.executions.find(x=>x.backend==='java').cases[0].stdout='';
 doc.executions.find(x=>x.backend==='llvm').cases[0].stdout='';
 assert.equal(admit(doc),true);
});
test('a fabricated but internally consistent full receipt is NOT authentication', () => {
  const doc = makeEligible();
  doc.executions[0].run.jobs[0].runner_name='invented-runner';
  assert.equal(admit(doc), true); // Deliberately illustrates limitation.
  assert.equal(doc.certified, false);
});
