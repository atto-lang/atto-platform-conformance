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

## Dependencies and release order

1. Actor memory contract in `atto-common-source` PR #13; reconcile with `shared-actor-arenas.v1` and actor transfer contracts.
2. LLVM native logical frame store PR #1801 — host runtime ABI only, not source AOT lowering.
3. Rust/Wasm compile-time actor call graph PR #100 — static no-recursion bound, not general actor continuations.
4. Bind real guest heap/frame layout, resume/drop code and supervisor terminal notices in each backend. Run *all* scenarios on exact SHA with nonzero CI step evidence before claiming parity or zero-GC certification.