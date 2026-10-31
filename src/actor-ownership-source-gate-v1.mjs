// Source-compiler admission only. This tool does not establish guest execution,
// actor physical isolation, trace refinement, or compiler-source provenance.
import { readFile, lstat, realpath, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  { id: "OW01_MOVE_AFTER_TAKE", file: "move-after-take.ores", expectedBlob: "03098466e48389f78ad0e1c7eca6fdc96c0a19e1", backends: ["java"], expect: "reject", candidate: true, diagnostic: "moved", limitations: "candidate syntax; needs current-head compiler semantic diagnostic" },
  { id: "OW02_ALIAS_MUTABLE", file: "double-mutable-borrow.ores", expectedBlob: "294694220fd727f06368cedef0d70687da55150e", backends: ["java"], expect: "reject", candidate: true, diagnostic: "borrow", limitations: "candidate syntax; needs current-head compiler semantic diagnostic" },
  { id: "OW03_NESTED_RETURN", file: "nested-loan-return.ores", expectedBlob: "86c6e4e9af730133a0215f37c2b0b17f5d8bd7be", backends: ["java"], expect: "reject", diagnostic: "cannot return a nested borrowed reference", limitations: "ported from Java draft #2098; not evidence on main" },
  { id: "OW03_CLOSURE_ESCAPE", file: "borrowed-closure-escape.ores", expectedBlob: "a942aca3f735aa85a7772218f5a1384b7e788943", backends: ["java"], expect: "reject", diagnostic: "closure cannot capture borrowed value", limitations: "ported from Java draft #2098; not evidence on main" },
  { id: "OW03_SUSPENSION_ESCAPE", file: "borrowed-suspension.ores", expectedBlob: "2e66fbf1efe7b2cbd5a9a66ebb24935171c4ad87", backends: ["java"], expect: "reject", diagnostic: "ordinary borrow is live", limitations: "ported from Java draft #2098; not evidence on main" },
  { id: "OW04_TASK_CAPTURE", file: "borrowed-task-capture.ores", expectedBlob: "164191466c153ff3d76291075ea7c6d2697d4171", backends: ["java"], expect: "reject", diagnostic: "cannot retain nested borrowed references", limitations: "ported from Java draft #2098; not evidence on main" }
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
        (c.candidate !== undefined && (c.candidate !== true || c.expect !== "reject")) ||
        (c.originBlob !== undefined && !shaOk(c.originBlob)) ||
        (c.expectedBlob !== undefined && !shaOk(c.expectedBlob)) ||
        (!c.originBlob && !c.expectedBlob)) throw Error("invalid source-case metadata");
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
  // A source snippet echoed on stdout must not impersonate a semantic rejection.
  // Reject ambiguous stdout-only diagnostics until a backend-specific adapter is reviewed.
  const errorLine = /^(?:[^\n:]{1,180}:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error(?:\[[\w-]+\])?\s*:/i;
  const firstError = stderr.split(/\r?\n/).find(line => errorLine.test(line.trimStart()));
  const echoedError = stdout.split(/\r?\n/).some(line => errorLine.test(line.trimStart()));
  if (c.expect === "accept") return result.status === 0 && !firstError && !echoedError ? "SOURCE_ACCEPTED" : "UNEXPECTED_COMPILER_RESULT";
  if (result.status !== 1 || !firstError) return "UNEXPECTED_COMPILER_RESULT";
  const diagnostic = firstError.replace(/^.*?\berror(?:\[[\w-]+\])?\s*:\s*/i, "").toLowerCase();
  return diagnostic.includes(c.diagnostic.toLowerCase()) ? "SOURCE_REJECTED_AS_EXPECTED" : "DIAGNOSTIC_MISMATCH";
}
/** Candidate tests cannot certify a language rule even if a compiler happens to reject the source. */
export function promoteCaseOutcome(testCase, observed) {
  return testCase.candidate === true && observed === "SOURCE_REJECTED_AS_EXPECTED"
    ? "CANDIDATE_UNRATIFIED" : observed;
}
export function validateInvocation(argv, sourceSha) {
  if (!shaOk(sourceSha)) throw Error("40-character source SHA is required (declaration, not attestation)");
  if (!Array.isArray(argv) || argv.length === 0 || !isAbsolute(argv[0]) ||
      argv.some(x => typeof x !== "string" || x.includes("\0")) ||
      argv.filter(x => x === "{file}").length !== 1 ||
      argv.some(x => x.includes("{file}") && x !== "{file}")) throw Error("absolute compiler executable and exactly one standalone {file} required");
}
/** A runtime launcher is not the compiler artifact: pin Java JARs and Node entrypoints too. */
export function compilerArtifactPaths(argv, explicit = []) {
  if (!Array.isArray(explicit) || explicit.length > 16)
    throw Error("invalid compiler artifact inventory");
  const paths = [...explicit];
  // Restrict Java launchers to a directly pinned -jar entrypoint: JVM agents,
  // boot classpaths and injected module patches are separate code artifacts.
  // Without an independent launcher contract, do not admit JVM arguments.
  if (/(?:^|\/)java$/.test(argv[0]) &&
      (argv[1] !== "-jar" || !isAbsolute(argv[2] || ""))) {
    throw Error("Java compiler launcher requires a pinned -jar without JVM preflags");
  }
  // No untracked Node CLI flags or alternate module entrypoints: force a
  // directly pinned, absolute compiler script, or use a dedicated wrapper.
  if (/(?:^|\/)node(?:js)?$/.test(argv[0]) &&
      (typeof argv[1] !== "string" || !isAbsolute(argv[1]) ||
       !/\.(?:mjs|cjs|js)$/.test(argv[1]))) {
    throw Error("Node compiler must name a directly pinned absolute script");
  }
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (["-cp", "-classpath", "--class-path", "--module-path"].includes(token))
      throw Error("classpath/modulepath launcher requires a pinned wrapper executable");
    if (token === "-jar") {
      if (!argv[i + 1]) throw Error("missing compiler JAR");
      paths.push(argv[++i]);
    } else if (i === 1 && /(?:^|\/)node(?:js)?$/.test(argv[0]) &&
               /\.(?:mjs|cjs|js)$/.test(token)) {
      paths.push(token);
    }
  }
  if (paths.some(p => typeof p !== "string" || !isAbsolute(p) ||
       p.includes("\0") || p.includes("{file}") || p.length > 2048) ||
      new Set(paths).size !== paths.length)
    throw Error("compiler artifacts must be unique absolute file paths");
  return paths;
}
async function digestRegularFile(path, maxSize) {
  const resolved = await realpath(path), stat = await lstat(resolved);
  if (!stat.isFile() || stat.size > maxSize || stat.nlink !== 1) throw Error("unsafe/nonregular/oversized file");
  return { path: resolved, sha256: sha256(await readFile(resolved)) };
}
/** A compiler must not inherit NODE_OPTIONS, JAVA_TOOL_OPTIONS, LD_PRELOAD, CLASSPATH,
 * or arbitrary shell process state from the invoking runner. Do not silently
 * create a privileged/ambient compiler context. */
