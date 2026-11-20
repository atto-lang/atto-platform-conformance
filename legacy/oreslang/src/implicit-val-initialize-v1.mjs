import {readFile, mkdir, writeFile, stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve, join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

export const BACKENDS = Object.freeze(["java", "llvm", "net", "wasm", "forge"]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "fixtures/implicit-val-initialize-v1.json");
const isName = (s) => typeof s === "string" && /^[a-z][a-z0-9-]{1,80}$/.test(s);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Validate inputs before creating any files or invoking any compiler. */
export function validateCorpus(corpus) {
  if (!corpus || Array.isArray(corpus) || corpus.schemaVersion !== 1 ||
      corpus.contract !== "implicit-val-initialize-v1" ||
      corpus.status !== "candidate-unattested" ||
      JSON.stringify(corpus.backends) !== JSON.stringify(BACKENDS) ||
      !Array.isArray(corpus.groups) || corpus.groups.length !== 12 ||
      !Array.isArray(corpus.formatters) ||
      !corpus.formatters.includes("oreslang-format")) {
    throw Error("invalid implicit-val conformance manifest");
  }
  const groups = new Set(), cases = new Set();
  let positives = 0, negatives = 0;
  for (const group of corpus.groups) {
    if (!isName(group.id) || groups.has(group.id) ||
        !isName(group.oracle.toLowerCase().replaceAll("_", "-")) ||
        !Array.isArray(group.cases) || group.cases.length < 1 || group.cases.length > 20) {
      throw Error("invalid fixture group");
    }
    groups.add(group.id);
    for (const c of group.cases) {
      if (!isName(c.id) || cases.has(c.id) ||
          typeof c.source !== "string" ||
          !c.source.endsWith("\n") ||
          Buffer.byteLength(c.source, "utf8") > 65536 ||
          c.source.includes("\0") ||
          c.evidence !== "NOT_EXECUTED" ||
          !c.expected || !["accept", "reject"].includes(c.expected.outcome) ||
          !["parse", "check", "run"].includes(c.expected.phase)) {
        throw Error("invalid or duplicate fixture " + c?.id);
      }
      if (c.expected.outcome === "reject") {
        if (!isName(c.expected.diagnosticClass?.replaceAll("_", "-")) ||
            c.expected.phase === "run") throw Error("negative fixture must have diagnostic class");
        negatives++;
      } else {
        if (c.expected.diagnosticClass !== undefined) throw Error("positive fixture has diagnostic");
        positives++;
      }
      cases.add(c.id);
    }
  }
  if (positives === 0 || negatives === 0 || cases.size < 12)
    throw Error("corpus must cover positive and negative compiler admission");
  return corpus;
}

export async function loadCorpus() {
  const bytes = await readFile(sourcePath);
  if (bytes.length > 1024 * 1024) throw Error("manifest exceeds size limit");
  return validateCorpus(JSON.parse(bytes.toString("utf8")));
}

/**
 * Materialization only; never runs a compiler, formatter or mock adapter.
 * Caller must protect the temp directory and delete it after all native runs.
 */
export async function materializeCorpus(corpus, backend, directory) {
  validateCorpus(corpus);
  if (!BACKENDS.includes(backend)) throw Error("unrecognized backend");
  const target = resolve(directory);
  const info = await stat(target);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw Error("fixture destination must be a private directory");
  const results = [];
  for (const group of corpus.groups) {
    for (const c of group.cases) {
      const filename = group.id + "--" + c.id + ".ores";
      const path = join(target, filename);
      const bytes = Buffer.from(c.source, "utf8");
      await writeFile(path, bytes, {flag:"wx",mode:0o400});
      results.push({group:group.id, caseId:c.id, path,
        sha256:sha256(bytes), expected:c.expected,
        evidence:"NOT_EXECUTED"});
    }
  }
  return {contract:corpus.contract,backend,materialized:results.length,
    verificationScope:"fixture-materialization-only",
    executionEvidence:"NOT_EXECUTED",results};
}
