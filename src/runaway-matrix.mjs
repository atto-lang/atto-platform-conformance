// Source-free inventory validation only; NEVER executes candidate guest source.
// Closed, versioned allowlist: changing a threat's expected outcome or source
// binding requires a separately reviewed v2 contract.
export const REQUIRED_CATEGORIES = Object.freeze([
  "infinite_loop", "nested_loop", "recursion", "mutual_recursion",
  "allocation_storm", "sibling_progress", "cancellation_race",
  "hostile_wasm_import", "compiler_mutation", "tail_call_cycle"
]);
const BACKENDS = Object.freeze(["java", "llvm", "net", "wasm", "forge"]);
const EXPECTED = Object.freeze({
  infinite_loop: ["unbounded-loop.atto", "hard-budget-trap", "unaffected"],
  nested_loop: ["nested-loop.atto", "hard-budget-trap", "unaffected"],
  recursion: ["self-recursion.atto", "hard-budget-trap", "unaffected"],
  mutual_recursion: ["mutual-recursion.atto", "hard-budget-trap", "unaffected"],
  allocation_storm: ["allocation-storm.atto", "memory-quota-trap", "unaffected"],
  sibling_progress: ["sibling-progress.atto", "bounded-sibling-progress", "completes"],
  cancellation_race: ["cancel-race.atto", "bounded-cancellation", "unaffected"],
  hostile_wasm_import: ["hostile-import.wat", "import-rejection-before-execution", "unaffected"],
  compiler_mutation: [null, "rejected-compiled-cfg", "unaffected"],
  tail_call_cycle: ["tail-recursion.atto", "hard-budget-trap", "unaffected"]
});
const EXACT_CASE_KEYS = ["expect", "fixture", "guest_status", "id", "kind", "sibling"].sort().join(",");
export function validateManifest(matrix) {
  if (!matrix || matrix.schema !== "atto.runaway-guests.v1" ||
      matrix.status !== "CANDIDATE_FIXTURES_NOT_COMPILER_VERIFIED" ||
      JSON.stringify(matrix.backends) !== JSON.stringify(BACKENDS) ||
      !Array.isArray(matrix.cases) || matrix.cases.length !== REQUIRED_CATEGORIES.length)
    throw Error("RUNAWAY_MANIFEST_HEADER");
  const ids = new Set(), kinds = new Set(), paths = new Set();
  for (const item of matrix.cases) {
    if (!item || Object.keys(item).sort().join(",") !== EXACT_CASE_KEYS ||
        typeof item.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,79}$/.test(item.id) || ids.has(item.id) ||
        !Object.hasOwn(EXPECTED, item.kind) || kinds.has(item.kind))
      throw Error("RUNAWAY_CASE_ID_OR_KIND");
    ids.add(item.id); kinds.add(item.kind);
    const [filename, expectedResult, siblingResult] = EXPECTED[item.kind];
    if (item.kind === "compiler_mutation") {
      if (item.fixture !== null) throw Error("MUTATION_REQUIRES_COMPILER_INTERNALS");
    } else {
      if (typeof item.fixture !== "string" ||
          !/^fixtures\/runaway-v1\/[a-z0-9-]+\.(atto|wat)$/.test(item.fixture) ||
          item.fixture !== "fixtures/runaway-v1/" + filename ||
          paths.has(item.fixture))
        throw Error("RUNAWAY_FIXTURE_PATH");
      paths.add(item.fixture);
    }
    if (item.expect !== expectedResult || item.sibling !== siblingResult)
      throw Error("RUNAWAY_EXPECTATION_MISMATCH");
    if (!item.guest_status || typeof item.guest_status !== "object" ||
        Array.isArray(item.guest_status) ||
        Object.keys(item.guest_status).sort().join(",") !==
          BACKENDS.slice().sort().join(",") ||
        Object.values(item.guest_status).some(status => status !== "NOT_EXECUTED"))
      throw Error("UNVERIFIED_GUEST_RESULT_CANNOT_BE_PROMOTED");
  }
  if (REQUIRED_CATEGORIES.some(c => !kinds.has(c)))
    throw Error("RUNAWAY_COVERAGE_MISSING");
  return true;
}
