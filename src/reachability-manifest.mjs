export const REACHABILITY_SCHEMA = "oreslang.reachability/1";
export const BUILD_REACHABILITY_SCHEMA = "oreslang.build-reachability/1";

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

const BUILD_FIELDS = new Set([
  "schema",
  "entryUnit",
  "retainedUnits",
  "removedUnits",
  "units"
]);

function requireObject(name, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function requireExactFields(name, value, expected) {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`unexpected ${name} field '${key}'`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new Error(`missing ${name} field '${key}'`);
  }
}

function requireCanonicalString(name, value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function requireSortedUniqueStrings(name, value) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  let previous = null;
  const seen = new Set();
  for (const item of value) {
    requireCanonicalString(name, item);
    if (seen.has(item)) throw new Error(`${name} contains duplicate '${item}'`);
    if (previous !== null && previous.localeCompare(item) >= 0) {
      throw new Error(`${name} must be strictly sorted`);
    }
    seen.add(item);
    previous = item;
  }
}

function requireDisjoint(label, retained, removed) {
  const live = new Set(retained);
  for (const item of removed) {
    if (live.has(item)) throw new Error(`${label} '${item}' cannot be both retained and removed`);
  }
}

export function validateReachabilityManifest(manifest) {
  requireObject("reachability manifest", manifest);
  requireExactFields("reachability", manifest, EXACT_FIELDS);

  if (manifest.schema !== REACHABILITY_SCHEMA) {
    throw new Error(`unsupported reachability schema '${manifest.schema}'`);
  }
  if (typeof manifest.preservePublicApi !== "boolean") {
    throw new Error("preservePublicApi must be boolean");
  }

  for (const field of ARRAY_FIELDS) requireSortedUniqueStrings(field, manifest[field]);
  requireDisjoint("symbol", manifest.retainedSymbols, manifest.removedSymbols);
  return true;
}

export function validateBuildReachabilityManifest(manifest) {
  requireObject("build reachability manifest", manifest);
  requireExactFields("build reachability", manifest, BUILD_FIELDS);

  if (manifest.schema !== BUILD_REACHABILITY_SCHEMA) {
    throw new Error(`unsupported build reachability schema '${manifest.schema}'`);
  }
  requireCanonicalString("entryUnit", manifest.entryUnit);
  requireSortedUniqueStrings("retainedUnits", manifest.retainedUnits);
  requireSortedUniqueStrings("removedUnits", manifest.removedUnits);
  requireDisjoint("unit", manifest.retainedUnits, manifest.removedUnits);

  if (!manifest.retainedUnits.includes(manifest.entryUnit)) {
    throw new Error("entryUnit must be retained");
  }

  requireObject("units", manifest.units);
  const unitKeys = Object.keys(manifest.units);
  const sortedKeys = [...unitKeys].sort((a, b) => a.localeCompare(b));
  if (unitKeys.length !== sortedKeys.length
      || unitKeys.some((key, index) => key !== sortedKeys[index])) {
    throw new Error("units keys must be strictly sorted");
  }
  if (unitKeys.length !== manifest.retainedUnits.length
      || unitKeys.some((key, index) => key !== manifest.retainedUnits[index])) {
    throw new Error("units must exactly cover retainedUnits");
  }

  for (const key of unitKeys) {
    requireCanonicalString("unit id", key);
    validateReachabilityManifest(manifest.units[key]);
  }
  return true;
}

export function validateAnyReachabilityManifest(manifest) {
  requireObject("reachability manifest", manifest);
  if (manifest.schema === REACHABILITY_SCHEMA) {
    return validateReachabilityManifest(manifest);
  }
  if (manifest.schema === BUILD_REACHABILITY_SCHEMA) {
    return validateBuildReachabilityManifest(manifest);
  }
  throw new Error(`unsupported reachability schema '${manifest.schema}'`);
}
