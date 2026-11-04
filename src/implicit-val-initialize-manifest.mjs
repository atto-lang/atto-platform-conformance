import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open} from "node:fs/promises";
import {join, resolve} from "node:path";

const BACKENDS = ["java", "llvm", "wasm", "cranelift", "net", "forge"];
const SHA1 = /^[a-f0-9]{40}$/;
const NAME = /^[a-z][a-z0-9-]*\.ores$/;

// Bounded descriptor reader: a file growing after fstat cannot allocate/read
// more than limit + 1 bytes. Exported for deterministic adversarial I/O tests.
export async function readLimitedBytes(handle, limit, subject) {
  const bytes = Buffer.alloc(limit + 1);
  let used = 0;
  while (used <= limit) {
    const {bytesRead} = await handle.read(bytes, used, bytes.length - used, null);
    if (bytesRead === 0) return bytes.subarray(0, used);
    used += bytesRead;
  }
  throw new Error(`${subject} exceeded the size limit during read`);
}

/** Open the checked file itself, never following a mutable symbolic link. */
async function readBoundedRegularFile(path, limit, subject) {
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    throw new Error("safe no-follow file reads are unavailable on this platform");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw new Error(`${subject} must be a regular file (no symlinks)`, {cause: error});
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) {
      throw new Error(`${subject} must be a regular file no larger than ${limit} bytes`);
    }
    return await readLimitedBytes(handle, limit, subject);
  } finally {
    await handle.close();
  }
}

/**
 * Checks the bytes and admission status of the proposed syntax fixtures.
 * A successful result verifies fixture integrity only. It NEVER certifies
 * compiler execution, code generation, formatter parity, or backend support.
 */
export async function verifyImplicitValInitializeFixtureManifest(directory) {
  const root = resolve(directory);
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(
    (await readBoundedRegularFile(manifestPath, 128 * 1024, "manifest")).toString("utf8")
  );
  if (manifest.schemaVersion !== 1
    || manifest.scope !== "implicit-val-explicit-void-initialize-v1"
    || !Array.isArray(manifest.cases)
    || manifest.cases.length !== 15) {
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
    const bytes = await readBoundedRegularFile(filename, 32 * 1024, "fixture");
    const blobSha = createHash("sha1")
      .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (blobSha !== entry.sourceGitBlobSha1) {
      throw new Error(`fixture Git blob SHA mismatch: ${entry.file}`);
    }
  }
  if (accepted !== 8 || rejected !== 7) {
    throw new Error("expected exactly eight accept and seven reject vectors");
  }
  return Object.freeze({
    fixtureCount: manifest.cases.length,
    accepted,
    rejected,
    gitBlobIntegrity: "VERIFIED",
    backendProof: "NOT_EXECUTED",
  });
}
