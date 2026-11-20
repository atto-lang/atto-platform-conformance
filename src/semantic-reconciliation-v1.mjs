import {readFile, writeFile, mkdtemp, rm, lstat, readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, isAbsolute} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {validateCommand, hasCompilerErrorSeverity, hashExecutableBounded, readRegularFixtureBytes} from "./harness.mjs";

const FILE = new URL("../contracts/v1/semantic-reconciliation-cases.v1.json", import.meta.url);
const TARGETS = Object.freeze(["java", "llvm", "net", "wasm", "forge"]);
const sha256 = s => createHash("sha256").update(s).digest("hex");

export function validateSemanticManifest(doc) {
  if (!doc || Object.keys(doc).sort().join(",") !==
      ["schemaVersion","status","contractIndex","backends","rules","compilerCases","runtimeCases"].sort().join(",") ||
      doc.schemaVersion !== "semantic-reconciliation/v1" ||
      doc.status !== "TARGET_ONLY_NOT_IMPLEMENTATION_EVIDENCE") throw Error("invalid semantic contract header");
  if (JSON.stringify(doc.backends) !== JSON.stringify(TARGETS)) throw Error("backend target dropped/changed");
  if (!Array.isArray(doc.rules) || doc.rules.length < 4 || new Set(doc.rules).size !== doc.rules.length) throw Error("invalid rule set");
  if (!Array.isArray(doc.compilerCases) || doc.compilerCases.length !== 44 ||
      !Array.isArray(doc.runtimeCases) || doc.runtimeCases.length !== 2) throw Error("missing cases");
  const ids = new Set(), kinds = new Map(), allowed = new Set(["wrappers","futures","actors","effects","overload","ownership"]);
  for (const c of doc.compilerCases) {
    if (typeof c.id !== "string" || !/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id)) throw Error("duplicate/invalid case");
    ids.add(c.id);
    if (!allowed.has(c.concern) || !["accept","reject"].includes(c.expect)) throw Error("invalid concern/expectation");
    if (typeof c.source !== "string" || c.source.length < 20 || c.source.length > 8192 ||
        c.source.includes("\0") || !/\b(?:pub(?:\s+(?:async|suspends))?\s+fnc|define actor)\b/.test(c.source) ||
        typeof c.rationale !== "string" || !c.rationale || !/^https:\/\/github.com\/ores-truffle-oreslang\//.test(c.authority))
      throw Error("invalid self-contained source or authority");
    if (c.expect === "reject") {
      if (!/^E_[A-Z_]{4,64}$/.test(c.diagnosticCode)) throw Error("negative requires exact semantic code");
    } else if (Object.hasOwn(c, "diagnosticCode")) throw Error("positive has negative diagnostic");
    if (JSON.stringify(Object.keys(c.backends)) !== JSON.stringify(TARGETS) ||
        Object.values(c.backends).some(s => s !== "PENDING_GUEST_PROOF"))
      throw Error("no backend may be silently verified or omitted");
    const entry = kinds.get(c.concern) || new Set();
    entry.add(c.expect);
    kinds.set(c.concern, entry);
  }
  for (const category of allowed) {
    if (!kinds.get(category)?.has("accept") || !kinds.get(category)?.has("reject"))
      throw Error("missing positive/negative coverage: " + category);
  }
  for (const c of doc.runtimeCases) {
    if (!/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id) ||
        !Array.isArray(c.expectedTrace) || c.expectedTrace.length < 3 ||
        !Array.isArray(c.requirements) || !c.requirements.length ||
        JSON.stringify(Object.keys(c.backends)) !== JSON.stringify(TARGETS) ||
        Object.values(c.backends).some(s => s !== "PENDING_GUEST_PROOF"))
      throw Error("invalid or pre-promoted runtime trace");
    ids.add(c.id);
  }
  return doc;
}
// Snapshot the exact manifest bytes used for admission, not merely its parsed
// cases. This digest is evidence of what was read, NOT source-build attestation.
export async function loadSemanticManifestSnapshot() {
  const bytes = await readFile(FILE);
  return {
    doc: validateSemanticManifest(JSON.parse(bytes.toString("utf8"))),
    manifestSha256: sha256(bytes)
  };
}
export async function loadSemanticManifest() {
  return (await loadSemanticManifestSnapshot()).doc;
}
// A selected subset is an admission probe, never full compiler or runtime
// parity. Each suite is an immutable, ordered positive/negative pair inventory.
const SUITE_SPECS = Object.freeze({
  "future-map": Object.freeze({
    concern:"futures",
    ids:Object.freeze([
      "future-map-preserves-nested-return",
      "future-map-rejects-implicit-adoption"
    ])
  }),
  "heap-ownership": Object.freeze({
    concern:"ownership",
    ids:Object.freeze([
      "heap-array-scoped-read-loans",
      "heap-array-resize-live-loan",
      "heap-array-scoped-exclusive",
      "heap-array-exclusive-vs-read",
      "heap-array-owned-element-copy",
      "heap-array-borrowed-element-return",
      "heap-array-whole-owner-take",
      "heap-array-indexed-take"
    ])
  })
});
export function selectSemanticCases(doc, suite = "all") {
  if (suite === "all") return doc.compilerCases;
  // Object.hasOwn prevents inherited properties (e.g. constructor) from
  // bypassing the strict suite-name allowlist.
  if (!Object.hasOwn(SUITE_SPECS, suite)) throw Error("unsupported semantic suite: " + suite);
  const spec = SUITE_SPECS[suite];
  const cases = spec.ids.map(id => doc.compilerCases.find(c => c.id === id));
  if (cases.some(c => !c) || cases.length !== spec.ids.length ||
      cases.some((c,i) => c.concern !== spec.concern ||
        c.expect !== (i % 2 === 0 ? "accept" : "reject")))
    throw Error("invalid or incomplete semantic suite: " + suite);
  return cases;
}

