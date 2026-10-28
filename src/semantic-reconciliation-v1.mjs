import {readFile, writeFile, mkdtemp, rm, lstat} from "node:fs/promises";
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
  if (!Array.isArray(doc.compilerCases) || doc.compilerCases.length !== 36 ||
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
// A subset never certifies all compiler vectors or runtime parity.
const SUITE_CASE_IDS = Object.freeze({
  "future-map": Object.freeze([
    "future-map-preserves-nested-return",
    "future-map-rejects-implicit-adoption"
  ])
});
export function selectSemanticCases(doc, suite = "all") {
  if (suite === "all") return doc.compilerCases;
  if (!Object.hasOwn(SUITE_CASE_IDS, suite)) throw Error("unsupported semantic suite: " + suite);
  const cases = SUITE_CASE_IDS[suite].map(id => doc.compilerCases.find(c => c.id === id));
  if (cases.some(c => !c) || cases.length !== 2 ||
      cases[0].expect !== "accept" || cases[1].expect !== "reject" ||
      cases.some(c => c.concern !== "futures"))
    throw Error("invalid or incomplete semantic suite: " + suite);
  return cases;
}
export function classifySemanticCompilerResult(c, output) {
  if (output.error || output.signal || !Number.isInteger(output.status)) return "INFRA_OR_CRASH";
  const lines = String(output.stdout || "") + "\n" + String(output.stderr || "");
  if (/\b(segmentation fault|fatal signal|unhandled exception|traceback)\b/i.test(lines)) return "INFRA_OR_CRASH";
  if (c.expect === "accept") return output.status === 0 && !hasCompilerErrorSeverity(lines) ? "MATCHED_UNATTESTED" : "MISMATCH";
  // A random syntax rejection or a source echo cannot prove the invariant. The
  // exact proposed diagnostic code must be a primary error diagnostic.
  const expected = "error[" + c.diagnosticCode + "]:";
  // Exactly one primary diagnostic: multiple errors can hide an unrelated
  // earlier rejection behind a later matching semantic diagnostic.
  const errors = lines.split(/\r?\n/).map(line => line.trimStart())
    .filter(line => /^error(?:\[[A-Za-z0-9_]+\])?:/.test(line));
  return output.status === 1 && errors.length === 1 && errors[0].startsWith(expected)
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
  try {
    for (const c of selectedCases) {
      const filename = join(temp, c.id + ".ores");
      await writeFile(filename, c.source, {mode:0o400, flag:"wx"});
      const beforeStat = await lstat(filename);
      const before = await readRegularFixtureBytes(filename);
      const fixtureSha256 = sha256(before);
      const cmd = argv.map(a => a === "{file}" ? filename : a);
      const p = spawnSync(cmd[0], cmd.slice(1), {encoding:"utf8", cwd:temp,
        shell:false, timeout:timeoutMs, maxBuffer:1048576, windowsHide:true});
      let status = classifySemanticCompilerResult(c,p);
      if (!(await semanticFixtureUnchanged(filename, beforeStat, fixtureSha256)))
        status = "SOURCE_MUTATED";
      results.push({id:c.id, expect:c.expect, status, fixtureSha256,
        observedExit:p.status, observedDiagnosticCode:c.diagnosticCode || null});
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
