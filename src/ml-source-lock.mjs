const repos = ["oreslang-autograd", "oreslang-ml", "oreslang-tensor"];
const edgeList = [["oreslang-autograd", "oreslang-tensor"],
                  ["oreslang-ml", "oreslang-autograd"]];
const fields = ["schemaVersion", "kind", "organization", "expectedSourceFiles",
  "expectedImports", "requiredCrossRepositoryEdges", "sourceBlobs",
  "sourceExportAuthorized", "guestExecution", "releaseReady"];
function deny(msg) { throw Error("ML_SOURCE_LOCK_REJECTED: " + msg); }
function keysEqual(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
export function validateMlSourceLock(lock, registry) {
  if (!keysEqual(lock, fields) || lock.schemaVersion !== 1 ||
      !Number.isSafeInteger(lock.schemaVersion) ||
      lock.kind !== "PINNED_SOURCE_BLOBS_NOT_GUEST" ||
      lock.organization !== "ores-truffle-oreslang" ||
      lock.sourceExportAuthorized !== false || lock.guestExecution !== false ||
      lock.releaseReady !== false) deny("false source/admission declaration");
  if (!registry || !Array.isArray(registry.repositories) ||
      new Set(registry.repositories.map(r=>r.name)).size !== registry.repositories.length)
    deny("invalid organization inventory");
  const inventory = new Map(registry.repositories.map(r=>[r.name,r]));
  if (!Array.isArray(lock.requiredCrossRepositoryEdges) ||
      JSON.stringify(lock.requiredCrossRepositoryEdges) !== JSON.stringify(edgeList))
    deny("source-edge topology drift");
  for (const [consumer, provider] of edgeList) {
    if (!inventory.has(consumer) || !inventory.has(provider) ||
        !Array.isArray(inventory.get(consumer).upstreams) ||
        !inventory.get(consumer).upstreams.includes(provider))
      deny("missing planned organization-level owning edge");
  }
  if (typeof lock.sourceBlobs !== "object" || !lock.sourceBlobs ||
      Array.isArray(lock.sourceBlobs) ||
      !Number.isSafeInteger(lock.expectedSourceFiles) ||
      lock.expectedSourceFiles !== 14 ||
      !Number.isSafeInteger(lock.expectedImports) || lock.expectedImports !== 52)
    deny("source count or import-count mismatch");
  const files = Object.entries(lock.sourceBlobs);
  if (files.length !== 14) deny("incomplete source set");
  const sourcesByRepo = new Map(repos.map(n=>[n,0]));
  for (const [path, sha] of files) {
    const m = /^(oreslang-(?:tensor|autograd|ml))\/(?:src|tests|examples)\/[a-zA-Z0-9_/-]+\.ores$/.exec(path);
    if (!m || path.includes("//") || path.includes("..") ||
        !/^[a-f0-9]{40}$/.test(sha)) deny("untrusted source path or Git blob SHA");
    sourcesByRepo.set(m[1], sourcesByRepo.get(m[1]) + 1);
  }
  if (JSON.stringify([...sourcesByRepo.values()]) !== JSON.stringify([6,4,4]))
    deny("provider source counts drifted");
  return Object.freeze({status:"SOURCE_BLOBS_LOCKED_NOT_COMPILED", files:files.length,
    importDeclarations:lock.expectedImports, directSourceEdges:edgeList.length,
    registryChecked:true, sourceBytesRead:0, guestExecuted:false,
    releaseReady:false, exportAuthorized:false});
}
