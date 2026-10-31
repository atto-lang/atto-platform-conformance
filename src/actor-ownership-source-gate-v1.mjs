// Source-compiler admission only. This tool does not establish guest execution,
// actor physical isolation, trace refinement, or compiler-source provenance.
import { readFile, lstat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = b => createHash("sha256").update(b).digest("hex");
export const SOURCE_CASES = Object.freeze([
  { id: "AO01_SOURCE_ORDER", file: "actor-interleaved-stop.ores", backends: ["llvm"], expect: "accept", originBlob: "c7488835f34e926dfa4c8766c8917301fe84da09", limitations: "does not prove physical actor overlap or exclusivity" },
  { id: "AO03_AFTER_STOP", file: "actor-send-after-stop.ores", backends: ["llvm"], expect: "reject", diagnostic: "actor message sent after stop", originBlob: "ba046cb355fd16d9b5f6f7b39ace45356ef497db", limitations: "source rejection, not a stale native completion trace" },
  { id: "AO04_PRIVATE_STATE", file: "isolated-actor-sealed-write.ores", backends: ["llvm"], expect: "accept", originBlob: "9bec6500694b826ccb3c0d2fc292bba816437dbc", limitations: "one isolated actor; two-heap physical evidence still required" },
  { id: "OW01_MOVE_AFTER_TAKE", file: "move-after-take.ores", backends: ["java"], expect: "reject", diagnostic: "moved", limitations: "candidate syntax; needs current-head compiler semantic diagnostic" },
  { id: "OW02_ALIAS_MUTABLE", file: "double-mutable-borrow.ores", backends: ["java"], expect: "reject", diagnostic: "borrow", limitations: "candidate syntax; needs current-head compiler semantic diagnostic" },
  { id: "OW03_NESTED_RETURN", file: "nested-loan-return.ores", backends: ["java"], expect: "reject", diagnostic: "cannot return a nested borrowed reference", limitations: "ported from Java draft #2098; not evidence on main" },
  { id: "OW03_CLOSURE_ESCAPE", file: "borrowed-closure-escape.ores", backends: ["java"], expect: "reject", diagnostic: "closure cannot capture borrowed value", limitations: "ported from Java draft #2098; not evidence on main" },
  { id: "OW03_SUSPENSION_ESCAPE", file: "borrowed-suspension.ores", backends: ["java"], expect: "reject", diagnostic: "ordinary borrow is live", limitations: "ported from Java draft #2098; not evidence on main" },
  { id: "OW04_TASK_CAPTURE", file: "borrowed-task-capture.ores", backends: ["java"], expect: "reject", diagnostic: "cannot retain nested borrowed references", limitations: "ported from Java draft #2098; not evidence on main" }
]);
export const UNIMPLEMENTED_GATES = Object.freeze(["AO01_PHYSICAL_PARALLELISM", "AO02_CONTROL_PRIORITY", "AO03_STALE_NATIVE_COMPLETION", "AO04_DISTINCT_PHYSICAL_HEAPS", "OW04_SEND_SYNC_DERIVATION", "OW05_REGION_GENERATION_FENCE"]);
const nameOk = x => typeof x === "string" && /^[a-z0-9-]{1,100}\.ores$/.test(x);
const shaOk = x => typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
export function gitBlobHash(bytes) {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}
export function validateCaseInventory(cases = SOURCE_CASES) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 80) throw Error("invalid source-case inventory");
  const ids = new Set(), files = new Set();
  for (const c of cases) {
    if (!c || !/^[A-Z0-9_]{3,60}$/.test(c.id || "") || ids.has(c.id) ||
        !nameOk(c.file) || files.has(c.file) || !["accept", "reject"].includes(c.expect) ||
        !Array.isArray(c.backends) || !c.backends.length ||
        c.backends.some(b => !["java", "llvm"].includes(b)) ||
        new Set(c.backends).size !== c.backends.length ||
        (c.expect === "reject" && (!c.diagnostic || !/^[a-z ]{3,120}$/.test(c.diagnostic))) ||
        (c.expect === "accept" && c.diagnostic !== undefined) ||
        (c.originBlob !== undefined && !shaOk(c.originBlob))) throw Error("invalid source-case metadata");
    ids.add(c.id); files.add(c.file);
  }
  return true;
}
export function classifyCompilerResult(c, result) {
  if (result?.error || result?.signal || !Number.isInteger(result?.status)) return "EXECUTION_FAILED";
  const stdout = String(result.stdout ?? ""), stderr = String(result.stderr ?? "");
  if (stdout.length + stderr.length > 256 * 1024) return "OUTPUT_TOO_LARGE";
  const combined = stderr + "\n" + stdout;
  if (/\b(?:panic|segmentation fault|stack trace|stacktrace|internal compiler error|fatal error)\b/i.test(combined)) return "COMPILER_CRASH";
  const firstError = combined.split(/\r?\n/).find(line => /^(?:[^\n:]{1,180}:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error(?:\[[\w-]+\])?\s*:/i.test(line.trimStart()));
  if (c.expect === "accept") return result.status === 0 && !firstError ? "SOURCE_ACCEPTED" : "UNEXPECTED_COMPILER_RESULT";
  if (result.status !== 1 || !firstError) return "UNEXPECTED_COMPILER_RESULT";
  const diagnostic = firstError.replace(/^.*?\berror(?:\[[\w-]+\])?\s*:\s*/i, "").toLowerCase();
  return diagnostic.includes(c.diagnostic.toLowerCase()) ? "SOURCE_REJECTED_AS_EXPECTED" : "DIAGNOSTIC_MISMATCH";
}
export function validateInvocation(argv, sourceSha) {
  if (!shaOk(sourceSha)) throw Error("40-character source SHA is required (declaration, not attestation)");
  if (!Array.isArray(argv) || argv.length === 0 || !isAbsolute(argv[0]) ||
      argv.some(x => typeof x !== "string" || x.includes("\0")) ||
      argv.filter(x => x === "{file}").length !== 1 ||
      argv.some(x => x.includes("{file}") && x !== "{file}")) throw Error("absolute compiler executable and exactly one standalone {file} required");
}
async function digestRegularFile(path, maxSize) {
  const resolved = await realpath(path), stat = await lstat(resolved);
  if (!stat.isFile() || stat.size > maxSize || stat.nlink !== 1) throw Error("unsafe/nonregular/oversized file");
  return { path: resolved, sha256: sha256(await readFile(resolved)) };
}
export async function runSourceAdmission({ backend, argv, sourceSha, spawn = spawnSync }) {
  validateCaseInventory();
  if (!["java", "llvm"].includes(backend)) throw Error("unsupported backend selector");
  const applicable = SOURCE_CASES.filter(c => c.backends.includes(backend));
  if (!argv) return { backend, ok: false, verificationScope: "NOT_EXECUTED", results: applicable.map(c => ({ id: c.id, status: "UNCONFIGURED" })) };
  validateInvocation(argv, sourceSha);
  const executable = await digestRegularFile(argv[0], 512 * 1024 * 1024);
  const results = [];
  for (const c of applicable) {
    const file = join(root, "fixtures", "actor-ownership-v1", c.file);
    const st = await lstat(file);
    if (!st.isFile() || st.nlink !== 1 || st.size > 64 * 1024) throw Error("unsafe fixture file: " + c.id);
    const bytes = await readFile(file);
    const blob = gitBlobHash(bytes);
    if (c.originBlob && c.originBlob !== blob) throw Error("fixture source identity mismatch: " + c.id);
    const command = argv.map(s => s === "{file}" ? file : s);
    const response = spawn(executable.path, command.slice(1), { encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024, shell: false });
    const after = await digestRegularFile(argv[0], 512 * 1024 * 1024);
    const changed = executable.sha256 !== after.sha256 || executable.path !== after.path;
    results.push({ id: c.id, fixtureGitBlob: blob, fixtureSha256: sha256(bytes), expected: c.expect,
      status: changed ? "EXECUTABLE_CHANGED" : classifyCompilerResult(c, response), limitations: c.limitations,
      compilerStdoutSha256: sha256(Buffer.from(String(response.stdout ?? ""))),
      compilerStderrSha256: sha256(Buffer.from(String(response.stderr ?? ""))) });
    if (changed) break;
  }
  const ok = results.length === applicable.length && results.every(r => ["SOURCE_ACCEPTED", "SOURCE_REJECTED_AS_EXPECTED"].includes(r.status));
  return { backend, declaredSourceSha: sourceSha, executableSha256: executable.sha256,
    verificationScope: "UNATTESTED_COMPILER_SOURCE_ADMISSION_ONLY", guestExecuted: false,
    runtimeTraceVerified: false, physicalIsolationVerified: false, ok, results };
}
