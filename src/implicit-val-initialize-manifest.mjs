import {createHash} from "node:crypto";
import {lstat, readFile} from "node:fs/promises";
import {join, resolve} from "node:path";

const BACKENDS = ["java", "llvm", "net", "wasm", "forge"];
const SHA1 = /^[a-f0-9]{40}$/;
const NAME = /^[a-z][a-z0-9-]*\.ores$/;

/**
 * Checks the bytes and admission status of the proposed syntax fixtures.
 * A successful result verifies fixture integrity only. It NEVER certifies
 * compiler execution, code generation, formatter parity, or backend support.
 */
export async function verifyImplicitValInitializeFixtureManifest(directory) {
  const root = resolve(directory);
  const manifestPath = join(root, "manifest.json");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.size > 128 * 1024) {
    throw new Error("manifest must be a regular file no larger than 128 KiB");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1
    || manifest.scope !== "implicit-val-explicit-void-initialize-v1"
    || !Array.isArray(manifest.cases)
    || manifest.cases.length !== 12) {
    throw new Error("unexpected manifest schema, scope, or fixture count");
  }
  if (manifest.readiness !== "PROPOSED_NOT_EXECUTED"
    || !manifest.evidence
    || !Array.isArray(manifest.evidence.compilerBackedTests)
    || manifest.evidence.compilerBackedTests.length !== 0) {
    throw new Error("fixture-only manifest must not assert compiler evidence");
  }
  if (!Array.isArray(manifest.evidence.formatterIdempotenceTests)
    || manifest.evidence.formatterIdempotenceTests.length !== 0) {
    throw new Error("fixture-only manifest must not assert formatter proof");
  }
  const seen = new Set();
  let accepted = 0;
  let rejected = 0;
  for (const entry of manifest.cases) {
    if (!entry || typeof entry !== "object"
      || typeof entry.file !== "string" || !NAME.test(entry.file)
      || entry.id !== entry.file.slice(0, -5)
      || seen.has(entry.id)
      || !SHA1.test(entry.sourceGitBlobSha1)) {
      throw new Error("invalid, duplicate, or unpinned fixture identity");
    }
    seen.add(entry.id);
    if (!Array.isArray(entry.confirmedBackends)
      || entry.confirmedBackends.length !== 0
      || !Array.isArray(entry.pendingBackends)
      || JSON.stringify([...entry.pendingBackends].sort())
        !== JSON.stringify([...BACKENDS].sort())) {
      throw new Error("fixture manifest must not invent backend confirmations");
    }
    if (entry.expect === "accept") {
      accepted++;
      if (!/^-?[0-9]+$/.test(entry.expectedI64 ?? "")) {
        throw new Error("accepted fixture requires an exact expected integer");
      }
    } else if (entry.expect === "reject") {
      rejected++;
      if (entry.expectedI64 !== undefined) {
        throw new Error("rejected fixture cannot specify a runtime return");
      }
    } else {
      throw new Error("fixture must be explicitly accepted or rejected");
    }
    const filename = join(root, entry.file);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.size > 32 * 1024) {
      throw new Error("fixture must be a regular file no larger than 32 KiB");
    }
    const bytes = await readFile(filename);
    const blobSha = createHash("sha1")
      .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (blobSha !== entry.sourceGitBlobSha1) {
      throw new Error(`fixture Git blob SHA mismatch: ${entry.file}`);
    }
  }
  if (accepted !== 7 || rejected !== 5) {
    throw new Error("expected exactly seven accept and five reject vectors");
  }
  return Object.freeze({
    fixtureCount: manifest.cases.length,
    accepted,
    rejected,
    gitBlobIntegrity: "VERIFIED",
    backendProof: "NOT_EXECUTED",
  });
}
