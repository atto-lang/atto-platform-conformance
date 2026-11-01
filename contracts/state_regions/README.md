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


## Physical-lifetime admission vectors (2026-10-30)

`physical-quiescence-v1.json` records eight versioned, backend-neutral
retirement scenarios: admitted running turns, turns queued before STOP,
late-start rejection, queued rejection, cancellation with outstanding
lifetime pins, multiple outstanding Task/FFI pins, duplicate completion and
bounded pin exhaustion. A separate eight-case compiler admission registry
describes required borrow-escape, mutable aliasing, await/select/cooperate,
early retirement and checked-overflow behavior. It is a **test inventory**,
not actual compiled Oreslang source or a runtime certification.

`node --test tests/state-region-physical-quiescence-v1.test.mjs`
runs the independent source-free lifecycle reference oracle. It checks the
fixture expectations and 256 deterministic completion/STOP schedules. A
successful oracle run only means the specification is internally consistent.
It does **not** imply LLVM, Java/Graal, Wasm, .NET or Forge source lowering
is implemented, and does not justify a backend PASS in the evidence ledger.

Runtime separation: region lifetime pins keep memory alive, while a different
loan grants read/write authority. A queued pinned turn must separately claim
a one-time start under the retirement admission fence before it can execute.
An executor that throws **after** a turn started cannot transfer lifetime
release back to the submitting thread. Compiler proofs must enforce lexical
borrows and suspension. Java host bridge PR #2305 and LLVM native Task/actor
pin PR #1192 target these requirements through different physical backings.
Both remain drafts pending full executable guest and CI evidence.

## Existing native guest source fixture registry

`critical-state-guest-fixtures-v1.json` pins **nine genuine Oreslang
source fixture locators** from Java draft PR #2245 to immutable Git
commit `a88c48773861daa6dc6bc46cb3a0923bd198d842`, with the verified
per-file Git blob SHA and expected result: one positive actor-state
read/write program and eight expected compile rejections (read mutation,
mutable reborrow, unknown/forged mode, `await` in protected read/write,
escaping state and direct sealed-state access).

This registry intentionally copies **no private source bytes** across
repositories. The companion
`tests/critical-state-guest-fixture-registry-v1.test.mjs` asserts
unique source identities, exact hash notation, expected diagnostic types
and a fail-closed status for all five backends. It is metadata integrity
testing, not the execution of the source fixture against a compiler.
All per-backend receipt states remain `not-executed` until the specific
compiler actually compiles or rejects the immutable fixture and its
runtime host executes the positive case.

Additional source fixtures must be added for task/FFI STOP, retirement,
retained completion, alias escaping and allocation measurements; the
physical-lifetime JSON reference model cannot replace compiled guest tests.


## Exact-blob local guest-fixture registry checks — 2026-10-31

The checked-in registry and its Node 22 test were reconstructed
byte-for-byte from the exact source-repository Git blobs:
- `critical-state-guest-fixtures-v1.json`:
  `a09e0eb5c8b421b2acda68912d48166338db7784`
- `critical-state-guest-fixture-registry-v1.test.mjs`:
  `ad83e5f30631c5bee1b64ceddacc3702e3d1c2b2`

With these exact blobs, the local command
`node --test tests/critical-state-guest-fixture-registry-v1.test.mjs`
executed **2/2 PASS**, confirming unique immutable Oreslang source locators,
one positive/eight negative expectations, and a fail-closed
`not-executed` status for all 45 backend/fixture records. This authenticates
the bytes of the **metadata registry and Node test**, not the original
private `.ores` source contents or any backend execution.

Separate exact-source host results (also not compiler guest proof):
- Java #2305: two exact compiled Java host classes + checked-in smoke,
  JDK21 **8,022 assertions PASS** across 2,000 start/retire races.
  It also corrected an accepted-turn callback replay.
- LLVM #1192: standalone native C++20 region prototype, GCC/Clang optimized
  and ASan/UBSan **4/4 PASS**, each with 100,000 measured mutations.

The hosted source-org workflows on the corresponding PR heads still fail
with zero runner steps. The compiler guest, full runtime/FFI, real actor
reclamation and cross-backend parity evidence remains **not executed**.


## Dual carrier-and-native-I/O STOP vectors — 2026-10-31

`physical-quiescence-v1.json` now has **10** vectors, including two
additional logical lifetime contracts:

- `native-io-retired-before-carrier-physical-join`: native worker completes
  first; the actor carrier must still retain memory.
- `carrier-retired-before-native-io-physical-join`: carrier exits first;
  the native callback must still retain memory.

Both require STOP to reject reclamation until the **last** physical lifetime
claim retires. An on-demand independent in-process V8 oracle executed the
exact repository JSON blob
`0f291e1bfe41b5c59c7e915852591cdf4f7e20ac`
and checked all 10 vectors and their expected end state. The checked-in
`tests/state-region-physical-quiescence-v1.test.mjs`
was updated to require ten cases. Neither this independent model nor the
metadata checks constitute an executed Oreslang compiler, a real native
callback, or five-backend parity.

The corresponding real private-actor integration JUnit is in Java #2305;
its physical actor-lifetime integration execution remains unverified until
stepful CI or an authorized local full-source build. The LLVM runtime pin
test remains similarly source-org admission-blocked.

## 2026-11-01 mutable-state guest / independent Cranelift accounting

`mutable-state-container-guest-v1.json` pins a real private Oreslang guest
source **by SHA and location only**, without exporting source bytes. It writes
and reads actor-sealed state and must produce `mutable-state-container-ok`.
The diagnostic runner and companion Node tests validate the source Git blob,
expected output/exit, malformed fixture/CLI scenarios and six independently
recorded backend slots. They **do not substitute** for actual compiler-backed
execution or establish actor state storage semantics.

The nine critical-state programs now require **54** separate evidence slots
(9 fixtures × Java, LLVM, Wasm, Cranelift, .NET, Forge). All currently remain
`not-executed`. Historical counts of 45/five above describe the previous
five-target model, not verified parity. Cranelift's Rust/JIT scalar stage-0
currently rejects actors and protected state operations by design. Forge is a
different implementation; its host contract tests do not certify Cranelift.

Before promotion, independently execute the immutable guest and all nine
positive/negative compiler fixtures, record exact backend source/head SHA,
stepful runner logs, authenticated provenance, in-place mutation allocation
cost and physical Task/FFI drain evidence. Keep the security export hold until
the source repository permits the exact source snapshot and destination.
