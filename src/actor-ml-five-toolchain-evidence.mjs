// STRUCTURAL ONLY: reports cannot authenticate their own compiler/runner execution.
// No result from this module can certify backend parity or justify a release.
export const SCHEMA = "oreslang.actor-ml-five-toolchain-evidence.v1";
export const SOURCE = "pub fnc main(): int { return 2 - 1 * (2 * 1 - 42) * 1; }\n";
export const SOURCE_BLOB = "5affedebfcc7bf6aab2bdd6451f80ea5a71a5624";
export const SOURCE_SHA256 = "37dfb0ba856762dc656b628a085684558e5ac1d0392ccd6947d6ccdc35ed7d8e";
export const EXPECTED = Object.freeze({
  java: Object.freeze({profile:"graal-guest", probe:"linked_guest_exit", status:42}),
  llvm: Object.freeze({profile:"llvm-native", probe:"process_exit", status:42}),
  wasm: Object.freeze({profile:"wasm32", probe:"wasm_export_i64", status:0}),
  cranelift: Object.freeze({profile:"native-jit", probe:"stdout_i64", status:0}),
  net: Object.freeze({profile:"native-aot", probe:"stdout_i64", status:0})
});
const fail = message => { throw Error("untrusted actor-ml parity evidence: " + message); };
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
function fields(value, required, path) {
  if (!object(value)) fail(path + " must be object");
  const keys=Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...required].sort()))
    fail(path + " has missing or unexpected fields");
}
const sha1 = s => typeof s === "string" && /^[a-f0-9]{40}$/.test(s) &&
  !/^0+$/.test(s);
const sha256 = s => typeof s === "string" && /^[a-f0-9]{64}$/.test(s) &&
  !/^0+$/.test(s);
const positive = n => Number.isSafeInteger(n) && n > 0;
function checkBack(b) {
  fields(b,["backend","repository","profile","source_commit","source_tree",
    "source_blob","source_sha256","compiler_sha256","guest_sha256",
    "compile","execution","ci"],"backend evidence");
  const e=EXPECTED[b.backend];
  if (!e) fail("unknown backend");
  if (b.repository !== "ores-truffle-oreslang/oreslang-source." + b.backend)
    fail("repository identity");
  if (b.profile !== e.profile) fail("wrong target profile");
  if (!sha1(b.source_commit) || !sha1(b.source_tree)) fail("unpinned source");
  if (b.source_blob !== SOURCE_BLOB || b.source_sha256 !== SOURCE_SHA256)
    fail("guest source identity mismatch");
  if (!sha256(b.compiler_sha256) || !sha256(b.guest_sha256))
    fail("compiler or guest binary SHA-256 missing");
  fields(b.compile,["argv","exit_code","signal","timed_out","truncated"],"compile");
  if (!Array.isArray(b.compile.argv) || !b.compile.argv.length ||
      !b.compile.argv.every(s=>typeof s==="string" && s.length>0) ||
      !b.compile.argv[0].startsWith("/") ||
      b.compile.exit_code !== 0 || b.compile.signal !== null ||
      b.compile.timed_out !== false || b.compile.truncated !== false)
    fail("real compiler invocation not proven even structurally");
  fields(b.execution,["argv","status","probe","value","guest_executed",
    "signal","timed_out","truncated"],"guest execution");
  if (!Array.isArray(b.execution.argv) || !b.execution.argv.length ||
      !b.execution.argv.every(s=>typeof s==="string" && s.length>0) ||
      !b.execution.argv[0].startsWith("/") ||
      b.execution.status !== e.status || b.execution.probe !== e.probe ||
      b.execution.value !== "42" ||
      b.execution.guest_executed !== true ||
      b.execution.signal !== null || b.execution.timed_out !== false ||
      b.execution.truncated !== false ||
      JSON.stringify(b.execution.argv) === JSON.stringify(b.compile.argv))
    fail("guest was not actually reported as executed with expected 42");
  fields(b.ci,["run_id","job_id","runner_id","steps_executed","head_sha",
    "conclusion"],"CI");
  if (![b.ci.run_id,b.ci.job_id,b.ci.runner_id,b.ci.steps_executed]
      .every(positive) || b.ci.head_sha !== b.source_commit ||
      b.ci.conclusion !== "success")
    fail("zero-step, skipped, mismatched-head or failed CI");
}
export function inspectActorMlFiveToolchainEvidence(report) {
  fields(report,["schema","fixture","backends"],"report");
  if (report.schema !== SCHEMA) fail("wrong contract version");
  fields(report.fixture,["source","sha256","git_blob","expected"],"fixture");
  if (report.fixture.source !== SOURCE || report.fixture.sha256 !== SOURCE_SHA256 ||
      report.fixture.git_blob !== SOURCE_BLOB || report.fixture.expected !== "42")
    fail("fixture bytes or expected value changed");
  if (!Array.isArray(report.backends) ||
      report.backends.length !== Object.keys(EXPECTED).length)
    fail("five distinct backends required");
  const found=new Set();
  for (const record of report.backends) {
    checkBack(record);
    if (found.has(record.backend)) fail("duplicate backend");
    found.add(record.backend);
  }
  return Object.freeze({
    schema:SCHEMA, backend_count:found.size, source_blob:SOURCE_BLOB,
    structurally_valid:true, runner_authenticated:false,
    real_guest_authenticated:false, five_toolchain_parity_certified:false
  });
}
