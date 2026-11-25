// Source-free reference model. This does NOT execute real actors or prove
// physical isolation on any backend.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TenantIsolateReference} from "../src/tenant-isolation-v2.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/tenant-isolation-v2.json", import.meta.url), "utf8"));
const v1 = JSON.parse(readFileSync(
  new URL("../contracts/tenant-isolation-v1.json", import.meta.url), "utf8"));

const fails = (f, why) => assert.throws(f, new RegExp(why));
const isolate = (extra = {}) => ({untrusted: true, boundary: "vm-isolate",
  guestCode: "validated-wasm", limits: {heapBytes: 1024, turnDeadlineMs: 50}, ...extra});
const never = () => new Promise(() => {});

test("contract fixes the shared-process decision and supersedes v1", () => {
  assert.equal(contract.schema, "oreslang.tenant-isolation.v2");
  assert.equal(contract.status, "SOURCE_FREE_REFERENCE_NOT_BACKEND_EXECUTION");
  assert.equal(contract.supersedes, v1.schema);
  assert.equal(v1.status, "SUPERSEDED_BY_V2");
  assert.equal(v1.supersededBy, contract.schema);
  assert.equal(contract.decision.processModel, "shared-os-process");
  assert.equal(contract.decision.hostileTenantsShareProcess, true);
  assert.equal(contract.decision.processSandboxRequired, false);
  assert.deepEqual(contract.design.identity, ["tenantId", "generation", "opaqueHostAuthority"]);
  assert.deepEqual(contract.securityBoundary.admissibleUntrustedGuestCode,
    ["validated-wasm", "truffle-isolate"]);
  assert.deepEqual(Object.keys(contract.securityBoundary.refusedUntrustedGuestCode).sort(),
    ["cil", "native"]);
  assert.ok(contract.acceptedSharedProcessRisks.length >= 3,
    "shared-process costs must stay written down");
});

test("backend profiles name an isolate mechanism and claim no execution", () => {
  assert.deepEqual(Object.keys(contract.backendProfiles).sort(),
    ["cranelift", "forge", "java", "js", "llvm", "net", "wasm"]);
  for (const [name, b] of Object.entries(contract.backendProfiles)) {
    assert.ok(["NOT_EXECUTED", "NO_UNTRUSTED_PATH"].includes(b.status), name);
    assert.ok(!/PROCESS_SANDBOX_REQUIRED/.test(JSON.stringify(b)), name);
    if (b.status === "NO_UNTRUSTED_PATH") assert.equal(b.untrustedGuest, null, name);
    else assert.ok(contract.securityBoundary.admissibleUntrustedGuestCode.includes(b.untrustedGuest), name);
  }
  assert.equal(contract.backendProfiles.net.untrustedGuest, "validated-wasm",
    ".NET untrusted tenants run as Wasm, not CIL");
  for (const s of ["untrusted-requires-vm-isolate", "host-kills-spinning-tenant-without-cooperation",
    "many-tenants-share-one-process", "exact-pr-tree-nonzero-step-ci-evidence",
    "neighbor-survives-tenant-trap-and-reincarnation"])
    assert.ok(contract.requiredScenarios.includes(s), s);
});

test("untrusted tenants are admitted into a VM-isolate in the shared process", async () => {
  const vm = new TenantIsolateReference();
  const wasm = vm.create("wasm-tenant", isolate());
  const truffle = vm.create("truffle-tenant", isolate({guestCode: "truffle-isolate"}));
  vm.start(wasm); vm.start(truffle);
  assert.equal(await vm.invoke(wasm, () => 2), 2);
  assert.equal(await vm.invoke(truffle, () => 3), 3);
});

test("untrusted admission fails closed without a proper isolate", () => {
  const vm = new TenantIsolateReference();
  fails(() => vm.create("t", {untrusted: true}), "VM_ISOLATE_REQUIRED");
  fails(() => vm.create("t", {untrusted: true, boundary: "trusted-inprocess"}), "VM_ISOLATE_REQUIRED");
  fails(() => vm.create("t", isolate({guestCode: "native"})), "UNTRUSTED_NATIVE_CODE_REFUSED");
  fails(() => vm.create("t", isolate({guestCode: "cil"})), "UNTRUSTED_CIL_REFUSED");
  fails(() => vm.create("t", isolate({guestCode: undefined})), "UNKNOWN_GUEST_CODE");
  fails(() => vm.create("t", isolate({guestCode: "wasm"})), "UNKNOWN_GUEST_CODE");
  fails(() => vm.create("t", isolate({limits: undefined})), "ISOLATE_LIMITS_REQUIRED");
  fails(() => vm.create("t", isolate({limits: {heapBytes: 1024}})), "ISOLATE_LIMITS_REQUIRED");
  fails(() => vm.create("t", isolate({limits: {heapBytes: 0, turnDeadlineMs: 5}})), "ISOLATE_LIMITS_REQUIRED");
  fails(() => vm.create("t", isolate({limits: {heapBytes: 1, turnDeadlineMs: 5, extra: 1}})),
    "ISOLATE_LIMITS_REQUIRED");
  fails(() => vm.create("t", {boundary: "trusted-inprocess", guestCode: "cil"}),
    "ISOLATE_OPTIONS_WITHOUT_ISOLATE");
});