export function isolatedCompilerEnvironment(scratch) {
  if (!isAbsolute(scratch)) throw Error("compiler scratch directory must be absolute");
  return Object.freeze({ LANG: "C", LC_ALL: "C", TZ: "UTC", HOME: scratch,
    TMPDIR: scratch, TMP: scratch, TEMP: scratch });
}
export async function runSourceAdmission({ backend, argv, sourceSha, artifacts = [], spawn = spawnSync }) {
  validateCaseInventory();
  if (!["java", "llvm"].includes(backend)) throw Error("unsupported backend selector");
  const applicable = SOURCE_CASES.filter(c => c.backends.includes(backend));
  if (!argv) return { backend, ok: false, certificationEligible: false,
    provenanceVerified: false, verificationScope: "NOT_EXECUTED", guestExecuted: false,
    runtimeTraceVerified: false, physicalIsolationVerified: false,
    results: applicable.map(c => ({ id: c.id, status: "UNCONFIGURED" })) };
  validateInvocation(argv, sourceSha);
  const executable = await digestRegularFile(argv[0], 512 * 1024 * 1024);
  const artifactPaths = compilerArtifactPaths(argv, artifacts);
  const pinnedArtifacts = await Promise.all(artifactPaths.map(p => digestRegularFile(p, 512 * 1024 * 1024)));
  const results = [];
  for (const c of applicable) {
    const file = join(root, "fixtures", "actor-ownership-v1", c.file);
    const st = await lstat(file);
    if (!st.isFile() || st.nlink !== 1 || st.size > 64 * 1024) throw Error("unsafe fixture file: " + c.id);
    const bytes = await readFile(file);
    const blob = gitBlobHash(bytes);
    if ((c.expectedBlob || c.originBlob) !== blob) throw Error("fixture source identity mismatch: " + c.id);
    // Run on a per-case private snapshot, not a mutable checkout pathname.
    // Rehash both the snapshot and the original to detect tampering; this is
    // detection, not a security sandbox against same-UID adversarial compilers.
    const scratch = await mkdtemp(join(tmpdir(), "ores-actor-source-"));
    let changed = false;
    try {
      const snapshot = join(scratch, c.file);
      await writeFile(snapshot, bytes, { flag: "wx", mode: 0o400 });
      if (!bytes.equals(await readFile(snapshot))) throw Error("fixture snapshot changed before compile");
      const command = argv.map(s => s === "{file}" ? snapshot : s);
      const response = spawn(executable.path, command.slice(1), {
        encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024,
        shell: false, cwd: scratch, env: isolatedCompilerEnvironment(scratch)
      });
      const after = await digestRegularFile(argv[0], 512 * 1024 * 1024);
      changed = executable.sha256 !== after.sha256 || executable.path !== after.path;
      const artifactAfter = await Promise.all(artifactPaths.map(p => digestRegularFile(p, 512 * 1024 * 1024)));
      const artifactChanged = artifactAfter.some((a, i) =>
        a.sha256 !== pinnedArtifacts[i].sha256 || a.path !== pinnedArtifacts[i].path);
      const fixtureChanged = !bytes.equals(await readFile(snapshot)) ||
        !bytes.equals(await readFile(file));
      const classified = classifyCompilerResult(c, response);
      const status = changed ? "EXECUTABLE_CHANGED" : artifactChanged ? "COMPILER_ARTIFACT_CHANGED" : fixtureChanged ? "FIXTURE_CHANGED" :
        promoteCaseOutcome(c, classified);
      results.push({ id: c.id, fixtureGitBlob: blob, fixtureSha256: sha256(bytes), expected: c.expect,
        status, observedCompilerOutcome: classified,
        promotionBlocked: c.candidate === true, limitations: c.limitations,
        compilerStdoutSha256: sha256(Buffer.from(String(response.stdout ?? ""))),
        compilerStderrSha256: sha256(Buffer.from(String(response.stderr ?? ""))) });
      if (changed || artifactChanged || fixtureChanged) {
        for (const result of results) {
          if (result.status === "SOURCE_ACCEPTED" || result.status === "SOURCE_REJECTED_AS_EXPECTED") {
            result.status = changed ? "EXECUTABLE_CHANGED" : artifactChanged ? "COMPILER_ARTIFACT_CHANGED" : "FIXTURE_CHANGED";
            result.priorVerificationRevoked = true;
          }
        }
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    if (changed || results.at(-1)?.status === "COMPILER_ARTIFACT_CHANGED" || results.at(-1)?.status === "FIXTURE_CHANGED") break;
  }
  const ok = results.length === applicable.length && results.every(r => ["SOURCE_ACCEPTED", "SOURCE_REJECTED_AS_EXPECTED"].includes(r.status));
  return { backend, declaredSourceSha: sourceSha, executableSha256: executable.sha256,
    certificationEligible: false, provenanceVerified: false,
    compilerArtifactSha256: pinnedArtifacts.map((a,i) => ({ path: artifactPaths[i], sha256: a.sha256 })),
    verificationScope: "UNATTESTED_COMPILER_SOURCE_ADMISSION_ONLY", guestExecuted: false,
    runtimeTraceVerified: false, physicalIsolationVerified: false, ok, results };
}
