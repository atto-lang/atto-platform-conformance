# Oreslang supervisor source admission contract (draft v1)

**This is a forward-looking semantic contract, NOT proof of `on_panic` source execution.**

A `define supervisor Name as ... end` declaration denotes an independently scheduled single-flight logical supervisor process with a reserved CONTROL lane. It does not denote a class, an actor mailbox in the child, or a method invoked directly on a failing child's carrier.

Initial mandatory hook: `on_panic(f: Failure): void`. The Java parser constructs a distinct `Ast.SupervisorDecl`; unsupported hooks and invalid typed signatures fail closed. Before actual lowering exists, compiler admission intentionally rejects the declaration rather than executing `on_panic` as an ordinary method. LLVM currently rejects the declaration at source admission with an explicit typed CONTROL-lowering diagnostic.

Required lowering gates:
1. Link a supervisor declaration to a private runtime process with immutable supervisor ID and inherited actor-family identity.
2. Materialize an owned, typed `Failure` payload after the failed actor has physically finalized.
3. Admit exactly one CONTROL turn on the supervisor's own single-flight logical lane; no host/guest callback on the failed child's stack.
4. On `await`, release the physical carrier but retain logical turn ownership and a generation-fenced continuation.
5. Authoritative decisions: STOP, RESTART (new generation), ESCALATE (parent CONTROL), ACKNOWLEDGE. Every side effect must commit or fail closed with visible diagnostics and bounded queues.
6. Preserve exception effects, LIFO `defer`, cancellation finalization, and actor memory isolation.
7. Prove the same observable guest fixture through Java/Graal and LLVM on private funded runners at an exact SHA, plus AOT/hybrid and ASan/UBSan.

The native typed panic bridge already proves host-level STOP and multiworker physical-finalization ordering. It does not prove any of the missing source-level execution gates.


## Focused cross-backend host commit/close proof (2026-10-11)

Private funded workflow: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38175362173

This workflow verifies Git blob hashes for the exact Java supervisor process,
failure CONTROL, and enqueue-guard sources, plus the exact native C++ supervisor
process, failure CONTROL, enqueue-guard, and exception-policy headers. Both
focused host execution jobs passed; native C++20 was built with ASan/UBSan.

The contracts under test are:

- A decision sink that calls supervisor.close() and then throws has an **unknown
  lifecycle effect**, not an acknowledged commit and not an automatic retry.
  The original failure is retained when available, one notice is accounted as
  undelivered, and the requested shutdown finishes.
- A successfully applied lifecycle decision that reentrantly closes its own
  supervisor commits once; later queued notices are counted as undelivered
  rather than silently consumed.
- Closed supervisors reject late/replayed CONTROL work or continuations.

**Evidence boundary:** The Java test is a focused standalone runtime proof
with minimal test-only actor identifier stand-ins (JDK 17). The native test
compiles the exact runtime headers with private harness code. This is not
full Maven/JDK 25, full LLVM CMake/CTest, Graal native-image, or guest-source
on_panic execution. All compiler source admission remains fail closed.

## First executable guest milestone admission

The eventual `on_panic(f: Failure): void` source hook must receive compiler-owned,
immutable Failure metadata **only after physical child finalization**, on its
own supervisor CONTROL lane. A guest method call on the failed child's carrier,
an ambient Java method callback, or an unvalidated host callback is not enough.
The source hook's `void` return is not an implicit lifecycle policy: the
compiler and runtime must define a typed, capability-checked decision operation.
Missing action, exceptions during policy, and ambiguous decision-sink effects
must have explicit fail-closed outcomes.

Only relax source-admission rejection after compiler-owned hook registration,
typed Failure binding, effect/capability validation, execution-context-scoped
defer/recover, and generation-fenced continuation delivery are complete.
No backend may mark guest execution supported while its counterpart only
parses or rejects the source declaration.

## Supervisor CONTROL lifecycle audit: completion epochs and terminal cleanup

Focused exact-source Java/native runner:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38175822305

Additional native reentrant-close admission proof:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38175919543

Added shared invariants, independent of whether source guest lowering exists:

1. Every logical supervisor policy invocation must have a **unique
   monotonically increasing continuation generation**, independent of whether
   two queued immutable notices point to the *same object*. A late or duplicated
   CompletionStage notification can never consume a subsequent turn.
2. All terminal policy, dispatch, or lifecycle-sink failures must account for
   their undelivered notices, clear owned queue contents, and release the
   logical callback lease. Retaining metadata in an unusable failed mailbox
   is not acceptable.
3. A reentrant `close()` requested inside a previously admitted lifecycle
   decision must reject subsequent notices immediately. The current
   authorized decision can still commit exactly once, but `healthy()` must
   not report an in-progress shutdown as healthy.
4. A shutdown invalidates suspended guest/control continuation generations;
   no late completion can issue STOP, RESTART or ESCALATE after close.
5. An exception from a host lifecycle sink after possible effects is an
   **ambiguous effect**, never a verified commit. Do not retry it blindly.

Java tests include a deliberately nonconforming completion stage that invokes
its completion callback twice with two queued turns sharing an identical notice
instance. Native tests cover terminal policy exception cleanup, close during
logical suspension, and admission after reentrant self-close.

**Scope:** These are host CONTROL/runtime proofs with exact source hashes,
not full compiler conformance. No change to the existing source guest
`on_panic` execution gate or its `unimplemented` status is authorized by
these tests. Full Java JDK25 Maven and native LLVM CMake/CTest, AOT/hybrid,
generation-fenced guest CONTROL lowering, resource finalization and
independent review remain mandatory.
