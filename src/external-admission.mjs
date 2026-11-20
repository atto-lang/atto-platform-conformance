// Coordination-only cross-organization boundary and issue-intake policy.
// Never treat a GitHub issue, proposed edge, or schema declaration as compiler/runtime evidence.
const OWNED = /^(ores-truffle-oreslang|ores-stack)\/[A-Za-z0-9._-]+$/;
const EXTERNAL = new Set([
  "ORESoftware/api-docs", "ORESoftware/typespec-json-schema-validator",
  "ORESoftware/ores-contracts", "ORESoftware/ores-stack", "ORESoftware/ores-interfaces"
]);
const STREAMS = new Set(["contracts", "security", "rpc-transport", "ci-evidence", "runtime", "platform-integration"]);
const KEYS = (obj, fields) => obj && typeof obj === "object" && !Array.isArray(obj)
  && Object.keys(obj).sort().join("|") === [...fields].sort().join("|");
const fail = (reason) => { throw new Error("external admission: " + reason); };
const peers = ["human-authored TypeSpec", "independently human-authored JSON Schema Draft 2020-12"];
const witnesses = ["TypeSpec-emitted JSON Schema", "WIT", "Protobuf", "generated API clients", "Oreslang bindings"];
const POLICY = "independently-authored-typespec-plus-json-schema; generated-wit-protobuf-clients-are-derivative";

export function validateIssueIntake(doc) {
  if (!KEYS(doc, ["schemaVersion", "snapshotDate", "status", "scope", "repositoriesCount", "issues"])
    || doc.schemaVersion !== 1 || doc.snapshotDate !== "2026-10-18"
    || doc.status !== "triage-only" || typeof doc.scope !== "string") fail("invalid issue intake header");
  if (!Array.isArray(doc.issues) || doc.issues.length !== 100) fail("must contain exactly 100 existing issues");
  const urls = new Set(), repos = new Set(), orgs = new Set();
  for (const [index, row] of doc.issues.entries()) {
    if (!KEYS(row, ["id","organization","repository","number","url","title","priority","workstream","stateAtSnapshot","admission","execution"]))
      fail("unexpected issue fields");
    const match = OWNED.exec(row.repository);
    if (row.id !== index + 1 || !match || row.organization !== match[1]
      || !Number.isSafeInteger(row.number) || row.number <= 0
      || row.url !== `https://github.com/${row.repository}/issues/${row.number}`
      || typeof row.title !== "string" || row.title.trim().length < 5 || row.title.length > 300
      || !["P0","P1","P2"].includes(row.priority) || !STREAMS.has(row.workstream)
      || row.stateAtSnapshot !== "open" || row.admission !== "not-attested"
      || row.execution !== "not-run") fail("malformed, out-of-scope or falsely attested issue #" + (index + 1));
    if (urls.has(row.url)) fail("duplicate issue URL: " + row.url);
    urls.add(row.url); repos.add(row.repository); orgs.add(row.organization);
  }
  if (repos.size !== doc.repositoriesCount || repos.size < 25
    || orgs.size !== 2 || !orgs.has("ores-truffle-oreslang") || !orgs.has("ores-stack"))
    fail("unexpected issue coverage");
  return {issues: urls.size, repositories: repos.size, organizations: orgs.size};
}

export function validateExternalBoundaries(doc, registry) {
  if (!KEYS(doc, ["schemaVersion","status","updatedAt","scope","peerAuthorities","derivativeWitnesses","edges"])
    || doc.schemaVersion !== 1 || doc.status !== "coordination-only"
    || doc.updatedAt !== "2026-10-18" || typeof doc.scope !== "string"
    || JSON.stringify(doc.peerAuthorities) !== JSON.stringify(peers)
    || JSON.stringify(doc.derivativeWitnesses) !== JSON.stringify(witnesses))
    fail("invalid peer authority or boundary policy header");
  if (!registry || registry.organization !== "ores-truffle-oreslang" || !Array.isArray(registry.repositories))
    fail("invalid source organization registry");
  if (!Array.isArray(doc.edges) || doc.edges.length < 10 || doc.edges.length > 64)
    fail("invalid external boundary count");
  const ownedRepoNames = new Set(registry.repositories.map(x => x.name));
  const seen = new Set(), authorities = new Set();
  let previous = "";
  for (const edge of doc.edges) {
    if (!KEYS(edge, ["consumer","authority","boundary","contractPolicy","admission","evidence",
        "sourceCommit","tjsvReceipt","compilerRuntimeReceipt","executedWorkflow"]))
      fail("invalid external edge fields");
    const match = OWNED.exec(edge.consumer);
    if (!match || (match[1] === "ores-truffle-oreslang" && !ownedRepoNames.has(edge.consumer.split("/")[1])))
      fail("unknown/untrusted integration consumer");
    if (!EXTERNAL.has(edge.authority)) fail("unknown external authority");
    if (typeof edge.boundary !== "string" || !/^[a-z][a-z0-9-]{3,80}$/.test(edge.boundary))
      fail("invalid boundary identifier");
    if (edge.contractPolicy !== POLICY || edge.admission !== "blocked" || edge.evidence !== "not-attested"
      || edge.sourceCommit !== null || edge.tjsvReceipt !== null || edge.compilerRuntimeReceipt !== null
      || edge.executedWorkflow !== null) fail("unproven external integration claimed as admitted");
    const identity = edge.consumer + "/" + edge.authority + "/" + edge.boundary;
    if (seen.has(identity)) fail("duplicate external integration edge");
    // Keep canonical order to prevent hidden additions in large reviews.
    if (previous && identity.localeCompare(previous) < 0) fail("unsorted external boundaries");
    previous = identity;
    seen.add(identity);
    authorities.add(edge.authority);
  }
  for (const required of ["ORESoftware/api-docs", "ORESoftware/typespec-json-schema-validator",
      "ORESoftware/ores-contracts"]) if (!authorities.has(required)) fail("missing requested authority: " + required);
  return {boundaries: seen.size, authorities: authorities.size, status: "blocked"};
}
