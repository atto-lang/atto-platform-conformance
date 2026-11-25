# TenantVM actor containment v1 — source-free contract

**Proof class: SOURCE_FREE_REFERENCE only.** This extension of
oreslang.tenant-isolation.v2 fills a specific gap: a tenant isolate must
contain **multiple untrusted actors**, with actor-owned state inside a
separately owned tenant security domain. A passing Node model test does not
prove compiled AttoLang execution, a real VM isolate, physical guest memory
protection, preemptive kill, or native scheduler fairness.

## Intended hierarchy

    One OS process
      OresVM root: authenticated tenant admission, code approval,
                   immutable module cache, global quotas, scheduling and I/O broker
        TenantVM A / generation 1 / enforced VM-isolate
          actor A1 / incarnation 1: private heap, mailbox, active turn
          actor A2 / incarnation 2: private heap, mailbox, active turn
        TenantVM B / generation 2 / enforced VM-isolate
          actor B1 / incarnation 3: private heap, mailbox, active turn

The tenant VM owns the shared **security boundary**, memory budget, actor
registry, capability scope, module globals, user symbols and shutdown epoch.
An actor owns its **mutable state, mailbox, arena and exclusive turn**.
Per-actor arenas alone are not tenant security isolation. Never allocate a
new full VM isolate for every actor merely to obtain actor memory safety.

Tenant identities and actor turn authority come from the **trusted scheduler
and broker**, never tenant_id in guest source, an HTTP header, a reconstructed
ActorRef, or a raw pointer. Direct cross-tenant actor sends are forbidden. A
future explicit cross-tenant gateway must reauthorize both sides, make an
owned serialized copy and charge both source and destination quotas.

## Executable bounded reference

- src/tenant-vm-actor-containment-v1.mjs holds opaque root-local tenant
  handles and actor grants. It tests denial at actor-turn, mailbox and
  memory boundaries without making any native/sandbox claims.
- tests/tenant-vm-actor-containment-v1.test.mjs executes a 12-case test
  suite, including multiple actors in one tenant, alias/foreign-root/replay
  denial, copied mailbox bytes, per-actor and aggregate quotas, quiescent
  admission fencing, borrowed-turn revocation, tenant kill, and survivor
  progress in an unrelated tenant.
- contracts/tenant-vm-actor-containment-v1.json records the versioned
  obligations and explicitly labels every backend's actual untrusted-guest
  execution unverified.

Run: node --test tests/tenant-vm-actor-containment-v1.test.mjs

## Backend promotion gates (none proven by this model)

1. **Java/GraalVM:** authenticated tenant lifecycle binds each untrusted
   compiled actor to a *real* per-tenant Graal isolate. A polyglot Context
   alone is not sufficient. Prove safepoint cancellation, native heap caps,
   actor scheduler binding, and neighbor survival.
2. **LLVM:** only validated guest code may execute inside the actual
   per-tenant native memory cage. Native FFI pointers may not escape cage
   validation. Prove the actor registry and checked relative addressing
   are part of the **compiled guest path**, not a parallel host mock.
3. **Wasm/Wasmtime:** reuse a tenant's Store security domain for its actor
   instances (and optionally per-actor private linear memories), never
   share mutable guest memory across tenants. Prove per-tenant epoch/fuel
   interruption, actor mailbox ownership, and bounded aggregate host RSS.
4. **Forge:** retain fail-closed untrusted admission until there is a real
   validated Wasm/VM-isolate execution path; actor arenas or native JIT
   output alone are not a security boundary.
5. **.NET Native AOT:** trust direct compiled CIL only for trusted tenants;
   untrusted actors must use a verified native VM-isolate/validated Wasm
   bridge. A CLR heap, AssemblyLoadContext, or a host dictionary does not
   isolate hostile tenants.

Across all five backends, require exact source SHA/tree, authenticated code
artifact provenance, real compiler-generated actor execution, negative
cross-tenant tests, a guest that spins until preempted, OOM/stack/trap
containment, I/O revocation and physical resource-loan drain. A zero-step
CI job counts as NOT_EXECUTED rather than success. Keep independent
actor concurrency inside one tenant while ensuring per-tenant fair shares
and worker/cgroup aggregate budgets at the OresVM root.