// Do not confuse the manifest's expected diagnostic with one actually emitted
// by the compiler. Observed codes must come from a unique primary stderr error.
export function observedSemanticDiagnostic(output) {
  const diagnostics = String(output?.stderr || "").split(/\r?\n/).map(x => x.trimStart())
    .filter(x => /^error(?:\[[A-Za-z0-9_]+\])?:/.test(x));
  if (diagnostics.length !== 1) return null;
  const matched = /^error\[(E_[A-Z_]{4,64})\]:\s*\S/.exec(diagnostics[0]);
  return matched ? matched[1] : null;
}

export function classifySemanticCompilerResult(c, output) {
  if (output.error || output.signal || !Number.isInteger(output.status)) return "INFRA_OR_CRASH";
  const stdout = String(output.stdout || "");
  const stderr = String(output.stderr || "");
  const lines = stdout + "\n" + stderr;
  if (/\b(segmentation fault|fatal signal|unhandled exception|traceback|compiler panicked)\b/i.test(lines))
    return "INFRA_OR_CRASH";
  if (c.expect === "accept")
    return output.status === 0 && !hasCompilerErrorSeverity(lines) ? "MATCHED_UNATTESTED" : "MISMATCH";
  // A rejection must have no emitted stdout (including partial IR), and its
  // single *stderr* primary error must be the exact semantic diagnostic.
  // Requiring stderr prevents a printed/echoed "error[E_X]" from masquerading
  // as the compiler's diagnosis when a separate parser error caused failure.
  if (stdout.trim() !== "") return "MISMATCH";
  if (/(?:^|\n)\s*(?:define\s+[^\n]*@|declare\s+[^\n]*@|; ModuleID\s*=|source_filename\s*=|target (?:triple|datalayout)\s*=|attributes\s+#\d+\s*=)/m.test(stderr))
    return "MISMATCH";
  return output.status === 1 && observedSemanticDiagnostic(output) === c.diagnosticCode
    ? "MATCHED_UNATTESTED" : "MISMATCH";
}

// The compiler is an untrusted process with the same filesystem access as
// this runner. Reject any changed path identity, symlink, hard-link, or bytes
// after running it; never follow a substitute path or read unbounded data.
// This is post-execution tamper detection, not a sandbox against a racing
// malicious compiler or proof of immutable source/build provenance.
function sameFixtureIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
    a.size === b.size && a.nlink === b.nlink &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
export async function semanticFixtureUnchanged(filename, beforeStat, beforeSha256) {
  try {
    const first = await lstat(filename);
    if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1 ||
        !sameFixtureIdentity(beforeStat, first)) return false;
    const bytes = await readRegularFixtureBytes(filename);
    const last = await lstat(filename);
    return sameFixtureIdentity(first, last) && sha256(bytes) === beforeSha256;
  } catch {
    // Unlink, permission denial, descriptor races and malformed replacement
    // paths are all mutation, not a passing or skipped admission result.
    return false;
  }
}
export async function runSemanticAdmission({backend, argv, sourceSha, timeoutMs = 12000, suite = "all"} = {}) {
  const {doc, manifestSha256} = await loadSemanticManifestSnapshot();
  if (!TARGETS.includes(backend)) throw Error("unsupported semantic backend");
  const selectedCases = selectSemanticCases(doc, suite);
  const selectedCaseIds = selectedCases.map(c => c.id);
  if (!argv) return {backend, suite, selectedCaseIds, fullInventoryMatched:false,
    configured:false, ok:false, status:"UNCONFIGURED", guestRuntimeVerified:false, parityVerified:false};
  validateCommand(argv);
  if (!/^[0-9a-f]{40}$/.test(sourceSha || "")) throw Error("40-hex source SHA required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw Error("invalid timeout");
  const exe = argv[0];
  if (!isAbsolute(exe)) throw Error("executable must be absolute");
  let originalHash;
  try { originalHash = await hashExecutableBounded(exe); }
  catch { return {backend, configured:false, ok:false, status:"UNHASHABLE_EXECUTABLE", guestRuntimeVerified:false, parityVerified:false}; }
  const temp = await mkdtemp(join(tmpdir(), "ores-semantic-"));
  const results = [];
  const fixtureSnapshots = [];
  try {
    for (const c of selectedCases) {
      const filename = join(temp, c.id + ".ores");
      await writeFile(filename, c.source, {mode:0o400, flag:"wx"});
      const beforeStat = await lstat(filename);
      const before = await readRegularFixtureBytes(filename);
      const fixtureSha256 = sha256(before);
      fixtureSnapshots.push({filename, beforeStat, fixtureSha256});
      const cmd = argv.map(a => a === "{file}" ? filename : a);
      // Record source-directory entries before compiler execution. A source
      // admission check must not leave IR, binaries, or scratch artifacts.
      const entriesBefore = (await readdir(temp)).sort();
      const p = spawnSync(cmd[0], cmd.slice(1), {encoding:"utf8", cwd:temp,
        shell:false, timeout:timeoutMs, maxBuffer:1048576, windowsHide:true});
      let status = classifySemanticCompilerResult(c,p);
      const entriesAfter = await readdir(temp).then(x => x.sort()).catch(() => null);
      if (entriesAfter === null || JSON.stringify(entriesAfter) !== JSON.stringify(entriesBefore))
        status = "UNEXPECTED_COMPILER_ARTIFACT";
      if (!(await semanticFixtureUnchanged(filename, beforeStat, fixtureSha256)))
        status = "SOURCE_MUTATED";
      results.push({id:c.id, expect:c.expect, status, fixtureSha256,
        observedExit:p.status, expectedDiagnosticCode:c.diagnosticCode || null,
        observedDiagnosticCode:observedSemanticDiagnostic(p)});
    }
    // A later compiler can rewrite an earlier source fixture without
    // changing its own input. Invalidate the earlier result too.
    for (const [index, snapshot] of fixtureSnapshots.entries()) {
      if (!(await semanticFixtureUnchanged(
          snapshot.filename, snapshot.beforeStat, snapshot.fixtureSha256)))
        results[index].status = "SOURCE_MUTATED";
    }
  } finally { await rm(temp, {recursive:true, force:true}); }
  const finalHash = await hashExecutableBounded(exe).catch(() => null);
  if (finalHash !== originalHash) {
    for (const r of results) r.status = "EXECUTABLE_CHANGED";
  }
  const finalManifestSha256 = await readFile(FILE).then(sha256).catch(() => null);
  const manifestUnchanged = finalManifestSha256 === manifestSha256;
  if (!manifestUnchanged) {
    for (const r of results) r.status = "MANIFEST_CHANGED";
  }
  const ok = results.length === selectedCases.length &&
    results.every(r => r.status === "MATCHED_UNATTESTED");
  const fullInventoryMatched = ok && suite === "all";
  const status = !ok ? "NOT_VERIFIED" : fullInventoryMatched
    ? "SOURCE_ADMISSION_MATCHED_UNATTESTED" : "SELECTED_SOURCE_ADMISSION_MATCHED_UNATTESTED";
  return {backend, suite, selectedCaseIds, totalCompilerCases:doc.compilerCases.length,
    fullInventoryMatched, manifestSha256, manifestUnchanged,
    declaredSourceSha:sourceSha, compilerSha256:originalHash,
    sourceCases:results, configured:true, ok, status,
    verificationScope:"compiler-source-check-only", runtimeCases:"PENDING",
    guestRuntimeVerified:false, parityVerified:false,
    provenance:"caller-declared SHA is NOT attested to the compiled executable"};
}
