import { readFileSync } from "node:fs";

export const registryUrl = new URL("../integration/org-repositories.v1.json", import.meta.url);
const areas = new Set(["compiler", "contracts", "conformance", "runtime", "platform", "library", "tooling", "demo", "docs"]);
const fields = ["area", "name", "nextGate", "upstreams", "visibility"];

function requireRecord(value, context) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(context + ": expected a JSON object");
  }
}
function exactFields(record, expected, context) {
  const found = Object.keys(record).sort();
  if (JSON.stringify(found) !== JSON.stringify([...expected].sort())) {
    throw new Error(context + ": wrong object fields");
  }
}
function checkRepoName(name, context) {
  if (typeof name !== "string" || !/^(?:\.github|[a-z0-9][a-z0-9._-]{0,99})$/.test(name) ||
      name.includes("..") || name.endsWith(".") || name.endsWith("-")) {
    throw new Error(context + ": invalid same-organization repository name");
  }
}
function strictlySortedDistinct(values, context) {
  for (let i = 1; i < values.length; i++) {
    if (!(values[i - 1] < values[i])) throw new Error(context + ": must be sorted and unique");
  }
}

// Pure, offline structural admission. It does not fetch or attest GitHub content,
// validate actual dependency pins, run compilers, or authorize private source export.
export function validateOrgIntegrationRegistry(registry) {
  requireRecord(registry, "registry");
  exactFields(registry,
    ["schemaVersion", "organization", "snapshotDate", "expectedRepositoryCount", "description", "repositories"], "registry");
  if (registry.schemaVersion !== 1 || registry.organization !== "ores-truffle-oreslang" ||
      typeof registry.snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(registry.snapshotDate) ||
      typeof registry.description !== "string" || !registry.description.includes("NOT") ||
      !Number.isSafeInteger(registry.expectedRepositoryCount) || registry.expectedRepositoryCount < 1 ||
      registry.expectedRepositoryCount > 256) {
    throw new Error("registry: invalid version/owner/snapshot/size/claim boundary");
  }
  if (!Array.isArray(registry.repositories) ||
      registry.repositories.length !== registry.expectedRepositoryCount) {
    throw new Error("registry: repository count mismatch");
  }

  const byName = new Map();
  const areaCounts = Object.fromEntries([...areas].map(x => [x, 0]));
  let edgeCount = 0;
  for (const entry of registry.repositories) {
    requireRecord(entry, "repository");
    exactFields(entry, fields, "repository");
    checkRepoName(entry.name, "repository");
    if (byName.has(entry.name)) throw new Error("repository: duplicate name " + entry.name);
    if (!areas.has(entry.area)) throw new Error("repository: invalid area " + entry.name);
    if (entry.visibility !== "private" && entry.visibility !== "public") {
      throw new Error("repository: invalid visibility " + entry.name);
    }
    if (typeof entry.nextGate !== "string" || entry.nextGate.trim() !== entry.nextGate ||
        entry.nextGate.length < 20 || entry.nextGate.length > 400) {
      throw new Error("repository: missing or malformed acceptance gate " + entry.name);
    }
    if (!Array.isArray(entry.upstreams) || entry.upstreams.length > 25) {
      throw new Error("repository: invalid upstream list " + entry.name);
    }
    for (const upstream of entry.upstreams) checkRepoName(upstream, entry.name);
    strictlySortedDistinct(entry.upstreams, entry.name + " upstreams");
    byName.set(entry.name, entry);
    areaCounts[entry.area]++;
    edgeCount += entry.upstreams.length;
  }
  // Locale-independent lexical ordering so CI and tools cannot disagree on registry identity.
  strictlySortedDistinct(registry.repositories.map(r => r.name), "repository inventory");
  const dependencyCount = new Map();
  const dependents = new Map();
  for (const r of registry.repositories) {
    dependencyCount.set(r.name, r.upstreams.length);
    dependents.set(r.name, []);
    for (const dep of r.upstreams) {
      if (!byName.has(dep) || dep === r.name) {
        throw new Error("repository: missing or self upstream " + r.name + " -> " + dep);
      }
    }
  }
  for (const r of registry.repositories) {
    for (const dep of r.upstreams) dependents.get(dep).push(r.name);
  }
  let ready = [...dependencyCount].filter(([, n]) => n === 0).map(([n]) => n).sort();
  const ordered = [];
  while (ready.length) {
    const name = ready.shift();
    ordered.push(name);
    for (const child of dependents.get(name)) {
      const remaining = dependencyCount.get(child) - 1;
      dependencyCount.set(child, remaining);
      if (remaining === 0) { ready.push(child); ready.sort(); }
    }
  }
  if (ordered.length !== registry.repositories.length) {
    throw new Error("registry: circular integration dependency; separate contract from implementation");
  }
  return { count: byName.size, edgeCount, areaCounts, topologicalOrder: ordered };
}
export function loadOrgIntegrationRegistry(url = registryUrl) {
  return JSON.parse(readFileSync(url, "utf8"));
}
