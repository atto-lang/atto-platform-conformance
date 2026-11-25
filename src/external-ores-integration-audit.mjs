// Metadata-only audit contract. Never interprets issue discovery as test evidence.
const ORGS = new Map([
  ["ores-truffle-oreslang", 30],
  ["ores-chat", 30],
  ["ores-otel", 30],
  ["ores-redis-lru-cache", 6],
  ["ores-otel-test", 3],
  ["ores-uni-threads", 1],
]);
const REQUIRED_UPSTREAMS = new Set([
  "ORESoftware/api-docs",
  "ORESoftware/typespec-json-schema-validator",
  "ORESoftware/ores-contracts",
  "ORESoftware/ores-interfaces",
  "ORESoftware/ores-transport",
  "ORESoftware/ores-gha-workflows",
]);
const WORKSTREAMS = new Set([
  "security-admission", "contract-parity", "rpc-transport",
  "verification-ci", "telemetry", "runtime-integration",
]);
const FAIL = (message) => { throw new Error("external ORES audit: " + message); };
const isObject = (value) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value) => typeof value === "string" && value.length > 0 && !/[\r\n\0]/.test(value);
// Audit inventories are coordination-only and must be CLOSED objects.
// Additional invented fields such as "nativeCompilerPassed" may not hitchhike
// alongside validated metadata and be mistaken for verified release evidence.
const requireKeys = (value, required, optional = []) => {
  if (!isObject(value)) FAIL("inventory entry must be an object");
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) ||
      actual.some(key => !allowed.has(key))) {
    FAIL("unexpected or missing audit inventory field");
  }
};

