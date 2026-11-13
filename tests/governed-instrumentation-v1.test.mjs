// Source-free reference model. It does not compile code or export OTLP.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {InstrumentationReference, TelemetryBuffer, envelopeContext}
  from "../src/governed-instrumentation-v1.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/governed-instrumentation-v1.json", import.meta.url), "utf8"));
const v2 = JSON.parse(readFileSync(
  new URL("../contracts/tenant-isolation-v2.json", import.meta.url), "utf8"));
const fails = (f, why) => assert.throws(f, new RegExp(why));
const ops = {kind: "operator", tenants: ["acme"]};
const good = (fnId, tenant = "acme") => ({fnId, tenant, validated: true, producer: "validated-wasm"});

function setup(opts) {
  const r = new InstrumentationReference(opts);
  r.register("acme", "acme.checkout", {untrusted: true});
  r.register("acme", "acme.rt_tick", {realtime: true});
  r.register("acme", "acme.sealed", {deepEligible: false});
  r.register("globex", "globex.checkout", {untrusted: true});
  return r;
}

test("contract ties into tenant isolation v2 and claims no execution", () => {
  assert.equal(contract.schema, "attolang.governed-instrumentation.v1");
  assert.equal(contract.tenantIsolationContract, v2.schema);
  assert.match(v2.design.instrumentation, /attolang\.governed-instrumentation\.v1/);
  assert.deepEqual(Object.keys(contract.modes), ["off", "probes", "deep"]);
  for (const [name, b] of Object.entries(contract.backendProfiles))
    assert.ok(["NOT_EXECUTED", "NO_DEEP_PATH"].includes(b.status), name);
  assert.match(contract.backendProfiles.net.probes, /no CIL JIT in NativeAOT/);
  assert.ok(contract.requiredScenarios.includes("tracing-disabled-overhead-measured-not-assumed"));
});

test("guest code and other tenants' operators cannot instrument", () => {
  const r = setup();
  fails(() => r.request({kind: "guest", tenants: ["acme"]}, "acme", ["acme.checkout"], "deep"), "GUEST_CANNOT_INSTRUMENT");
  fails(() => r.request(undefined, "acme", ["acme.checkout"], "probes"), "GUEST_CANNOT_INSTRUMENT");
  fails(() => r.request({kind: "operator", tenants: ["globex"]}, "acme", ["acme.checkout"], "probes"),
    "CROSS_TENANT_INSTRUMENTATION");
  fails(() => r.request(ops, "acme", ["globex.checkout"], "probes"), "FOREIGN_FUNCTION");
  fails(() => r.request(ops, "acme", ["acme.checkout", "globex.checkout"], "probes"), "FOREIGN_FUNCTION");
  assert.equal(r.state("acme.checkout").probes, false, "a refused mixed scope changes nothing");
  fails(() => r.request(ops, "acme", [], "probes"), "EMPTY_SCOPE");
  fails(() => r.request(ops, "acme", ["acme.checkout"], "verbose"), "UNKNOWN_MODE");
});

test("probes switch on and off without code generation", () => {
  const r = setup();
  assert.deepEqual(r.request(ops, "acme", ["acme.checkout"], "probes"), []);
  assert.equal(r.enter("acme.checkout").probes, true);
  r.request(ops, "acme", ["acme.checkout"], "off");
  assert.equal(r.enter("acme.checkout").probes, false);
  assert.equal(r.state("globex.checkout").probes, false, "another tenant is untouched");
});

test("deep tracing installs a validated variant through versioned dispatch", () => {
  const r = setup();
  const [job] = r.request(ops, "acme", ["acme.checkout"], "deep");
  const inflight = r.enter("acme.checkout");
  assert.equal(inflight.version.kind, "aot");
  assert.equal(r.complete(job, good("acme.checkout")).installed, true);
  assert.equal(r.state("acme.checkout").active, "deep");
  assert.equal(r.enter("acme.checkout").version.kind, "deep", "new calls take the new version");
  r.exit(inflight);
  assert.equal(r.state("acme.checkout").liveVersions.length, 2, "AOT version is never retired");
});

test("a failed, mismatched or unvalidated compile leaves the running version", () => {
  const r = setup({maxCompilesPerTenant: 4});
  const run = (artifact) => { const [j] = r.request(ops, "acme", ["acme.checkout"], "deep"); return r.complete(j, artifact); };
  assert.deepEqual(run(new Error("llvm crashed")), {installed: false, reason: "COMPILE_FAILED"});
  assert.equal(run(good("globex.checkout")).reason, "ARTIFACT_MISMATCH");
  assert.equal(run({...good("acme.checkout"), validated: false}).reason, "INSTRUMENTED_CODE_UNVALIDATED");
  assert.equal(run({...good("acme.checkout"), producer: "native-patch"}).reason, "INSTRUMENTED_CODE_UNVALIDATED");
  assert.equal(run({...good("acme.checkout"), producer: "cil"}).reason, "INSTRUMENTED_CODE_UNVALIDATED");
  assert.equal(r.state("acme.checkout").active, "aot");
  const [j] = r.request(ops, "acme", ["acme.checkout"], "deep");
  r.complete(j, good("acme.checkout"));
  fails(() => r.complete(j, good("acme.checkout")), "JOB_ALREADY_COMPLETE");
});

