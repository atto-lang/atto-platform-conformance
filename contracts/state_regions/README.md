# Oreslang state-region capability contract — proposal v0

Status: **source-free executable specification**, NOT implemented language syntax, production runtime, verified allocation behavior, or multi-backend parity.

## Access and storage
* `let` locals and exclusively owned mutable heap graphs require no lock if there is exactly one active exclusive borrower; placement on stack or heap does not grant authority.
* Persistent mutable object graphs live in identifiable owner regions; injection shares **handles to operations**, not unrestricted mutable references.
* An operation-level read/write capability is scoped, non-escaping and tied to a region and handler/task identity. Inner references inherit the same protection, including nested collections.
* Read scopes may coexist. A write scope excludes all other read/write scopes. Shared state operations protect complete invariants. Partition only after disjointness is proven.
* A fixed binding does not make nested data immutable. Publication must be deeply safe or transfer ownership.

## Boundary effects
* Lock acquisition before granting access, even uncontended, is a potential actor-handler admission point; a contended lock queues the handler without parking the worker.
* After releasing the last incompatible capability, the handler can admit another handler.
* `rt cooperate` is an actor-visible admission point only without incompatible live capabilities.
* Compiler-inserted budget checkpoints may schedule another actor but do not release the current actor's logical turn or any lock.
* OS preemption does not create language-level actor reentrancy.
* The implementation must preserve serial-actor behavior until an explicitly checked reentrant policy is introduced.
* Callback, lock acquisition, await/select, cancellation and FFI effects are checked transitively. Reject unknown dangerous effects in a protected operation.
* Nested acquisitions require a proven global order or an ordered multi-lock API; recursive acquisition is not silently allowed.

## Reclamation and failure
* The region is a logical scope; it need not allocate a heap object or a runtime guard.
* LLVM: native ownership + deterministic teardown after the **last actual task/loan/pin** retires; no tracing garbage collector. Cycles in one owned arena must not impede teardown.
* Java/GraalVM: minimize managed allocations with reusable or carefully scoped native/off-heap storage; require explicit lifetime and pin guards around foreign memory. Native Image alone does not guarantee zero GC.
* Cancellation is a request, not retirement. Do not reclaim until delayed callbacks, continuations, FFI users and readers have actually stopped.
* No automatic snapshots, per-operation copies, or allocating capability wrappers in the optimized path.
* An error does not automatically roll back in-place mutations; operations must preserve or restore invariants at release. Never automatically retry external side effects.
* Read-only observers receive immutable owned values and notifications only **after** protected access ends.

## First compiler milestones
1. Java: execute PR #2296 13 real compiler tests on JDK25/Graal, separately from source-free model results; reconcile with Java #2098 ownership checks.
2. Add HIR/MIR metadata: `region_id`, `owner_task`, `access_mode`, `loan_scope`, `may_suspend`, `may_admit_handler`, `may_publish`, `may_escape`, `allocation_region`; make unsupported metadata fail closed rather than silently erase.
3. Lower exclusive owned operations to direct field/index mutation; shared operations to scope-checked synchronization. Verify all aliases obey the owning region.
4. Add actor scheduler admission at marked boundaries, with deterministic cancellation/queue-order tests and strict no-admission inside protected critical sections.
5. Execute the exact same guest positive/negative cases on Java, LLVM, .NET, WASM and Forge. Unsupported source is a rejection, not a pass.

## Required backend measurement
| Gate | LLVM | Java/Graal | .NET | WASM | Forge |
| --- | --- | --- | --- | --- | --- |
| Compiler safety/negative alias tests | required | required | required | required | required |
| Real actor interleavings/lock contention | required | required | required | required | required |
| Per-mutation heap allocations | **0 steady state** | bounded/report count | bounded/report count | bounded/report count | **0 target** |
| Reclamation after last actual pin | deterministic | explicit region / offheap | explicit lifetime | owned linear memory | deterministic |
| Worst-case interruption + tail latency | bounded hard-RT target | soft-RT target | measured | measured | measured |

