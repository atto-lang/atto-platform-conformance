export const REACHABILITY_SCHEMA = "oreslang.reachability/1";

const ARRAY_FIELDS = Object.freeze([
  "entryPoints",
  "retainedSymbols",
  "removedSymbols",
  "externalBindings",
  "languageFeatures",
  "runtimeOperations"
]);

const EXACT_FIELDS = new Set([
  "schema",
  "entryPoints",
  "preservePublicApi",
  "retainedSymbols",
  "removedSymbols",
  "externalBindings",
  "languageFeatures",
  "runtimeOperations"
]);

function requireSortedUniqueStrings(name, value) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  let previous = null;
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item !== item.trim()) {
      throw new Error(`${name} must contain non-empty canonical strings`);
    }
    if (seen.has(item)) throw new Error(`${name} contains duplicate '${item}'`);
    if (previous !== null && previous.localeCompare(item) >= 0) {
      throw new Error(`${name} must be strictly sorted`);
    }
    seen.add(item);
    previous = item;
  }
}

export function validateReachabilityManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("reachability manifest must be an object");
  }

  const keys = Object.keys(manifest);
  for (const key of keys) {
    if (!EXACT_FIELDS.has(key)) throw new Error(`unexpected reachability field '${key}'`);
  }
  for (const key of EXACT_FIELDS) {
    if (!Object.hasOwn(manifest, key)) throw new Error(`missing reachability field '${key}'`);
  }

  if (manifest.schema !== REACHABILITY_SCHEMA) {
    throw new Error(`unsupported reachability schema '${manifest.schema}'`);
  }
  if (typeof manifest.preservePublicApi !== "boolean") {
    throw new Error("preservePublicApi must be boolean");
  }

  for (const field of ARRAY_FIELDS) requireSortedUniqueStrings(field, manifest[field]);

  const retained = new Set(manifest.retainedSymbols);
  for (const removed of manifest.removedSymbols) {
    if (retained.has(removed)) {
      throw new Error(`symbol '${removed}' cannot be both retained and removed`);
    }
  }

  return true;
}
