// SUPERSEDED by tenant-isolation-v2 (shared OS process, one VM-isolate per
// tenant). Kept as history. Source-free host-policy reference model. This does NOT execute real .ores
// actors or prove physical isolation on Java/LLVM/Wasm/Cranelift/.NET/Forge/JS.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/tenant-isolation-v1.json", import.meta.url), "utf8"));

class TenantReference {
  #entries = new Map();
  #next = 1;
  #limit;
  #capacity;
  constructor({maxTenants = 2, maxInflight = 1} = {}) {
    assert.ok(Number.isSafeInteger(maxTenants) && maxTenants > 0);
    assert.ok(Number.isSafeInteger(maxInflight) && maxInflight > 0);
    this.#limit = maxTenants;
    this.#capacity = maxInflight;
  }
  #check(handle) {
    const e = handle && this.#entries.get(handle.id);
    if (!e || e.handle !== handle || e.epoch !== handle.epoch) {
      throw Error("STALE_TENANT_HANDLE");
    }
    return e;
  }
  create(id, {untrusted = false, boundary = "trusted-inprocess"} = {}) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(id) ||
        id === "." || id === "..") throw Error("INVALID_ID");
    if (typeof untrusted !== "boolean") throw Error("INVALID_TRUST_FLAG");
    if (typeof boundary !== "string") throw Error("INVALID_BOUNDARY");
    // Never downgrade an explicit request for a stronger security domain.
    // This model implements ONLY trusted in-process reference execution.
    if (untrusted && boundary !== "os-sandbox-verified") throw Error("SECURITY_BOUNDARY_REQUIRED");
    if (boundary === "os-sandbox-verified") throw Error("OS_SANDBOX_NOT_IMPLEMENTED");
    if (boundary !== "trusted-inprocess") throw Error("UNSUPPORTED_BOUNDARY");
    if (this.#entries.has(id)) throw Error("DUPLICATE_TENANT");
    if (this.#entries.size >= this.#limit) throw Error("TENANT_QUOTA");
    if (this.#next >= Number.MAX_SAFE_INTEGER) throw Error("GENERATION_EXHAUSTED");
    const handle = Object.freeze({id, epoch:this.#next++});
    this.#entries.set(id,{handle,epoch:handle.epoch,phase:"created",
      state:0,work:0,leases:new Set(),scalarTurn:false,maxInflight:this.#capacity});
    return handle;
  }
  start(h) {const e=this.#check(h);if(e.phase!=="created") throw Error("PHASE");e.phase="running";}
  lease(h) {
    const e=this.#check(h);
    if(e.phase!=="running") throw Error("ADMISSION_CLOSED");
    const loan=Object.freeze({identity:Symbol("resource-lease")});
    e.leases.add(loan);
    return loan;
  }
  release(h,loan) {
    const e=this.#check(h);
    if(!e.leases.delete(loan)) throw Error("FOREIGN_OR_REPLAYED_LEASE");
  }
  async invoke(h,call) {
    const e=this.#check(h);
    // The scalar reference represents ONE actor turn. A higher per-tenant
    // admission capacity must never imply concurrent execution of one actor.
    if(e.phase!=="running" || e.work>=e.maxInflight || e.scalarTurn)
      throw Error("ADMISSION_CLOSED");
    e.work++;
    e.scalarTurn=true;
    try {
      // A mutable state snapshot and result belong only to the calling
      // tenant. A user callback cannot receive another tenant's state.
      const delta=await call(e.state);
      if(e.phase!=="running" && e.phase!=="quiescing")throw Error("STOPPED");
      if(!Number.isSafeInteger(delta))throw Error("INVALID_RESULT");
      const next=e.state+delta;
      if(!Number.isSafeInteger(next))throw Error("OVERFLOW");
      e.state=next;
      return next;
    } catch(err) {
      // A guest failure quarantines the incarnation. Inflight work must
      // drain before destruction; stale handles remain rejected afterwards.
      e.phase="quiescing";
      throw err;
    } finally {
      e.work--;
      e.scalarTurn=false;
    }
  }
  snapshot(h) {const e=this.#check(h);return {phase:e.phase,epoch:e.epoch,state:e.state,active:e.work};}
  shutdown(h) {const e=this.#check(h);if(e.phase!=="running"&&e.phase!=="created")throw Error("PHASE");e.phase="quiescing";}
  stop(h) {const e=this.#check(h);if(e.phase!=="quiescing"||e.work||e.leases.size)throw Error("DRAIN_REQUIRED");e.phase="stopped";}
  destroy(h) {const e=this.#check(h);if(e.phase!=="stopped")throw Error("STOP_REQUIRED");this.#entries.delete(h.id);}
}
const fails=(f,why)=>assert.throws(f,new RegExp(why));

test("manifest enumerates actual backends and refuses promotional security claims",()=>{
  assert.equal(contract.schema,"oreslang.tenant-isolation.v1");
  // v1 is kept as history; tenant-isolation-v2 is the live contract.
  assert.equal(contract.status,"SUPERSEDED_BY_V2");
  assert.equal(contract.supersededBy,"oreslang.tenant-isolation.v2");
  assert.deepEqual(contract.design.identity,["tenantId","generation","opaqueHostAuthority"]);
  assert.match(contract.design.tenant_id_validation,/excluding reserved path components/);
  assert.match(contract.design.root_authority,/matching tenant ID and numeric generation/);
  assert.deepEqual(Object.keys(contract.backendProfiles).sort(),["cranelift","forge","java","js","llvm","net","wasm"]);
  assert.ok(contract.requiredScenarios.includes("exact-pr-tree-nonzero-step-ci-evidence"));
  assert.ok(contract.requiredScenarios.includes("neighbor-survives-tenant-trap-and-reincarnation"));
  assert.match(contract.backendProfiles.cranelift.draft,/scalar native JIT/);
  assert.match(contract.backendProfiles.cranelift.currentGuarantee,/not an actor IsolateVM/);
  for (const caseName of [
    "cranelift-scalar-only-actor-admission-rejected",
    "tenant-close-revokes-pinned-actor-memory",
    "zeroized-actor-region-before-final-free",
    "native-actor-control-and-data-stepful-integration"
  ]) assert.ok(contract.requiredScenarios.includes(caseName));
  for(const b of Object.values(contract.backendProfiles)) {
    assert.match(b.currentGuarantee,/not |distinct |do not /);
    assert.match(b.hostileTenant,/PROCESS_SANDBOX/);
  }
});
test("distinct tenants retain private mutable state",async()=>{
  const vm=new TenantReference();
  const a=vm.create("tenant-a"),b=vm.create("tenant-b");
  vm.start(a);vm.start(b);
  assert.equal(await vm.invoke(a,()=>1),1);
  assert.equal(await vm.invoke(b,()=>1),1);
  assert.equal(await vm.invoke(a,()=>1),2);
  assert.equal(await vm.invoke(b,()=>1),2);
});
test("independent VM roots reject same-name same-generation foreign handles", async()=>{
  const rootA=new TenantReference();
  const rootB=new TenantReference();
  const a=rootA.create("tenant");
  const b=rootB.create("tenant");
  assert.equal(a.epoch,b.epoch,
    "the roots deliberately share the same numeric generation");
  rootA.start(a);rootB.start(b);
  await assert.rejects(rootA.invoke(b,()=>99),/STALE_TENANT_HANDLE/);
  await assert.rejects(rootB.invoke(a,()=>99),/STALE_TENANT_HANDLE/);
  fails(()=>rootA.snapshot(b),"STALE_TENANT_HANDLE");
  fails(()=>rootB.shutdown(a),"STALE_TENANT_HANDLE");
  assert.equal(await rootA.invoke(a,()=>1),1);
  assert.equal(await rootB.invoke(b,()=>1),1);
  rootA.shutdown(a);rootA.stop(a);rootA.destroy(a);
  rootB.shutdown(b);rootB.stop(b);rootB.destroy(b);
});

test("stale incarnation handles cannot regain ownership after restart",async()=>{
  const vm=new TenantReference({maxTenants:1});
  const old=vm.create("t");vm.start(old);
  assert.equal(await vm.invoke(old,()=>42),42);
  vm.shutdown(old);vm.stop(old);vm.destroy(old);
  const fresh=vm.create("t");vm.start(fresh);
  fails(()=>vm.snapshot(old),"STALE_TENANT_HANDLE");
  assert.equal(await vm.invoke(fresh,()=>1),1);
  assert.notEqual(fresh.epoch,old.epoch);
});
test("duplicate and aggregate admissions are bounded",()=>{
  const vm=new TenantReference({maxTenants:1});
  vm.create("tenant");
  fails(()=>vm.create("tenant"),"DUPLICATE_TENANT");
  fails(()=>vm.create("other"),"TENANT_QUOTA");
  fails(()=>vm.create("../bad"),"INVALID_ID");
  fails(()=>vm.create("."),"INVALID_ID");
  fails(()=>vm.create(".."),"INVALID_ID");
});
test("dot path-components never become tenant IDs on any backend",()=>{
  const vm = new TenantReference({maxTenants:1});
  for (const id of [".","..","../outside","tenant/path","a b","é",""]) {
    fails(()=>vm.create(id),"INVALID_ID");
  }
  const valid = vm.create("team.alpha-1_root");
  vm.start(valid);
  assert.equal(vm.snapshot(valid).phase,"running");
  vm.shutdown(valid); vm.stop(valid); vm.destroy(valid);
});
test("untrusted execution never downgrades to logical or Worker isolation",()=>{
  const vm=new TenantReference();
  fails(()=>vm.create("bad",{untrusted:true,boundary:"trusted-inprocess"}),"SECURITY_BOUNDARY_REQUIRED");
  fails(()=>vm.create("bad",{untrusted:true,boundary:"wasm-store"}),"SECURITY_BOUNDARY_REQUIRED");
  fails(()=>vm.create("bad",{untrusted:true,boundary:"os-sandbox-verified"}),"OS_SANDBOX_NOT_IMPLEMENTED");
  // These requests previously could be silently admitted whenever the
  // untrusted flag was false; forbid unknown modes independently of trust.
  fails(()=>vm.create("trusted",{boundary:"wasm-store"}),"UNSUPPORTED_BOUNDARY");
  fails(()=>vm.create("trusted",{boundary:"vm-isolate"}),"UNSUPPORTED_BOUNDARY");
  fails(()=>vm.create("trusted",{boundary:"something-else"}),"UNSUPPORTED_BOUNDARY");
  fails(()=>vm.create("trusted",{boundary:5}),"INVALID_BOUNDARY");
  fails(()=>vm.create("trusted",{untrusted:"false"}),"INVALID_TRUST_FLAG");
});
test("shutdown fences new admission and waits for a real inflight turn",async()=>{
  const vm=new TenantReference();
  const h=vm.create("t");vm.start(h);
  let release, entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const blocker=new Promise(resolve=>{release=resolve;});
  const call=vm.invoke(h,async()=>{entered();await blocker;return 3;});
  await started;
  fails(()=>vm.stop(h),"DRAIN_REQUIRED");
  vm.shutdown(h);
  await assert.rejects(vm.invoke(h,()=>1),/ADMISSION_CLOSED/);
  fails(()=>vm.stop(h),"DRAIN_REQUIRED");
  release();
  assert.equal(await call,3);
  vm.stop(h);
  vm.destroy(h);
  fails(()=>vm.snapshot(h),"STALE_TENANT_HANDLE");
});
test("execution failure quarantines tenant and restart restores fresh state",async()=>{
  const vm=new TenantReference({maxTenants:1});
  const h=vm.create("tenant");vm.start(h);
  await assert.rejects(vm.invoke(h,async()=>{throw Error("GUEST_TRAP");}),/GUEST_TRAP/);
  assert.equal(vm.snapshot(h).phase,"quiescing");
  await assert.rejects(vm.invoke(h,()=>1),/ADMISSION_CLOSED/);
  vm.stop(h);vm.destroy(h);
  const newH=vm.create("tenant");vm.start(newH);
  assert.equal(await vm.invoke(newH,()=>1),1);
});

test("failed tenant cannot poison healthy neighbor and reincarnation resets only failed state",async()=>{
  const root=new TenantReference({maxTenants:2});
  const healthy=root.create("healthy");
  const failed=root.create("failing");
  root.start(healthy);root.start(failed);
  assert.equal(await root.invoke(healthy,()=>1),1);
  assert.equal(await root.invoke(failed,()=>4),4);

  await assert.rejects(root.invoke(failed,async()=>{
    throw Error("GUEST_TRAP");
  }),/GUEST_TRAP/);
  assert.equal(root.snapshot(failed).phase,"quiescing");
  await assert.rejects(root.invoke(failed,()=>1),/ADMISSION_CLOSED/);
  assert.equal(root.snapshot(healthy).phase,"running");
  assert.equal(await root.invoke(healthy,()=>1),2,
    "failure of one incarnation may not interrupt another tenant's progress");

  root.stop(failed);root.destroy(failed);
  fails(()=>root.snapshot(failed),"STALE_TENANT_HANDLE");
  const fresh=root.create("failing");
  root.start(fresh);
  assert.notEqual(fresh.epoch,failed.epoch);
  assert.equal(await root.invoke(fresh,()=>1),1,
    "reincarnated failed tenant must start with clean state");
  assert.equal(await root.invoke(healthy,()=>1),3,
    "healthy tenant must retain its state after neighbor's reincarnation");
  await assert.rejects(root.invoke(failed,()=>99),/STALE_TENANT_HANDLE/);
  root.shutdown(fresh);root.stop(fresh);root.destroy(fresh);
  root.shutdown(healthy);root.stop(healthy);root.destroy(healthy);
});

test("resource leases are host-owned and foreign or replayed releases are refused",()=>{
  const vm=new TenantReference();
  const a=vm.create("a"),b=vm.create("b");
  vm.start(a);vm.start(b);
  const loan=vm.lease(a);
  fails(()=>vm.release(b,loan),"FOREIGN_OR_REPLAYED_LEASE");
  vm.shutdown(a);
  fails(()=>vm.lease(a),"ADMISSION_CLOSED");
  fails(()=>vm.stop(a),"DRAIN_REQUIRED");
  vm.release(a,loan);
  fails(()=>vm.release(a,loan),"FOREIGN_OR_REPLAYED_LEASE");
  vm.stop(a);vm.destroy(a);
  fails(()=>vm.release(a,loan),"STALE_TENANT_HANDLE");
  vm.shutdown(b);vm.stop(b);vm.destroy(b);
});

test("scalar actor turns are non-reentrant even with extra tenant capacity",async()=>{
  const vm=new TenantReference({maxInflight:3});
  const h=vm.create("tenant");vm.start(h);
  let signal,release;
  const started=new Promise(r=>{signal=r;});
  const blocked=new Promise(r=>{release=r;});
  const active=vm.invoke(h,async()=>{signal();await blocked;return 4;});
  await started;
  await assert.rejects(vm.invoke(h,()=>10),/ADMISSION_CLOSED/);
  assert.equal(vm.snapshot(h).active,1);
  release();
  assert.equal(await active,4);
  assert.equal(await vm.invoke(h,()=>2),6);
});
