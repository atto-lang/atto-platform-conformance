# AttoLang actor heap, logical stack, and full-AOT acceptance (candidate v1)

This is a **guest-execution acceptance plan**, not a claim that five independent backends have passed. Candidate contract: `contracts/actor-heap-stack-aot-v1.json`. Keep the canonical language spellings in `.atto` fixtures and do not use host-language mocks as a substitute for compiled guest evidence.

## Contract

Each actor incarnation owns a bounded private heap and **logical continuation stack**. A normal actor can have multiple concurrent receiver turns with distinct stacks; a `serial` actor has at most one. Parent/supervisor CONTROL messages do not provide general heap access to the child. `ActorRef` is a mailbox capability; compact Ref32 is a region-relative offset authenticated by trusted sidecar owner, incarnation, bounds, alignment, loan state and slot generation. No raw cross-tenant pointers.

Stack frames have static typed layouts and AOT-resolved resume/drop functions, occupy actor-owned storage, and can be destroyed on cancellation without relying on the OS carrier stack. No guest tracing collector or execution JIT is required. `rt take` moves only after successful mailbox admission, and borrowed actor state is accessible only under a scoped `critical-read` or `critical-write` permission. Unexpected native faults require an enforced sandbox/process or equivalent isolation boundary for **guaranteed** sibling survival; a C++ exception or SIGSEGV signal handler is not such a guarantee.

Heap exhaustion, bounded frame exhaustion, stale handles and cancellation must resolve locally with a terminal supervisor notice and deterministic loan draining before reclamation. Keep Java/.NET managed host GC and browser engine GC visible and measured; never call them zero GC merely because the guest arena uses no collector.

## Source fixtures and execution gate

The two immediately executable target fixtures are `two_actors.atto` (two actor instances emit lines 1 and 42; exit 0) and `recursive_actor_call.atto` (must reject unsafe synchronous recursion *without* an AOT artifact). They use the existing browser subset syntax. The proposed AOT guest-gate harness (`tools/actor_aot_guest_gate.rs`) invokes a backend-supplied adapter rather than inventing CLI flags:

```
ATTO_AOT_BACKEND=llvm ATTO_AOT_HEAD_SHA=<40-hex-source-commit> \
ATTO_AOT_COMPILER_SHA256=<64-hex-compiler-digest> \
  actor_aot_guest_gate /absolute/path/to/reviewed-adapter \
  fixtures/actor_heap_stack_aot_v1 /tmp/atto-aot-evidence
```

The adapter receives `compile <absolute-source.atto> <absolute-artifact>` and `run <absolute-artifact>`; it must compile real Atto source into a runnable AOT binary (including native linking, Native Image, NativeAOT, or compiled WebAssembly) and run it without JS/source interpretation. The harness rejects absent/non-binary artifacts, failed/missing guest execution, missing required provenance, unbounded hangs, negative compile success, or an artifact produced on a negative test. The harness's output alone is *not* a signed CI receipt: pair it with executed job steps, exact source tree SHA, target and immutable artifact digest plus independent review.

The other four scenarios in the contract (heap quota, stack quota, generation-fenced restart, guarded cross-actor borrows/cancellation) are explicitly **BLOCKED** until the relevant guest syntax and native implementations exist. Never score these as passed on the strength of a source-free reference model. They are the release-critical scenarios for production fault containment.

## LLVM first compiled native actor-frame slice — NOT YET CERTIFIED

