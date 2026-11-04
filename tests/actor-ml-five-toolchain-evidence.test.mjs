import test from "node:test";
import assert from "node:assert/strict";
import {SCHEMA,SOURCE,SOURCE_SHA256,SOURCE_BLOB,EXPECTED,
  inspectActorMlFiveToolchainEvidence} from "../src/actor-ml-five-toolchain-evidence.mjs";
const head="abcdef0123456789abcdef0123456789abcdef01";
const sha="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
function record(backend,idx) {
  const profile=EXPECTED[backend];
  return {backend,repository:"ores-truffle-oreslang/oreslang-source."+backend,
    profile:profile.profile,source_commit:head,source_tree:head,
    source_blob:SOURCE_BLOB,source_sha256:SOURCE_SHA256,
    compiler_sha256:sha,guest_sha256:sha,
    compile:{argv:["/tmp/oreslang-native-compiler"],exit_code:0,signal:null,
      timed_out:false,truncated:false},
    execution:{argv:["/tmp/oreslang-guest"],status:profile.status,
      probe:profile.probe,value:"42",guest_executed:true,
      signal:null,timed_out:false,truncated:false},
    ci:{run_id:100+idx,job_id:200+idx,runner_id:300+idx,
      steps_executed:7,head_sha:head,conclusion:"success"}};
}
const positive=()=>({schema:SCHEMA,fixture:{source:SOURCE,sha256:SOURCE_SHA256,
  git_blob:SOURCE_BLOB,expected:"42"},
  backends:Object.keys(EXPECTED).map(record)});
const denial=(label,change)=>test(label,()=>{
  const r=positive();change(r);
  assert.throws(()=>inspectActorMlFiveToolchainEvidence(r),
    /untrusted actor-ml parity evidence/);
});
test("all five synthetic records validate shape but CANNOT certify runner or guest",()=>{
  const report=inspectActorMlFiveToolchainEvidence(positive());
  assert.equal(report.backend_count,5);
  assert.equal(report.structurally_valid,true);
  assert.equal(report.five_toolchain_parity_certified,false);
  assert.equal(report.real_guest_authenticated,false);
  assert.equal(report.runner_authenticated,false);
});
denial("missing backend",r=>r.backends.pop());
denial("duplicate backend",r=>r.backends[4]=structuredClone(r.backends[0]));
denial("substituted Forge",r=>r.backends[3].backend="forge");
denial("wrong repository",r=>r.backends[0].repository="other/oreslang-source.java");
denial("wrong profile",r=>r.backends[3].profile="native-aot");
denial("missing source commit",r=>r.backends[4].source_commit="");
denial("wrong root tree",r=>r.backends[2].source_tree="short");
denial("drifted fixture",r=>r.fixture.source+=" ");
denial("forged fixture digest",r=>r.fixture.sha256="0".repeat(64));
denial("different source blob",r=>r.backends[1].source_blob="0".repeat(40));
denial("invalid compiler hash",r=>r.backends[0].compiler_sha256="no");
denial("missing guest hash",r=>r.backends[4].guest_sha256="");
denial("compiler failed",r=>r.backends[0].compile.exit_code=1);
denial("compiler crash",r=>r.backends[0].compile.signal="SIGSEGV");
denial("wrong value",r=>r.backends[1].execution.value="43");
denial("wrong wasm export",r=>r.backends[2].execution.probe="stdout_i64");
denial("not a guest execution",r=>r.backends[3].execution.guest_executed=false);
denial("incorrect .NET result mode",r=>r.backends[4].execution.probe="process_exit");
denial("guest exited with wrong status",r=>r.backends[0].execution.status=0);
denial("guest crash",r=>r.backends[1].execution.signal="SIGSEGV");
denial("guest timeout",r=>r.backends[2].execution.timed_out=true);
denial("truncated output",r=>r.backends[4].execution.truncated=true);
denial("same compiler and guest argv",r=>r.backends[1].execution.argv=r.backends[1].compile.argv);
denial("skipped job",r=>r.backends[1].ci.conclusion="skipped");
denial("zero-step job",r=>r.backends[2].ci.steps_executed=0);
denial("no runner",r=>r.backends[3].ci.runner_id=0);
denial("CI ran wrong commit",r=>r.backends[0].ci.head_sha="f".repeat(40));
denial("undeclared parity flag",r=>r.five_toolchain_parity_certified=true);
denial("extra backend evidence field",r=>r.backends[0].claim="verified");

denial("all-zero source commit placeholder",r=>r.backends[0].source_commit="0".repeat(40));
denial("all-zero source tree placeholder",r=>r.backends[2].source_tree="0".repeat(40));
denial("all-zero compiler digest placeholder",r=>r.backends[3].compiler_sha256="0".repeat(64));
denial("all-zero executable digest placeholder",r=>r.backends[4].guest_sha256="0".repeat(64));
