import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKENDS, CANONICAL_SOURCE, SOURCE_SHA256, SOURCE_GIT_BLOB,
  validateFiveBackendRuntimeEvidence} from '../src/five-backend-runtime-evidence.mjs';

const sha40 = 'a'.repeat(40);
const sha256 = 'b'.repeat(64);
function makeBackend(backend, idx) {
  const profile = {java:'jvm', llvm:'native', wasm:'core-wasm',
    net:'windows-native-aot', forge:'interpreter'}[backend];
  return {
    backend, repository:'ores-truffle-oreslang/oreslang-source.' + backend,
    profile, source_commit:sha40, source_tree:'c'.repeat(40),
    fixture_git_blob:SOURCE_GIT_BLOB,
    compiler_sha256:sha256, guest_artifact_sha256:'d'.repeat(64),
    compile:{argv:['/tmp/compiler', 'add.ores'], exit_code:0, signal:null,
      timed_out:false, truncated:false},
    guest:{argv:['/tmp/guest'],exit_code:idx === 1 ? 42 : 0,signal:null,
      timed_out:false,truncated:false},
    observation:{type:'int',value:'42',source_sha256:SOURCE_SHA256,guest_executed:true},
    ci:{workflow_run_id:100+idx,job_id:200+idx,runner_id:300+idx,
      steps_executed:6,head_sha:sha40},
  };
}
function report() {
  return {schema_version:1, feature:'scalar-add-i64-v1',
    fixture:{source:CANONICAL_SOURCE,sha256:SOURCE_SHA256,git_blob:SOURCE_GIT_BLOB},
    backends:BACKENDS.map(makeBackend)};
}
const mutate = (fn) => { const r=report(); fn(r); return r; };
const denies = (label, fn) => test(label, () =>
  assert.throws(() => validateFiveBackendRuntimeEvidence(mutate(fn)), /untrusted five-backend evidence:/));

test('five structurally valid records never self-certify real parity', () => {
  const result=validateFiveBackendRuntimeEvidence(report());
  assert.equal(result.backend_count,5);
  assert.equal(result.structurally_valid,true);
  assert.equal(result.ci_provenance_authenticated,false);
  assert.equal(result.guest_execution_authenticated,false);
  assert.equal(result.five_backend_parity_certified,false);
});
denies('missing backend', r=>r.backends.pop());
denies('duplicate backend', r=>r.backends[4]=structuredClone(r.backends[0]));
denies('unexpected backend', r=>r.backends[0].backend='browser');
denies('wrong repository identity', r=>r.backends[0].repository='other/repo');
denies('wrong target profile', r=>r.backends[2].profile='jvm');
denies('feature not version-pinned', r=>r.feature='other');
denies('manifest source drift', r=>r.fixture.source+=' ');
denies('manifest digest drift', r=>r.fixture.sha256='0'.repeat(64));
denies('fixture Git blob mismatch', r=>r.backends[3].fixture_git_blob='0'.repeat(40));
denies('source tree missing', r=>r.backends[0].source_tree='');
denies('compiler binary missing hash', r=>r.backends[2].compiler_sha256='');
denies('guest artifact digest malformed', r=>r.backends[4].guest_artifact_sha256='bad');
denies('compile error', r=>r.backends[0].compile.exit_code=1);
denies('runtime timeout', r=>r.backends[0].guest.timed_out=true);
denies('runtime signaled', r=>r.backends[0].guest.signal='SIGSEGV');
denies('truncated compiler output', r=>r.backends[0].compile.truncated=true);
denies('runtime wrong result', r=>r.backends[1].observation.value='43');
denies('runtime not executed', r=>r.backends[2].observation.guest_executed=false);
denies('source hash mismatch', r=>r.backends[3].observation.source_sha256='0'.repeat(64));
denies('compiler invocation substituted for runtime', r=>r.backends[0].guest.argv=['/tmp/compiler','add.ores']);
denies('invalid guest exit', r=>r.backends[0].guest.exit_code=127);
denies('missing runner', r=>r.backends[0].ci.runner_id=0);
denies('zero-step job', r=>r.backends[1].ci.steps_executed=0);
denies('CI wrong commit', r=>r.backends[2].ci.head_sha='e'.repeat(40));
denies('unexpected proof claim', r=>r.backends[3].ci.authenticity_attested=true);
denies('invalid executable path', r=>r.backends[3].guest.argv=['relative/guest']);
denies('unexpected report field', r=>r.parity_verified=true);