test("trusted tenants may still run CIL or native code inside an isolate", () => {
  const vm = new TenantIsolateReference();
  vm.create("trusted-cil", isolate({untrusted: false, guestCode: "cil"}));
  vm.create("trusted-native", isolate({untrusted: false, guestCode: "native"}));
});

test("a process sandbox is optional and never silently claimed", () => {
  const vm = new TenantIsolateReference();
  vm.create("no-sandbox", isolate({processSandbox: false}));
  fails(() => vm.create("x", isolate({processSandbox: true})), "OS_SANDBOX_NOT_IMPLEMENTED");
  fails(() => vm.create("x", isolate({processSandbox: "yes"})), "INVALID_PROCESS_SANDBOX_FLAG");
  // v1's separate-process boundary is no longer a boundary kind.
  fails(() => vm.create("x", {untrusted: true, boundary: "os-sandbox-verified"}), "UNSUPPORTED_BOUNDARY");
  fails(() => vm.create("x", {boundary: "wasm-store"}), "UNSUPPORTED_BOUNDARY");
  fails(() => vm.create("x", {boundary: 5}), "INVALID_BOUNDARY");
  fails(() => vm.create("x", {untrusted: "false"}), "INVALID_TRUST_FLAG");
});

test("1000 tenants share one root with private state", async () => {
  const vm = new TenantIsolateReference({maxTenants: 1000});
  const handles = [];
  for (let i = 0; i < 1000; i++) {
    const h = vm.create(`tenant-${i}`, isolate());
    vm.start(h);
    handles.push(h);
  }
  fails(() => vm.create("one-too-many", isolate()), "TENANT_QUOTA");
  await Promise.all(handles.map((h, i) => vm.invoke(h, () => i)));
  await Promise.all(handles.map(h => vm.invoke(h, () => 1)));
  handles.forEach((h, i) => assert.equal(vm.snapshot(h).state, i + 1));
});

test("host kills a spinning tenant without its cooperation; neighbor continues", async () => {
  const vm = new TenantIsolateReference();
  const spinner = vm.create("spinner", isolate({limits: {heapBytes: 1024, turnDeadlineMs: 60_000}}));
  const quiet = vm.create("quiet", isolate());
  vm.start(spinner); vm.start(quiet);
  let entered;
  const started = new Promise(r => { entered = r; });
  const turn = vm.invoke(spinner, () => { entered(); return never(); });
  await started;
  assert.equal(await vm.invoke(quiet, () => 1), 1, "a spinning tenant must not block another");
  vm.kill(spinner);
  await assert.rejects(turn, /TENANT_KILLED/);
  const s = vm.snapshot(spinner);
  assert.equal(s.phase, "quiescing");
  assert.equal(s.endReason, "TENANT_KILLED");
  assert.equal(s.active, 0, "a killed turn is abandoned, not drained");
  await assert.rejects(vm.invoke(spinner, () => 1), /ADMISSION_CLOSED/);
  vm.stop(spinner); vm.destroy(spinner);
  assert.equal(await vm.invoke(quiet, () => 1), 2);
});

test("killing a tenant still waits for host-owned resource loans", async () => {
  const vm = new TenantIsolateReference();
  const h = vm.create("t", isolate());
  vm.start(h);
  const loan = vm.lease(h);
  vm.kill(h);
  fails(() => vm.stop(h), "DRAIN_REQUIRED");
  vm.release(h, loan);
  vm.stop(h); vm.destroy(h);
});

test("turn deadline ends only that tenant", async () => {
  const vm = new TenantIsolateReference();
  const slow = vm.create("slow", isolate({limits: {heapBytes: 1024, turnDeadlineMs: 20}}));
  const fast = vm.create("fast", isolate());
  vm.start(slow); vm.start(fast);
  await assert.rejects(vm.invoke(slow, never), /DEADLINE/);
  assert.equal(vm.snapshot(slow).endReason, "DEADLINE");
  assert.equal(await vm.invoke(fast, () => 5), 5);
});

