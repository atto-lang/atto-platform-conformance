import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const BACKENDS = ["llvm", "java", "net", "wasm", "js"];
const ROOT = new URL("../fixtures/actor-memory/v1/", import.meta.url);
const validSha = /^[0-9a-f]{40}$/;

export function validateActorMemorySourceContract(manifest, readFixture) {
  const reject = message => { throw new Error("actor memory contract: " + message); };
  if (manifest.schemaVersion !== 1 ||
      manifest.scope !== "actor-owned-scoped-i64-drop-v1" ||
      manifest.evidenceLevel !== "source-fixtures-only") reject("wrong scope");
  if (!Array.isArray(manifest.verifiedRuntimeBackends) ||
      manifest.verifiedRuntimeBackends.length !== 0) reject("unearned runtime evidence");
  if (!manifest.backends ||
      JSON.stringify(Object.keys(manifest.backends).sort()) !==
          JSON.stringify([...BACKENDS].sort())) reject("five backend inventory");
  for (const backend of BACKENDS) {
    const entry = manifest.backends[backend];
    if (!entry || entry.verified !== false ||
        !["experimental-gated", "pending"].includes(entry.implementation))
      reject("unearned backend certification: " + backend);
  }
  if (manifest.backends.llvm.implementation !== "experimental-gated" ||
      manifest.backends.llvm.requiredFlag !== "--experimental-owned-int")
    reject("LLVM experimental feature gating");
  for (const backend of BACKENDS.filter(x => x !== "llvm"))
    if (manifest.backends[backend].implementation !== "pending")
      reject("non-LLVM implementation evidence unsupported");
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 2)
    reject("case inventory drift");
  const cases = new Map(manifest.cases.map(c => [c.id, c]));
  if (cases.size !== 2 || !cases.has("synchronous-owned-drop") ||
      !cases.has("reject-scoped-borrow-escape")) reject("case identity drift");
  for (const item of manifest.cases) {
    if (!/^[a-z0-9-]+\.ores$/.test(item.file) ||
        !validSha.test(item.sourceGitBlobSha1) ||
        item.runtimeVerified !== false) reject("unsafe path, source hash or false evidence");
    const contents = readFixture(item.file);
    if (typeof contents !== "string" || !contents.endsWith("\n") ||
        contents.includes("\r")) reject("noncanonical fixture encoding");
    const bytes = Buffer.from(contents, "utf8");
    const gitBlob = createHash("sha1")
        .update(Buffer.from("blob " + bytes.length + "\0"))
        .update(bytes).digest("hex");
    if (gitBlob !== item.sourceGitBlobSha1)
      reject("source blob does not match declared fixture: " + item.file);
  }
  const valid = cases.get("synchronous-owned-drop");
  if (valid.expect !== "accept-and-execute" ||
      valid.semanticExpected?.sourceActorMessages !== 8 ||
      valid.semanticExpected?.lastResult !== 1004 ||
      valid.semanticExpected?.actorHeapOwnersAtStop !== 0) reject("positive oracle drift");
  const invalid = cases.get("reject-scoped-borrow-escape");
  if (invalid.expect !== "reject-no-ir" ||
      invalid.diagnosticClass !== "borrowed-owner-cannot-escape")
    reject("borrow-escape oracle drift");
  return {source_fixture_count:2,backend_count:5,guest_verified:false,zero_gc_verified:false};
}

export function verifyCurrentActorMemoryFixtureContract() {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", ROOT), "utf8"));
  return validateActorMemorySourceContract(manifest, file =>
      readFileSync(new URL(file, ROOT), "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
  console.log(JSON.stringify(verifyCurrentActorMemoryFixtureContract(), null, 2));