[LLVM PR #1807](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1807)
is stacked on native frame-store [PR #1801](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1801).
It wires statically emitted actor `on_message` frame push/store/load/pop into the
private actor-incarnation frame store and adds
`tests/fixtures/actor-logical-frame-aot-two-actors.atto` plus a private
ABI-impersonation rejection. The source fixture returns 42 from `main`;
its mailbox STOP semantics may abandon pending delivery, so it **cannot** prove
that Actor B actually processed a message unless executed receipts show
nonzero processed turns.

A separate **native C11 runtime-only** adversarial test uses the real frame
primitive: Actor A hits a one-frame quota, Actor B still returns `42`, A
cancels, and incarnation 2 refuses stale incarnation 1 tokens. Local GCC and
Clang ASan/UBSan executions passed. This does **not** test a compiled
source-level quota exception, supervisor CONTROL notice, actual `.atto`
AOT guest turn/stack exhaustion, or a sandboxed native segfault.

**All cases remain NOT_EXECUTED as guest certification** until exact-head
compiler-linked target artifacts run with nonzero CI steps, followed by
compiler-generated per-turn frames, proper failure routing, and independent
backend review. No source-free model result may promote these statuses.

## Native actor quota → registered supervisor CONTROL → backpressure retry (HOST evidence only)

[LLVM PR #1814](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1814)
is stacked on LLVM #1807/#1801. Two **real native integration tests** link
NativeActorLogicalFramesV1 and NativeActorScheduler; the stronger test also
uses NativeOresVM's **registered** supervisor hierarchy, a physical STOP/DONE
barrier, an explicit host finalization receipt and priority typed CONTROL.

The test demonstrates A's bounded frame denial, B's separate logical-frame
result of 42, rejected premature/forged/replayed terminal notices, host-driven
reincarnation with stale token rejection, and a **saturated** supervisor CONTROL
slot that rejects a third terminal notice until the first two notices have
made capacity; the caller then retries successfully without dropping notices.

**Executed alternate org Actions evidence (GHA available, no cross-org token):**
[successful run #43649743384](https://github.com/athlet-o/athleto-docs/actions/runs/43649743384),
source LLVM PR exact head **f411187c89d7ff0f1b90e73c79db45669e793831**,
private carrier commit **cd8117c435fb4877c50844f94de2916413d67438**.
The 17-file source-dependency mirror included byte-identical original
CMakeLists.txt and was verified by Git blob SHA both during connector transfer
and on runner checkout. GCC C11 and Clang ASan/UBSan compiled and executed four
native tests three times each (**24/24 PASS**). The original host-only CMake
CTest configuration was also executed under both compilers (**4/4 PASS each**).

**Classification:** this is compiled **native host** evidence, not a full Git
tree clone, compiler-produced AttoLang guest, generated supervisor call path,
native signal/segfault containment, full concurrent actor state implementation
or five-backend AOT/zero-GC parity. The existing six contract cases remain
explicitly **NOT_EXECUTED** as independent guest-conformance evidence.
The source-level failure-to-supervisor bridge and actually resumable
actor-owned call/continuation stacks remain release blockers.

## Native source-actor failure accounting & registered root supervision

[LLVM draft #1819](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1819)
is stacked on #1814/#1807/#1801. The native SourceActorBootstrap bridge now
distinguishes **physically processed callbacks** from **successfully handled
messages**, preserving the last successful result after a receiver frame
failure. On frame error, it seals the failed actor's DATA admission. Every
source actor is registered under the root supervisor, and terminal notices
are published through registered NativeOresVM CONTROL after physical DONE,
heap/frame reclamation, and explicit host finalization receipt.

A source-runtime regression invokes statically linked native receiver
callbacks using the same frame ABI emitted by LLVM: Actor A successfully
handles payload 9 then fails on an invalid nested frame push; Actor B handles
42 independently. A retains last_success_result=9 with failed_messages=1,
does not admit further sends, and the root supervisor receives one typed
PANIC with the frame failure code plus one normal STOPPED for B.

**Executed native host evidence:**
[alternate private Actions #43651616456](https://github.com/athlet-o/athleto-docs/actions/runs/43651616456)
verified **31/31 exact source blobs**; GCC C11 and Clang ASan/UBSan
compiled/executed **30/30** tests; original no-LLVM host CMake/CTest
passed **5/5** per compiler. All GHA job steps executed.

**Verified LLVM native AOT guest smoke:**
[successful private alternate GHA run #43653113359](https://github.com/athlet-o/athleto-docs/actions/runs/43653113359)
at exact source **4c3392390d753b2666c4c73b235ccc74df526d3a**
and carrier commit **108e2b62eff910537b23fe2b7447441f9ce4201f**
verified 66/66 exact source Git blobs, built the LLVM compiler
with LLVM 22, compiled
`tests/fixtures/actor-logical-frame-aot-two-actors.atto` to LLVM IR,
confirmed real compiler-generated actor frame push/pop call sites, lowered
the IR to a native object with matching `llc-22`, then linked/executed
the actor application with Clang. The binary exited **42**, with two
independent termination receipts (Actor A processed=1, successful=1,
last=1; Actor B processed=1, successful=1, last=42).
The same run executed native host regression tests 30/30 times, plus
5/5 original CMake host tests under GCC and Clang ASan/UBSan.

This confirms **native AOT compiled actor execution** and the
separately executed *host* failure-to-supervisor bridge. It **does not**
yet produce a single compiler-generated `.atto` guest that exhausts
its frame/heap quota and is restarted by a source-language supervisor.
The carrier is a 66-file dependency-closed mirror, not a full source
Git tree clone. The six stricter registry cases retain NOT_EXECUTED
because their canonical fixture, output/negative criteria, and
complete provenance have not been independently met.


## Verified compiled LLVM actor-local frame admission failure (experimental fixture)

[LLVM draft PR #1824](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1824)
is stacked on #1819/#1814/#1807/#1801. Its
`tests/fixtures/actor-a-frame-quota-b-42.atto` has been copied byte-for-byte
to `fixtures/llvm_native_actor_aot/actor_a_frame_quota_b_42.atto`,
Git blob **567c7cdb606d95bd617ce467c9afc1845ad262a1**.

The LLVM-only experimental annotation `@ActorFrameBudget(0)` sets an
actor-local zero receiver-frame budget; LLVM emits a statically linked
budgeted source-actor spawn and its generated `on_message` fails its first
frame admission without treating its returned i64 zero as success.
The guest calls `ActorRef.flush_blocking()` from trusted main to await
physical callback outcomes before STOP (not from an actor carrier).
Actor B handles payload 42 **after** A's frame failure. The root supervisor
receives exactly one authenticated PANIC and one normal STOPPED CONTROL
envelope, after heap and logical-frame reclamation.

**Executed source-generated native AOT evidence:**
[private alternate Actions #43657432032](https://github.com/athlet-o/athleto-docs/actions/runs/43657432032).
Source LLVM exact commit **05d9731156cf433cab48bb5d3d28204d102a7ea1**,
carrier commit **2f1f78b320c90b9f6a836789d73d032b4c2ba937**.
69/69 exact source dependency blobs verified by Git SHA in the carrier.
The LLVM compiler compiled the `.atto` source into native LLVM IR; matching
LLVM22 `llc` emitted an object; Clang linked the real C runtime with
ASan/UBSan; all **five** repeated guest executions passed with native exit 42,
A accepted/processed=1, success=0, failed=1, code=0xA7700001; B
processed/successful=1, last=42; exactly one PANIC and STOPPED.
An `@ActorFrameBudget(17)` negative fixture produced no LLVM IR.
The same run passed 30/30 repeated native C tests and 10/10 CTest
executions across GCC and Clang sanitizers.

**Do not promote the five-backend parity registry yet.** This verifies a
zero-budget *frame-admission* boundary in the synchronous native scalar actor
profile. It does not demonstrate a deep nested stack overflow, resumable
actor-owned continuation frames, general heap OOM, concurrent receiver-state
loans, automatic source-supervisor restart of A, or sandboxed native
SIGSEGV containment. The private carrier mirrors the 69-file dependency
closure, not the complete private Git tree. The shared six-case canonical
contract remains NOT_EXECUTED for cross-backend certification; this
LLVM-only fixture is attached as concrete partial evidence.

## Verified compiled one-for-one root-supervisor recovery (LLVM-only experimental fixture)

[LLVM draft #1829](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1829)
is stacked on #1824/#1819/#1814/#1807/#1801.
`fixtures/llvm_native_actor_aot/actor_one_for_one_restart_a_b_42.atto`
is the exact source fixture from that PR (Git blob
**8030445fd3ffa664ebf6d82107f557da49e02661**).

In the synchronous scalar AOT profile, `@ActorLifetimeFrameBudget(1)`
enforces **one successful logical-frame admission per actor incarnation**,
separate from the maximum simultaneous-frame depth. The actor also declares
`@ActorRestartLimit(1)`: a bounded one-for-one supervisor policy.

A processes payload 7, then payload 8 fails frame admission with typed
actor-local failure code `0xA7700001`. After physical DONE and heap/frame
reclamation, registered root priority CONTROL authorizes one fresh child
A₂ with the **same budgets**, independent actor ID, physical scheduler slot,
mailbox, heap and frame allocation. The consuming trusted-main
`recover_blocking()` observes that supervisor-selected replacement.
A₂ processes 9; sibling B remains alive and processes 42.
The source guest receives exactly one root PANIC, two STOPPED notices,
three terminal receipts and native exit 42. A stale old ActorRef is rejected
and a duplicate recovery attempt denied in the native ABI regression.

**Executed final exact-head alternative private Actions evidence:**
[successful run #43667139629](https://github.com/athlet-o/athleto-docs/actions/runs/43667139629),
source exact SHA **f71dcf0656d934219bc72a2c2cdbc6abb7a5b6ad**,
carrier exact commit **451a70714bd09104d055cabd4993c6e64e5a5233**.
Git blob identity verified **72/72** for the dependency-closed mirror
(no cross-org GITHUB_TOKEN or custom secrets).
GCC C11 strict warnings plus Clang ASan/UBSan executed **36/36** original
repeated native test cases and **6/6** restart-budget-exhaustion variants;
the original CMake host-only profile passed **7/7** CTest cases under
each compiler (**14/14**). Compiled `.atto` native AOT
(LLVM22 → llc22 → Clang) passed 3/3 one-for-one restart runs, 5/5
quota-isolation runs and the healthy two-actor smoke.
The negative `@ActorRestartLimit(5)` fixture failed without LLVM IR.

**Security and completeness limits:** actor turn frames are synchronous
scalar frames, not heap-owned resumable continuations. The new A₂ uses a
new scheduler *slot* with a distinct physical identity; its initial slot
generation value may also be 1 (slot identity provides freshness).
A second quota failure by A₂ produces a second PANIC but **no A₃**, because
the total restart allowance is exhausted; escalation is not yet a typed
source-level Result or application supervisor policy. The root CONTROL
callback chooses the restart, but the external trusted-main
`recover_blocking()` bridge still drives old-child finalization.
Unbounded CONTROL slot retry if the supervisor is permanently unavailable,
process-wide native signal containment, full Git-tree verification,
parallel receiver turns, and backend parity remain unverified.
Therefore this LLVM experimental fixture must **not** be used to mark the
canonical six-case five-backend contract PASS.

## Dependencies and release order

1. Actor memory contract in `atto-common-source` PR #13; reconcile with `shared-actor-arenas.v1` and actor transfer contracts.
2. LLVM native logical frame store PR #1801 — host runtime ABI only, not source AOT lowering.
3. Rust/Wasm compile-time actor call graph PR #100 — static no-recursion bound, not general actor continuations.
4. Bind real guest heap/frame layout, resume/drop code and supervisor terminal notices in each backend. Run *all* scenarios on exact SHA with nonzero CI step evidence before claiming parity or zero-GC certification.