test("in-flight calls finish on the old JIT version, which is then reclaimed", () => {
  const r = setup({maxCompilesPerTenant: 2});
  const [j1] = r.request(ops, "acme", ["acme.checkout"], "deep");
  const v1 = r.complete(j1, good("acme.checkout")).version;
  const onV1 = r.enter("acme.checkout");
  const [j2] = r.request(ops, "acme", ["acme.checkout"], "deep");
  const v2id = r.complete(j2, good("acme.checkout")).version;
  assert.ok(r.state("acme.checkout").liveVersions.includes(v1), "v1 stays while a call uses it");
  r.exit(onV1);
  assert.ok(!r.state("acme.checkout").liveVersions.includes(v1), "v1 reclaimed once drained");
  r.request(ops, "acme", ["acme.checkout"], "off");
  assert.equal(r.state("acme.checkout").active, "aot");
  assert.ok(!r.state("acme.checkout").liveVersions.includes(v2id), "off reclaims an idle JIT version");
  fails(() => r.exit(onV1), "LEASE_UNDERFLOW");
});

test("deep recompile refuses real-time and ineligible functions, and is quota-bound per tenant", () => {
  const r = setup({maxCompilesPerTenant: 1});
  fails(() => r.request(ops, "acme", ["acme.rt_tick"], "deep"), "REALTIME_SECTION_FORBIDDEN");
  r.request(ops, "acme", ["acme.rt_tick"], "probes");
  fails(() => r.request(ops, "acme", ["acme.sealed"], "deep"), "DEEP_UNSUPPORTED");
  const [job] = r.request(ops, "acme", ["acme.checkout"], "deep");
  fails(() => r.request(ops, "acme", ["acme.checkout"], "deep"), "COMPILE_QUOTA");
  r.request({kind: "operator", tenants: ["globex"]}, "globex", ["globex.checkout"], "deep");
  r.complete(job, new Error("fail"));
  r.request(ops, "acme", ["acme.checkout"], "deep");
});

test("telemetry buffers drop and count, and never capture payloads or secrets", () => {
  const b = new TelemetryBuffer({capacity: 2, maxValuesPerKey: 2,
    allowedAttributes: ["http.method", "actor.kind", "body", "auth.token"]});
  assert.ok(b.record("span", {"http.method": "POST", body: "{card...}", "auth.token": "x", password: "p", "actor.kind": "Parse"}));
  const [first] = b.drain(1);
  assert.deepEqual(first.attributes, {"http.method": "POST", "actor.kind": "Parse"},
    "forbidden keys are refused even if allowlisted");
  assert.equal(b.redacted, 3);
  b.record("a", {"http.method": "GET"});
  b.record("b", {"http.method": "PUT"});
  assert.equal(b.record("c"), false);
  assert.equal(b.dropped, 1);
  b.drain(2);
  b.record("d", {"http.method": "PUT", "unknown.key": 1, "actor.kind": {nested: true}});
  assert.deepEqual(b.drain(1)[0].attributes, {}, "third distinct value exceeds cardinality; unknown and non-scalar refused");
  fails(() => b.drain(0), "INVALID_DRAIN");
});

test("incoming traceparent is correlation only; invalid input starts a fresh trace", () => {
  const ids = {traceId: () => "f".repeat(32)};
  const ok = envelopeContext("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", ids);
  assert.deepEqual({...ok}, {traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    parentSpanId: "00f067aa0ba902b7", sampled: true, trusted: false});
  assert.ok(Object.isFrozen(ok), "envelope context is immutable");
  for (const bad of [undefined, "", "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "00-" + "0".repeat(32) + "-00f067aa0ba902b7-01", "00-4bf92f3577b34da6a3ce929d0e0e4736-" + "0".repeat(16) + "-01",
    "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01", "00-short-00f067aa0ba902b7-01"]) {
    const c = envelopeContext(bad, ids);
    assert.equal(c.traceId, "f".repeat(32), String(bad));
    assert.equal(c.parentSpanId, null);
    assert.equal(c.sampled, false);
  }
});

test("switching away from an idle AOT version never retires it", () => {
  const r = setup();
  const aotId = r.state("acme.checkout").activeVersion;
  const [job] = r.request(ops, "acme", ["acme.checkout"], "deep");
  r.complete(job, good("acme.checkout"));
  assert.ok(r.state("acme.checkout").liveVersions.includes(aotId), "AOT kept with no in-flight calls");
  r.request(ops, "acme", ["acme.checkout"], "off");
  assert.equal(r.state("acme.checkout").activeVersion, aotId);
});

test("a refused deep request changes nothing and consumes no compile quota", () => {
  const r = setup({maxCompilesPerTenant: 1});
  fails(() => r.request(ops, "acme", ["acme.checkout", "acme.rt_tick"], "deep"), "REALTIME_SECTION_FORBIDDEN");
  assert.equal(r.state("acme.checkout").probes, false);
  assert.equal(r.state("acme.checkout").active, "aot");
  assert.equal(r.request(ops, "acme", ["acme.checkout"], "deep").length, 1, "quota still available");
});