test("heap limit is per tenant and ends only the tenant that exceeds it", async () => {
  const vm = new TenantIsolateReference();
  const hog = vm.create("hog", isolate({limits: {heapBytes: 100, turnDeadlineMs: 50}}));
  const calm = vm.create("calm", isolate({limits: {heapBytes: 100, turnDeadlineMs: 50}}));
  vm.start(hog); vm.start(calm);
  assert.equal(await vm.invoke(calm, (_, alloc) => { alloc(90); return 1; }), 1);
  assert.equal(await vm.invoke(hog, (_, alloc) => { alloc(60); return 1; }), 1);
  await assert.rejects(vm.invoke(hog, (_, alloc) => { alloc(60); return 1; }), /HEAP_LIMIT/);
  assert.equal(vm.snapshot(hog).endReason, "HEAP_LIMIT");
  assert.equal(vm.snapshot(hog).heapUsed, 0, "the failed isolate's heap is discarded");
  assert.equal(vm.snapshot(calm).heapUsed, 90, "the neighbor's heap is untouched");
  assert.equal(await vm.invoke(calm, () => 1), 2);
});

test("distinct tenants retain private mutable state", async () => {
  const vm = new TenantIsolateReference();
  const a = vm.create("tenant-a"), b = vm.create("tenant-b");
  vm.start(a); vm.start(b);
  assert.equal(await vm.invoke(a, () => 1), 1);
  assert.equal(await vm.invoke(b, () => 1), 1);
  assert.equal(await vm.invoke(a, () => 1), 2);
  assert.equal(await vm.invoke(b, () => 1), 2);
});

test("independent VM roots reject same-name same-generation foreign handles", async () => {
  const rootA = new TenantIsolateReference(), rootB = new TenantIsolateReference();
  const a = rootA.create("tenant"), b = rootB.create("tenant");
  assert.equal(a.epoch, b.epoch);
  rootA.start(a); rootB.start(b);
  await assert.rejects(rootA.invoke(b, () => 99), /STALE_TENANT_HANDLE/);
  fails(() => rootB.kill(a), "STALE_TENANT_HANDLE");
  assert.equal(await rootA.invoke(a, () => 1), 1);
  assert.equal(await rootB.invoke(b, () => 1), 1);
});

test("stale incarnation handles cannot regain ownership after restart", async () => {
  const vm = new TenantIsolateReference({maxTenants: 1});
  const old = vm.create("t"); vm.start(old);
  assert.equal(await vm.invoke(old, () => 42), 42);
  vm.shutdown(old); vm.stop(old); vm.destroy(old);
  const fresh = vm.create("t"); vm.start(fresh);
  fails(() => vm.snapshot(old), "STALE_TENANT_HANDLE");
  fails(() => vm.kill(old), "STALE_TENANT_HANDLE");
  assert.equal(await vm.invoke(fresh, () => 1), 1);
  assert.notEqual(fresh.epoch, old.epoch);
});

test("duplicate, aggregate and reserved-ID admissions are bounded", () => {
  const vm = new TenantIsolateReference({maxTenants: 1});
  vm.create("tenant");
  fails(() => vm.create("tenant"), "DUPLICATE_TENANT");
  fails(() => vm.create("other"), "TENANT_QUOTA");
  for (const bad of ["../bad", ".", "..", "", "x".repeat(129)]) fails(() => vm.create(bad), "INVALID_ID");
});

test("shutdown fences new admission and waits for a real inflight turn", async () => {
  const vm = new TenantIsolateReference();
  const h = vm.create("t"); vm.start(h);
  let release, entered;
  const started = new Promise(r => { entered = r; });
  const blocker = new Promise(r => { release = r; });
  const call = vm.invoke(h, async () => { entered(); await blocker; return 3; });
  await started;
  vm.shutdown(h);
  await assert.rejects(vm.invoke(h, () => 1), /ADMISSION_CLOSED/);
  fails(() => vm.stop(h), "DRAIN_REQUIRED");
  release();
  assert.equal(await call, 3, "an inflight turn drains during quiescence");
  vm.stop(h); vm.destroy(h);
});

