export const VALID_ROLES = new Set(["contract","conformance","compiler","host","library","application","tool","site","infrastructure"]);
const NAME = /^[a-z0-9.][a-z0-9._-]{0,99}$/;
const keysAre = (obj, list) => Object.keys(obj).sort().join(",") === [...list].sort().join(",");
function fail(message) { throw new Error("ecosystem contract: " + message); }
export function validateRegistry(data) {
  if (!data || Array.isArray(data) || typeof data !== "object") fail("registry must be object");
  if (!keysAre(data, ["schemaVersion","organization","snapshotDate","status","note","repositories"]) || data.schemaVersion !== 1 || data.organization !== "ores-truffle-oreslang" || data.status !== "coordination-only") fail("invalid registry header");
  if (!Array.isArray(data.repositories) || data.repositories.length === 0 || data.repositories.length > 256) fail("invalid repository inventory");
  const names = new Set();
  const links = new Map();
  for (const item of data.repositories) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !keysAre(item, ["name","role","upstreams","evidence"]) || typeof item.name !== "string" || !NAME.test(item.name) || item.name === "." || item.name === ".." || (item.name.startsWith(".") && item.name !== ".github")) fail("invalid repository name");
    if (names.has(item.name)) fail("duplicate repository " + item.name);
    if (!VALID_ROLES.has(item.role) || item.evidence !== "not-attested") fail("invalid role or unsupported evidence claim for " + item.name);
    if (!Array.isArray(item.upstreams) || item.upstreams.length > 32 || JSON.stringify(item.upstreams) !== JSON.stringify([...item.upstreams].sort())) fail("invalid/unsorted upstream list for " + item.name);
    const unique = new Set();
    for (const dep of item.upstreams) {
      if (typeof dep !== "string" || !NAME.test(dep) || unique.has(dep) || dep === item.name) fail("duplicate, malformed or self-upstream for " + item.name);
      unique.add(dep);
    }
    names.add(item.name); links.set(item.name, [...unique]);
  }
  for (const [name, deps] of links) for (const dep of deps) if (!names.has(dep)) fail("unknown upstream " + dep + " of " + name);
  const roles = new Map(data.repositories.map(x=>[x.name,x.role]));
  for(const row of data.repositories) if(row.role === "contract") for(const dep of row.upstreams) if(roles.get(dep)!=="contract") fail("core contract must not depend on host or stdlib role: "+row.name+" -> "+dep);
  // Coordination edges are a directed acyclic graph to avoid circular ownership handoffs.
  const color = new Map();
  function visit(name) {
    if (color.get(name) === 1) fail("circular integration path at " + name);
    if (color.get(name) === 2) return;
    color.set(name, 1);
    for (const d of links.get(name)) visit(d);
    color.set(name, 2);
  }
  for (const name of names) visit(name);
  return {repositories: names.size, links: [...links.values()].reduce((n, x) => n + x.length, 0)};
}
export function validateMember(registry, member) {
  validateRegistry(registry);
  if (!member || typeof member !== "object" || Array.isArray(member) || !keysAre(member, ["schemaVersion","protocol","repository","role","upstreams","evidence","note"]) || member.schemaVersion !== 1 || member.protocol !== "oreslang-ecosystem-integration" || member.evidence !== "not-attested") fail("invalid member contract");
  const expected = registry.repositories.find(x => `ores-truffle-oreslang/${x.name}` === member.repository);
  if (!expected) fail("unregistered member " + String(member.repository));
  if (member.role !== expected.role || !Array.isArray(member.upstreams) || member.upstreams.length !== expected.upstreams.length || member.upstreams.some((x,i)=>x!==expected.upstreams[i])) fail("member contract drift at " + expected.name);
  if (member.note !== "Declared integration touchpoints only; no CI or runtime parity is asserted.") fail("invalid evidence disclaimer");
  return expected.name;
}