The zero-alloc target is **not** demonstrated by this Python model. Compiler-produced assembly/IR, heap-profiler counters, sanitizer and memory leak runs are necessary. Likewise no broad deadlock-free or fairness proof follows from one-region isolation.

## Executable model
`python3 -m unittest discover -s contracts/state_regions -p 'test_*.py' -v`

The model checks core capability admission/release, writer exclusion, read sharing, no post-release access, non-admission under a live capability, budget-check distinction, no implicit snapshot allocation **in the model**, and reclamation only after all tracked pins retire. It has no actual concurrency and intentionally cannot certify compiler execution or GC behavior.

Research anchors: Boyapati/Lee/Rinard (OOPSLA 2002); GhostCell (ICFP 2021); Castegren/Wrigstad (ECOOP 2016); cooperability (Yi et al. 2015); observationally cooperative multithreading; AME (HotOS 2007). These motivate the contract; they do not prove this implementation.


## Compile-time requirement versus runtime provenance

The compiler must **not invent concrete runtime execution IDs or generations**.
State-region authority has two layers:

1. **Compile-time requirement** — `state-region-loan-requirement.*` records a
   region binding expression/place, lexical loan ID, access mode and the
   requirement to bind to the `current-logical-execution` with a generation
   fence. This is what source/HIR/MIR lowering may carry.
2. **Runtime provenance** — `state-region-loan-provenance.*` is materialized
   only when the scheduler/runtime has the actual region incarnation and
   authenticated execution context. It contains concrete region generation,
   runtime domain, logical execution and execution-slot generation.

A backend fails closed if it cannot materialize the runtime provenance from the
compile-time requirement without trusting guest-provided identity fields.
Release authorization compares the runtime provenance/ticket created at borrow
time; source code cannot supply or forge those concrete fields.

## Exact task-bound loan identity

A shared-state loan is not authorized by a lexical `loan_id` alone. Cross-turn or
region-backed access must bind all of:

- `region_id` + `region_generation`
- `runtime_domain` + logical `execution_id`
- generation-checked `execution_slot` + `execution_generation`
- lexical `loan_id`, place and read/write mode

A release with a mismatched task, stale execution generation, different region,
or missing required provenance must fail closed. Physical carrier/thread identity
is deliberately not part of the authority: a logical task may migrate carriers
while its authenticated execution identity remains stable.

Canonical machine-readable shapes are
`state-region-loan-provenance.schema.json` and
`state-region-loan-provenance.tsp`. These records are conformance evidence;
they never mint a runtime capability.

## Executed source-free evidence — 2026-10-30

A separately authored source-free contract suite ran in
`honeypot-r-us-test/hnpt-e2e`, branch
`test/state-region-source-free-canary-20261030`.

Latest exact carrier head:
`1b5e265ac56c6fbc88dc97fe6bdc3549604c7d2c`.

Real GitHub-hosted runs:
- `41005574007`: JDK 25 provenance canary, 12-test Python state-region model
  including canonical JSON vectors, optimized C11 `-DNDEBUG -Werror`, and
  ASan + UBSan — all PASS.
- `41005574006`: Node 22/WASM provenance, .NET 10 provenance, and C++20/Forge
  provenance — all PASS.

An earlier .NET source-free canary exposed two genuine harness compilation
defects (top-level statement placement, then missing explicit core namespaces);
both were fixed before the green run. Those were carrier-model defects, not
private backend results.

This proves alternate-runner capacity, current toolchain availability, and the
independent contract only. It does **not** execute or certify any private
Java/LLVM/.NET/WASM/Forge compiler/runtime head.

No private source tree was transferred. Source-repository export policy must
authorize the exact destination and exact source snapshot before any such
transfer, regardless of runner budget.