export function validateExternalOresAudit(audit) {
  if (!isObject(audit)) FAIL("root must be a plain object");
  requireKeys(audit, ["schemaVersion", "snapshotDate", "status", "authorityPolicy", "securityPolicy", "upstreams", "boundaries", "issues"]);
  if (audit.schemaVersion !== 1 || audit.status !== "coordination-only" ||
      !/^20\d\d-\d\d-\d\d$/.test(audit.snapshotDate ?? "")) {
    FAIL("unsupported schema, date, or unsupported attestation status");
  }
  const auth = audit.authorityPolicy;
  requireKeys(auth, ["typespec", "jsonSchema", "generated", "precedence"]);
  if (!isObject(auth) || auth.typespec !== "independent-peer" ||
      auth.jsonSchema !== "independent-peer" ||
      auth.generated !== "comparison-evidence-only" ||
      auth.precedence !== "none") {
    FAIL("TypeSpec and JSON Schema must remain independent peers");
  }
  const sec = audit.securityPolicy;
  requireKeys(sec, ["privateSourceToPublicCarrier", "privateSourceToUnapprovedPrivateCarrier", "releaseOnZeroStepCI", "allowRunnerCapacityAsCopyAuthorization", "requireProtectedSourceMain", "requireReviewedExactSourceTree", "requireApprovedPrivateDestination", "requireExecutedCompilerSteps", "requireImmutablePin", "requireRuntimeEvidence"]);
  if (!isObject(sec) || sec.privateSourceToPublicCarrier !== "forbidden" ||
      sec.privateSourceToUnapprovedPrivateCarrier !== "forbidden" ||
      sec.releaseOnZeroStepCI !== "forbidden" ||
      sec.allowRunnerCapacityAsCopyAuthorization !== false ||
      sec.requireProtectedSourceMain !== true ||
      sec.requireReviewedExactSourceTree !== true ||
      sec.requireApprovedPrivateDestination !== true ||
      sec.requireExecutedCompilerSteps !== true ||
      sec.requireImmutablePin !== true || sec.requireRuntimeEvidence !== true) {
    FAIL("missing fail-closed provenance or private-source protections");
  }
  if (!Array.isArray(audit.upstreams) || audit.upstreams.length !== REQUIRED_UPSTREAMS.size) {
    FAIL("canonical upstream list is incomplete or unexpected");
  }
  const upstreamNames = new Set();
  for (const p of audit.upstreams) {
    requireKeys(p, ["repo", "kind", "evidence", "gate"], ["blocker"]);
    if (!isObject(p) || !REQUIRED_UPSTREAMS.has(p.repo) ||
        upstreamNames.has(p.repo) || !text(p.kind) || !text(p.gate) ||
        p.evidence !== "not-attested") {
      FAIL("unknown, duplicated, or falsely attested upstream");
    }
    upstreamNames.add(p.repo);
  }
  for (const name of REQUIRED_UPSTREAMS) {
    if (!upstreamNames.has(name)) FAIL("missing upstream " + name);
  }
  for (const [repo, issue] of [
    ["ORESoftware/api-docs", 326],
    ["ORESoftware/typespec-json-schema-validator", 230],
  ]) {
    const upstream = audit.upstreams.find((x) => x.repo === repo);
    if (upstream.blocker !== `https://github.com/${repo}/issues/${issue}`) {
      FAIL("missing canonical unresolved upstream gate " + repo);
    }
  }
  if (!Array.isArray(audit.boundaries) || audit.boundaries.length < 8) {
    FAIL("cross-org integration boundaries are missing");
  }
  const boundaries = new Set();
  for (const edge of audit.boundaries) {
    requireKeys(edge, ["consumer", "upstream", "relationship", "evidence", "note"]);
    if (!isObject(edge) || !text(edge.consumer) ||
        !/^ores-[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(edge.consumer) ||
        !upstreamNames.has(edge.upstream) || !text(edge.relationship) ||
        edge.evidence !== "not-attested" || !text(edge.note)) {
      FAIL("invalid edge or false executable contract claim");
    }
    const pair = edge.consumer + " -> " + edge.upstream;
    if (boundaries.has(pair)) FAIL("duplicate boundary in inventory");
    boundaries.add(pair);
  }
  if (!Array.isArray(audit.issues) || audit.issues.length !== 100) {
    FAIL("expected exactly 100 selected open issues");
  }
  const issueUrls = new Set();
  const repoNames = new Set();
  const byOrg = new Map([...ORGS].map(([name]) => [name, 0]));
  const byWave = new Map([[1, 0], [2, 0], [3, 0], [4, 0]]);
  for (const [index, item] of audit.issues.entries()) {
    requireKeys(item, ["ordinal", "repository", "number", "title", "url", "workstream", "wave", "priority", "status"]);
    if (!isObject(item) || item.ordinal !== index + 1 ||
        !Number.isSafeInteger(item.number) || item.number < 1 ||
        !text(item.repository) || !text(item.title) ||
        !WORKSTREAMS.has(item.workstream) ||
        !["P0", "P1", "P2"].includes(item.priority) ||
        !byWave.has(item.wave) || item.status !== "open-at-snapshot") {
      FAIL("malformed or artificially completed issue at " + (index + 1));
    }
    const parts = item.repository.split("/");
    if (parts.length !== 2 || !byOrg.has(parts[0]) ||
        !/^[a-zA-Z0-9._-]+$/.test(parts[1])) {
      FAIL("issue outside approved ores-* organizations");
    }
    const expected = `https://github.com/${item.repository}/issues/${item.number}`;
    if (item.url !== expected || issueUrls.has(item.url)) {
      FAIL("issue URL mismatch or duplicate at ordinal " + (index + 1));
    }
    issueUrls.add(item.url);
    repoNames.add(item.repository);
    byOrg.set(parts[0], byOrg.get(parts[0]) + 1);
    byWave.set(item.wave, byWave.get(item.wave) + 1);
  }
  for (const [org, count] of ORGS) {
    if (byOrg.get(org) !== count) FAIL("organization distribution drift: " + org);
  }
  if (repoNames.size < 20) FAIL("cross-repository issue coverage collapsed");
  for (const [wave, count] of [[1, 30], [2, 30], [3, 20], [4, 20]]) {
    if (byWave.get(wave) !== count) FAIL("implementation wave distribution drift");
  }
  return {
    schema: "ores.external-integration-audit/v1",
    status: "metadata-only",
    issues: issueUrls.size,
    organizations: byOrg.size,
    repositories: repoNames.size,
    upstreams: upstreamNames.size,
    boundaries: boundaries.size,
  };
}
