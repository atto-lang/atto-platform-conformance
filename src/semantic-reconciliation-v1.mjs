import {readFile, writeFile, mkdtemp, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, isAbsolute} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {validateCommand, hasCompilerErrorSeverity, hashExecutableBounded} from "./harness.mjs";

const FILE = new URL("../contracts/v1/semantic-reconciliation-cases.v1.json", import.meta.url);
const TARGETS = Object.freeze(["java", "llvm", "net", "wasm"]);
const sha256 = s => createHash("sha256").update(s).digest("hex");

export function validateSemanticManifest(doc) {
  if (!doc || Object.keys(doc).sort().join(",") !==
      ["schemaVersion","status","contractIndex","backends","rules","compilerCases","runtimeCases"].sort().join(",") ||
      doc.schemaVersion !== "semantic-reconciliation/v1" ||
      doc.status !== "TARGET_ONLY_NOT_IMPLEMENTATION_EVIDENCE") throw Error("invalid semantic contract header");
  if (JSON.stringify(doc.backends) !== JSON.stringify(TARGETS)) throw Error("backend target dropped/changed");
  if (!Array.isArray(doc.rules) || doc.rules.length < 4 || new Set(doc.rules).size !== doc.rules.length) throw Error("invalid rule set");
  if (!Array.isArray(doc.compilerCases) || doc.compilerCases.length !== 12 ||
      !Array.isArray(doc.runtimeCases) || doc.runtimeCases.length !== 2) throw Error("missing cases");
  const ids = new Set(), kinds = new Map(), allowed = new Set(["wrappers","futures","actors","effects","overload"]);
  for (const c of doc.compilerCases) {
    if (typeof c.id !== "string" || !/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id)) throw Error("duplicate/invalid case");
    ids.add(c.id);
    if (!allowed.has(c.concern) || !["accept","reject"].includes(c.expect)) throw Error("invalid concern/expectation");
    if (typeof c.source !== "string" || c.source.length < 20 || c.source.length > 8192 ||
        c.source.includes("\0") || !/\b(?:pub fnc|define actor)\b/.test(c.source) ||
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
export async function loadSemanticManifest() {
  return validateSemanticManifest(JSON.parse(await readFile(FILE, "utf8")));
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
export async function runSemanticAdmission({backend, argv, sourceSha, timeoutMs = 12000} = {}) {
  const doc = await loadSemanticManifest();
  if (!TARGETS.includes(backend)) throw Error("unsupported semantic backend");
  if (!argv) return {backend, configured:false, ok:false, status:"UNCONFIGURED", guestRuntimeVerified:false, parityVerified:false};
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
    for (const c of doc.compilerCases) {
      const filename = join(temp, c.id + ".ores");
      await writeFile(filename, c.source, {mode:0o400, flag:"wx"});
      const before = await readFile(filename);
      const fixtureSha256 = sha256(before);
      const cmd = argv.map(a => a === "{file}" ? filename : a);
      const p = spawnSync(cmd[0], cmd.slice(1), {encoding:"utf8", cwd:temp,
        shell:false, timeout:timeoutMs, maxBuffer:1048576, windowsHide:true});
      const after = await readFile(filename);
      const statAfter = await stat(filename);
      let status = classifySemanticCompilerResult(c,p);
      if (sha256(after) !== fixtureSha256 || !statAfter.isFile() || statAfter.nlink !== 1)
        status = "SOURCE_MUTATED";
      results.push({id:c.id, expect:c.expect, status, fixtureSha256,
        observedExit:p.status, observedDiagnosticCode:c.diagnosticCode || null});
    }
  } finally { await rm(temp, {recursive:true, force:true}); }
  const finalHash = await hashExecutableBounded(exe).catch(() => null);
  if (finalHash !== originalHash) {
    for (const r of results) r.status = "EXECUTABLE_CHANGED";
  }
  const ok = results.length === doc.compilerCases.length &&
    results.every(r => r.status === "MATCHED_UNATTESTED");
  return {backend, declaredSourceSha:sourceSha, compilerSha256:originalHash,
    sourceCases:results, configured:true, ok, status:ok?"SOURCE_ADMISSION_MATCHED_UNATTESTED":"NOT_VERIFIED",
    verificationScope:"compiler-source-check-only", runtimeCases:"PENDING",
    guestRuntimeVerified:false, parityVerified:false,
    provenance:"caller-declared SHA is NOT attested to the compiled executable"};
}
