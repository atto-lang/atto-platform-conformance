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
  requireField(Array.isArray(p.argv) && p.argv.length >= 2 &&
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
  requireField(typeof r.compiler_sha256 === "string" && sha256.test(r.compiler_sha256), "missing compiler digest");
  requireField(typeof r.compiler_path === "string" && isAbsolute(r.compiler_path), "missing compiler path");
  requireField(Array.isArray(r.cases) && r.cases.length === 2, "expected exactly two cases");
  const [positive, negative] = r.cases;
  requireField(positive.id === "positive" && negative.id === "negative", "unexpected case order");
  requireField(positive.source_sha256 === sourceHash(positives), "positive fixture modified");
  requireField(negative.source_sha256 === sourceHash(negatives), "negative fixture modified");
  requireField(good(positive.compile), "positive source was not accepted");
  if (r.backend === "java") {
    requireField(sha256.test(r.launcher_class_sha256 ?? "") &&
      sha256.test(r.maven_classpath_sha256 ?? "") &&
      sha256.test(r.java_probe_sha256 ?? ""), "missing Java launcher provenance");
  } else {
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
