import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

const sha40 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const positives = "pub fnc main(): int {\n  return 20 + 22;\n}\n";
const negatives = "pub fnc main(): int {\n  return nonexistent_symbol;\n}\n";
const sourceHash = (value) => createHash("sha256").update(value).digest("hex");

function requireField(condition, message) {
  if (!condition) throw new Error("untrusted compiler evidence: " + message);
}

function validateProcess(p, label) {
  requireField(p && typeof p === "object" && !Array.isArray(p), label + " process missing");
  requireField(Array.isArray(p.argv) && p.argv.length >= 1 &&
    p.argv.every(x => typeof x === "string" && x.length && !x.includes("\0")) &&
    isAbsolute(p.argv[0]), label + " argv invalid");
  requireField(p.timeout === false && p.output_truncated === false, label + " timeout/truncation");
  requireField(Number.isInteger(p.exit_code) && p.exit_code >= 0 && p.exit_code <= 255, label + " exit code");
  requireField(typeof p.stdout === "string" && typeof p.stderr === "string" &&
    p.stdout.length <= 32768 && p.stderr.length <= 32768, label + " output oversized");
  requireField(Number.isSafeInteger(p.duration_ms) && p.duration_ms >= 0, label + " duration");
  return p;
}
function good(p) { return validateProcess(p, "positive").exit_code === 0; }
function rejected(p) {
  validateProcess(p, "negative");
  const combined = p.stdout + "\n" + p.stderr;
  return p.exit_code > 0 && combined.includes("nonexistent_symbol") &&
    /\b(error|undefined|undeclared|unresolved|unknown)\b|not found|cannot find/i.test(combined) &&
    !/\b(segmentation fault|stack trace|traceback|fatal signal)\b/i.test(combined);
}

/** Validate a report's internal consistency. Does NOT prove the report is authentic. */
export function validateRealCompilerReport(r) {
  requireField(r && typeof r === "object" && !Array.isArray(r), "expected JSON object");
  requireField(r.schema_version === 1 && r.evidence_type === "real-compiler-smoke", "invalid report format");
  requireField(r.backend === "java" || r.backend === "llvm", "unexpected backend");
  requireField(typeof r.source_commit_declared === "string" && sha40.test(r.source_commit_declared), "invalid source SHA");
  requireField(!r.runner_sha || r.runner_sha === r.source_commit_declared, "CI source mismatch");
  requireField(r.source_commit_binary_link_attested === false, "unsupported attestation claim");
  requireField(r.compiler_verification === "real-process-observation-only", "unsupported verification class");
  requireField(typeof r.process_invoker_sha256 === "string" && sha256.test(r.process_invoker_sha256), "missing process invoker digest");
  requireField(typeof r.compiler_artifact_sha256 === "string" && sha256.test(r.compiler_artifact_sha256), "missing compiler artifact digest");
  requireField(typeof r.compiler_path === "string" && isAbsolute(r.compiler_path), "missing compiler path");
  requireField(Array.isArray(r.cases) && r.cases.length === 2, "expected exactly two cases");
  const [positive, negative] = r.cases;
  requireField(positive.id === "positive" && negative.id === "negative", "unexpected case order");
  requireField(positive.source_sha256 === sourceHash(positives), "positive fixture modified");
  requireField(negative.source_sha256 === sourceHash(negatives), "negative fixture modified");
  // A fake report can invent commands, but internal consistency must still tie
  // the observed compiler invocations to the same source and tool identity.
  const sourceArg = (p, expected) =>
    Array.isArray(p?.argv) && typeof p.argv.at(-1) === "string" &&
    p.argv.at(-1).endsWith("/" + expected);
  requireField(positive.compile?.argv?.[0] === r.compiler_path &&
    negative.compile?.argv?.[0] === r.compiler_path, "compiler executable mismatch");
  requireField(sourceArg(positive.compile, "positive.ores") &&
    sourceArg(negative.compile, "negative.ores"), "compiler fixture argv mismatch");
  requireField(good(positive.compile), "positive source was not accepted");
  if (r.backend === "java") {
    requireField(typeof r.java_probe_path === "string" && isAbsolute(r.java_probe_path) &&
      positive.compile.argv[1] === r.java_probe_path &&
      negative.compile.argv[1] === r.java_probe_path,
      "Java probe identity mismatches recorded invocation");
    requireField(positive.compile.argv.length === 3 &&
      negative.compile.argv.length === 3 &&
      positive.execution?.argv?.length === 4 &&
      positive.execution.argv[0] === r.compiler_path &&
      positive.execution.argv[1] === positive.compile.argv[1] &&
      positive.execution.argv[2] === positive.compile.argv[2] &&
      positive.execution.argv[3] === "--execute", "Java probe/guest execution argv mismatch");
    requireField(r.compiler_artifact_kind === "java-launcher-class-only" &&
      r.compiler_artifact_sha256 === r.launcher_class_sha256, "Java compiler artifact identity mismatch");
    requireField(sha256.test(r.launcher_class_sha256 ?? "") &&
      sha256.test(r.maven_classpath_sha256 ?? "") &&
      sha256.test(r.java_probe_sha256 ?? ""), "missing Java launcher provenance");
  } else {
    requireField(typeof r.clang_path === "string" && isAbsolute(r.clang_path) &&
      positive.link?.argv?.[0] === r.clang_path,
      "Clang identity mismatches recorded linker invocation");
    requireField(positive.compile.argv.length === 2 &&
      negative.compile.argv.length === 2 &&
      positive.link?.argv?.length === 6 &&
      positive.link.argv[1] === "-x" && positive.link.argv[2] === "ir" &&
      positive.link.argv[3].endsWith("/app.ll") &&
      positive.link.argv[4] === "-o" &&
      positive.execution?.argv?.length === 1 &&
      positive.link.argv[5] === positive.execution.argv[0],
      "LLVM IR/link/execution argv mismatch");
    requireField(r.compiler_artifact_kind === "llvm-native-executable" &&
      r.compiler_artifact_sha256 === r.process_invoker_sha256, "native artifact/invoker mismatch");
    requireField(sha256.test(r.clang_sha256 ?? ""), "missing clang identity");
    requireField(typeof positive.compile.stdout === "string" &&
      positive.compile.stdout.includes("define ") && positive.compile.stdout.includes("main"), "not LLVM IR");
    requireField(good(positive.link), "LLVM link failed");
  }
  validateProcess(positive.execution, "runtime");
  requireField(positive.execution.exit_code === 42, "runtime did not return 42");
  requireField(rejected(negative.compile), "negative source not rejected with diagnostic");
  requireField(positive.passed === true && negative.passed === true && r.ok === true, "inconsistent report statuses");

  return {
    consistency_valid: true,
    compiler_backend: r.backend,
    compiler_source_revision: r.source_commit_declared,
    case_count: 2,
    // No file, however convincing, is enough to attest its own provenance.
    authenticity_attested: false,
    publicly_promotable: false,
    warning: "JSON consistency verified only; authenticate exact-run CI provenance and binary/source linkage separately.",
  };
}
