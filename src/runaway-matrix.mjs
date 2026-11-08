// Source-free inventory validation only; NEVER executes candidate guest source.
export const REQUIRED_CATEGORIES = Object.freeze([
  "infinite_loop", "nested_loop", "recursion", "mutual_recursion",
  "allocation_storm", "sibling_progress", "cancellation_race",
  "hostile_wasm_import", "compiler_mutation", "tail_call_cycle"
]);
const BACKENDS = ["java", "llvm", "net", "wasm", "forge"];
export function validateManifest(matrix) {
  if (!matrix || matrix.schema !== "atto.runaway-guests.v1" ||
      matrix.status !== "CANDIDATE_FIXTURES_NOT_COMPILER_VERIFIED" ||
      JSON.stringify(matrix.backends) !== JSON.stringify(BACKENDS) ||
      !Array.isArray(matrix.cases) || matrix.cases.length !== REQUIRED_CATEGORIES.length)
    throw Error("RUNAWAY_MANIFEST_HEADER");
  const ids = new Set(), kinds = new Set(), paths = new Set();
  for (const item of matrix.cases) {
    if (!item || typeof item.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,79}$/.test(item.id) || ids.has(item.id) ||
        !REQUIRED_CATEGORIES.includes(item.kind) || kinds.has(item.kind))
      throw Error("RUNAWAY_CASE_ID_OR_KIND");
    ids.add(item.id); kinds.add(item.kind);
    if (item.kind === "compiler_mutation") {
      if (item.fixture !== null) throw Error("MUTATION_REQUIRES_COMPILER_INTERNALS");
    } else {
      if (typeof item.fixture !== "string" ||
          !/^fixtures\/runaway-v1\/[a-z0-9-]+\.(atto|wat)$/.test(item.fixture) ||
          paths.has(item.fixture)) throw Error("RUNAWAY_FIXTURE_PATH");
      paths.add(item.fixture);
    }
    if (typeof item.expect !== "string" || !item.expect ||
        !["unaffected", "completes"].includes(item.sibling) ||
        !item.guest_status || Object.keys(item.guest_status).sort().join(",") !==
        BACKENDS.slice().sort().join(",") ||
        Object.values(item.guest_status).some(status => status !== "NOT_EXECUTED"))
      throw Error("UNVERIFIED_GUEST_RESULT_CANNOT_BE_PROMOTED");
  }
  if (REQUIRED_CATEGORIES.some(c => !kinds.has(c)))
    throw Error("RUNAWAY_COVERAGE_MISSING");
  return true;
}