test("a trap quarantines one tenant; reincarnation resets only its state", async () => {
  const root = new TenantIsolateReference();
  const healthy = root.create("healthy", isolate()), failed = root.create("failing", isolate());
  root.start(healthy); root.start(failed);
  assert.equal(await root.invoke(healthy, () => 1), 1);
  assert.equal(await root.invoke(failed, () => 4), 4);
  await assert.rejects(root.invoke(failed, async () => { throw Error("GUEST_TRAP"); }), /GUEST_TRAP/);
  assert.equal(root.snapshot(failed).phase, "quiescing");
  await assert.rejects(root.invoke(failed, () => 1), /ADMISSION_CLOSED/);
  assert.equal(await root.invoke(healthy, () => 1), 2);
  root.stop(failed); root.destroy(failed);
  const fresh = root.create("failing", isolate()); root.start(fresh);
  assert.equal(await root.invoke(fresh, () => 1), 1);
  assert.equal(await root.invoke(healthy, () => 1), 3);
});

test("resource leases are host-owned and foreign or replayed releases are refused", () => {
  const vm = new TenantIsolateReference();
  const a = vm.create("a"), b = vm.create("b");
  vm.start(a); vm.start(b);
  const loan = vm.lease(a);
  fails(() => vm.release(b, loan), "FOREIGN_OR_REPLAYED_LEASE");
  vm.shutdown(a);
  fails(() => vm.lease(a), "ADMISSION_CLOSED");
  fails(() => vm.stop(a), "DRAIN_REQUIRED");
  vm.release(a, loan);
  fails(() => vm.release(a, loan), "FOREIGN_OR_REPLAYED_LEASE");
  vm.stop(a); vm.destroy(a);
});

test("scalar actor turns are non-reentrant even with extra tenant capacity", async () => {
  const vm = new TenantIsolateReference({maxInflight: 3});
  const h = vm.create("tenant"); vm.start(h);
  let signal, release;
  const started = new Promise(r => { signal = r; });
  const blocked = new Promise(r => { release = r; });
  const active = vm.invoke(h, async () => { signal(); await blocked; return 4; });
  await started;
  await assert.rejects(vm.invoke(h, () => 10), /ADMISSION_CLOSED/);
  release();
  assert.equal(await active, 4);
  assert.equal(await vm.invoke(h, () => 2), 6);
});

test("contract carries the audit-derived requirements", () => {
  for (const k of ["cpu_accounting", "mail_quotas", "host_calls", "queued_work", "instrumentation"])
    assert.equal(typeof contract.design[k], "string", k);
  assert.match(contract.design.cpu_accounting, /CPU time, not wall-clock/);
  for (const s of ["deadline-and-fairness-count-tenant-cpu", "tenant-and-host-mail-byte-quotas",
    "guest-controlled-host-call-arguments-cannot-fault-host", "queued-callers-rejected-promptly-on-quiescence",
    "instrumentation-is-governed-and-tenant-scoped"])
    assert.ok(contract.requiredScenarios.includes(s), s);
});

test("mail is bounded per tenant and per host, and delivery refunds both", () => {
  const vm = new TenantIsolateReference({maxHostMailBytes: 1500});
  const a = vm.create("a", isolate({mailBytes: 1000})), b = vm.create("b", isolate({mailBytes: 1000}));
  vm.start(a); vm.start(b);
  const m1 = vm.send(a, 400); vm.send(a, 400);
  fails(() => vm.send(a, 400), "TENANT_MAIL_QUOTA");
  vm.take(a, m1);
  vm.send(a, 400);
  vm.send(b, 600);
  fails(() => vm.send(b, 200), "HOST_MAIL_QUOTA");
  assert.deepEqual(vm.mailUsage(a), {tenant: 800, host: 1400});
  fails(() => vm.take(b, m1), "FOREIGN_OR_REPLAYED_MAIL");
  fails(() => vm.take(a, m1), "FOREIGN_OR_REPLAYED_MAIL");
  fails(() => vm.send(a, 0), "INVALID_MAIL");
  fails(() => vm.create("x", isolate({mailBytes: 0})), "INVALID_MAIL_QUOTA");
});

test("a dead or destroyed isolate returns all of its mail to the host", async () => {
  const vm = new TenantIsolateReference({maxHostMailBytes: 1000});
  const a = vm.create("a", isolate({mailBytes: 1000})), b = vm.create("b", isolate({mailBytes: 1000}));
  vm.start(a); vm.start(b);
  vm.send(a, 900);
  fails(() => vm.send(b, 200), "HOST_MAIL_QUOTA");
  vm.kill(a);
  assert.deepEqual(vm.mailUsage(b), {tenant: 0, host: 0});
  vm.send(b, 600);
  vm.shutdown(b); vm.stop(b); vm.destroy(b);
  const c = vm.create("c", isolate({mailBytes: 1000})); vm.start(c);
  vm.send(c, 1000);
});
