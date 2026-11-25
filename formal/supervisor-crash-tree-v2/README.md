# Supervisor crash and CONTROL delivery reassignment — model v2

Status: **MODEL_ONLY**, **not** an AttoLang compiler/runtime implementation.

## Bounded topology and authority

Trusted in-process guardian R owns supervisor S and unaffected actor B. S owns supervisor T; T owns actor A. This is a finite five-node topology with two generations per managed node. The guardian is assumed healthy for the whole exploration. Actor and supervisor guest executions **never own** the authoritative failure escrow.

A supervisor failure atomically fences the affected subtree. A descendant with already-admitted in-flight execution **may still fail after the fence**. Each such failure receives its own pre-reserved, generation-bound terminal notice. Delivery records capture the current nearest healthy ancestor and its generation. If that supervisor fails before acknowledging, the old delivery token becomes invalid; the notice stays in the ledger and can be redelivered to the next healthy ancestor, without duplication.

ACK requires the currently authorized controller/generation and current delivery. Retirement and reclamation remain distinct. Reclamation is disallowed with pending notices, physical loans, or unreclaimed descendants. Supervisor restart must follow child reclamation and increments generation. Sibling B is never fenced by S/T/A failure.

## Checks and evidence

- `check.mjs`: dependency-free exhaustive finite-state exploration of **8,738 reachable states, 36,319 edges, and 36 action labels** in an in-session V8 invocation of the exact committed JavaScript function.
- Detects 5 deliberately invalid state mutations and rejects 3 forged/stale acknowledgment cases.
- Critical witnesses: nested concurrent failures, child terminal delivery to S before S crashes, reroute to R, and full S/T/A generation-2 recovery.
- `SupervisorCrashEscrowV2.tla` and `.cfg`: independent TLA+ specification and invariant inventory. **TLC NOT_EXECUTED** until an approved stepful runner executes against exact versioned Git blobs.
- The v1 model remains as an independently reviewable smaller regression gate.

**Execution provenance:** model JavaScript was executed in an isolated V8 authoring runtime and independently committed; GitHub stepful CI remains necessary. This is not a production trace-refinement proof, arbitrary-tree inductive theorem, scheduler fairness/liveness proof, or crash-safe persistence guarantee.

## Proof limitations and next gates

The finite model assumes atomic host CONTROL transitions and pre-reserved failure escrow, a trusted healthy R, a fixed five-node tree, abstract physical-loan receipts and no dynamically added children during recovery. It does not simulate real process crashes, bounded scheduler queues or timeouts, FFI loan details, hot reload, crash-consistent disk journals, or untrusted guest code. Real Java/Graal, LLVM, .NET, Wasm and Forge compile/guest tests are still **NOT_CERTIFIED**.

Backend milestone: implement a trusted host-owned ledger with authoritative CONTROLLER generation and one-use, runtime-only delivery capabilities; connect it to the production supervisor lifecycle reducer; then establish exact guest-to-model trace refinement, including callbacks that race supervisor failure, restart, cancellation and physical reclamation. Never let a supervisor directly read another actor's sealed state.

Related drafts: Java #1924/#1965, LLVM #864, and Java host escrow companion draft based on #1965. Keep release evidence separate from this model.
