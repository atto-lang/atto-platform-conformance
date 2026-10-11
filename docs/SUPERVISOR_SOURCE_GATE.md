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


## Terminal CONTROL notification lane contract (audit extension)

In addition to `SupervisorProcess` lifecycle decisions, the separate
`SupervisorFailureControl` notification queue is a bounded owner of immutable
failure envelopes. A terminal notification-handler exception or dispatcher
rejection must:

- account for **all** queued notices as undelivered exactly once, including
  the notice whose handler threw;
- release references to those queued payloads immediately rather than retain
  permanently undeliverable metadata;
- never replay the throwing handler or execute CONTROL inline inside the
  publishing actor's stack or admission lock; and
- deny later deliveries while incrementing their explicit loss counters.

The Java and native source PRs contain corresponding handler-exception and
synchronous/inline-adapter regression tests. Those tests were **added after**
the previously linked funded host verification runs and must be executed
again against their exact new source Git blob hashes before marking this
extension verified.

An overflowed queue currently records undelivered notices, but does not by
itself stop the entire actor family. Higher-level escalation, restart and
root-failure policies for lost CONTROL traffic remain **release blockers**,
as do full guest-defined `on_panic` execution and Java/LLVM parity.


### Native bridge replay bookkeeping

A terminal native child failure is a one-shot registration: after physical
finalization and admission, consume the registered `(actor_slot, generation)`
key, so replay is rejected **without** retaining an ever-growing set of
completed generations. This retirement must occur even when downstream
supervisor-process admission fails, because blindly replaying a terminal
failure could duplicate lifecycle effects. The integration fixture asserts
that the registered-child count returns to zero after delivery.

**Remaining cleanup gap:** children that terminate normally without a panic
notification still need a trusted retirement path from the owning actor
lifecycle. Do not infer that terminal-panic cleanup covers all actor exits.


## Cross-backend replay and payload hardening (2026-10-11)

**Final focused private run:** https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38176690334

All three allocated jobs passed at an exact private-mirror commit with individual
source Git blob verification:

- Java: typed host CONTROL and process commit/close, UTF-8 boundary tests, and
  deliberate duplicated executor callbacks crossing a 32-notice batch.
- Native: C++20 supervisor process and CONTROL lane replay tests under
  ASan/UBSan, including duplicated `begin`, stale `resume`, and invalid
  `Directive` values forged through native enum casts.
- Native bridge: actual C11 multiworker actor scheduler and C++ typed panic
  CONTROL bridge under ASan/UBSan, proving finalization, single-flight
  suspension, authoritative STOP, reentrant self-close and terminal cleanup.

Additional normative host invariants:

1. The async completion **execution** must check the saved supervisor turn
   epoch, not just the initial `resume()` admission. A duplicated or delayed
   queue callback may never commit against a subsequent notice.
2. Scheduler enqueue adapters are treated as replayable for safety testing;
   duplicate `begin` and CONTROL drain callbacks cannot invoke policy again,
   including after a new batch starts.
3. Native directives are a closed set: STOP, RESTART, ESCALATE, ACKNOWLEDGE.
   Unknown numeric values must fail closed before any lifecycle sink call.
4. Value-only failure diagnostics have a maximum of **1,024 UTF-8 bytes**.
   Truncate at a complete Unicode scalar and replace malformed input with
   `?`; Java must not use its UTF-16 character count as this limit.
5. When the native CONTROL queue is retired during an in-flight handler, the
   returning handler must never attempt to pop the now-empty queue.

**Evidence boundary:** these are focused host runtime and native bridge tests.
They are not full Maven/JDK25, complete LLVM CMake/CTest, Graal AOT/hybrid,
source-compiled guest `on_panic` tests, or proof of source feature parity.
The fail-closed source admission fixture matrix remains unchanged.


## Implicit CONTROL turn versus guest locking (design clarification)

`define supervisor` creates a runtime-owned, single-flight logical CONTROL
lane. Its lifecycle hook does not need an explicit `using` clause or a
guest-visible mutex. An exclusive logical turn may await: the physical
carrier is released while the runtime retains the turn's continuation,
generation and exclusive ownership until it resolves or is cancelled.

Do not interpret `supervisor.control` as a capability granted by spelling
a resource name in source, and do not invent a `self.control` lock field.
Source lifecycle effects must instead be validated by the compiler against
the supervisor's declared role and checked again against the runtime-owned
execution context. Ordinary actors and arbitrary method calls cannot forge
those capabilities. A future explicit lock syntax, if designed, must have
real scoped lock semantics and may not silently alias this CONTROL lane.

Current cross-backend opt-in slice: synchronous
`on_panic(f: Failure): void { self.stop(); return; }`, with an implicit
CONTROL lease. It is a restricted compiler-produced STOP decision plan,
not general guest statement execution. `self.stop()` here means requesting
the trusted host's STOP handling for the failure being processed; it must
not mean stopping an arbitrary actor or unconditionally destroying the
supervisor itself. The host sink remains responsible for actual effects.

The intended richer form can use explicit lifecycle methods such as
`self.restart(f.child)` and `self.escalate(f)` once typed Failure identities,
policy checks and async lowering exist. Neither plain `return;` nor normal
fallthrough may implicitly acknowledge a failure. Decisions require
exactly-once generation-fenced commit semantics and must report ambiguous
host effects as unknown rather than replay them.

**Verification boundary:** the `stop-only-implicit-control.ores` fixture
represents only the opt-in STOP subset. Normal Java/LLVM compilation of
supervisor sources remains fail-closed. This design text does not assert
full STOP, RESTART or ESCALATE execution parity or verified CI for the
current head.


## Final focused audit: completed-turn replay and suspend/commit synchronization

Private exact-Git-blob verification:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38177170932

All three jobs passed: Java host CONTROL, native C++20 replay/invalid-directive
ASan/UBSan, and C11 actor scheduler → native typed panic bridge integration
ASan/UBSan.

Two further failure modes were found during adversarial verification:

- **Java completed-turn replay:** when a duplicated final completion arrived
  after all notices had resolved, it previously poisoned an otherwise healthy
  supervisor because there was no following generation yet. The stale
  completion is now a no-op; an actually mismatched *active* lease still fails
  closed. A deterministic JUnit regression verifies this with identical notice
  objects and a replaying executor.
- **Native await readiness:** entering `on_failure` is not sufficient proof
  that an `await` has relinquished the physical CONTROL carrier. A new
  mutex-protected `suspended()` status allows host integration tests to
  establish that boundary before `resume()`; early resumes remain rejected.

This evidence verifies the mirrored runtime/bridge Git blobs, **not** all files
of either compiler tree. Do not promote any source-level guest-supervision
capability or merge full stacks on the basis of this focused gate. Full
JDK25 Maven, LLVM compiler CMake/CTest, Graal AOT/hybrid and independent
review are still required.


## Supervisor lifecycle contract hardening: next vertical slice

The trusted host decision request now carries a monotonic CONTROL
`turnGeneration` (native `turn_generation`), scoped to the supervising
process identity. A lifecycle effect's prospective idempotency key is
`(supervisorId, runtimeOrGroupId, turnGeneration)`, not the identity of the
immutable failure payload, which can be reused in different turns.

**This is a request identity, not a durable commit receipt.** The host still
needs generation-checked authoritative STOP/RESTART/ESCALATE operations and
explicit ambiguous-effect reconciliation. A sink that applies an effect and
throws must never be reported as committed merely because it ran once.

The opt-in Java STOP-only source lowering generates a restricted
`self.stop(); return;` policy on an ActorGroup-owned CONTROL lane; a
separate LLVM opt-in parser accepts the corresponding source subset.
Normal compiler admission remains fail-closed in both implementations.
Both backends still require a full authoritative guest lifecycle harness
and explicit effect/capability checks before broad source-level execution.

Native bridge registrations are now consumed for terminal failures and
can also be explicitly retired after **normal physical finalization** using
`retire_normally_finalized_child(child)` with an exact generation token.
The owning runtime must establish that no terminal CONTROL event is pending
before invoking that method. Wiring it into every clean actor exit remains
a separate integration requirement; exposing the API alone is insufficient.

Focused funded audit evidence:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38177170932
(exact runtime/bridge blob hashes, Java JDK 17 host audit, native C++20
ASan/UBSan). That run does not prove full JVM/JDK25 Maven, complete LLVM
CMake/CTest, native-image, or arbitrary guest `on_panic` execution.


## STOP-only source lowering: focused Java/native compiler proof

Private exact-blob verification:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38177256674

**Java (JDK 25): passed.** Exact Oreslang lexer, parser, AST, restricted
`SourceSupervisorLowering` and host supervisor CONTROL runtime sources were
mirrored privately with their original Git blob SHA verified before compile.
The checked source `on_panic(f: Failure): void { self.stop(); return; }`
lowered to a STOP decision and committed once on a distinct CONTROL carrier.
Unsupported guest statements and CANCELLED notices failed closed.

**LLVM/native (C++20 ASan/UBSan): passed.** Exact native parser,
ownership-checker and supervisor runtime sources compiled the same restricted
STOP-only source form into an immutable policy bound to the existing host
CONTROL process. This native run checked type/signature rejection, unsafe
statements, source admission gating, STOP commitment, and rejection of
cancellation.

**Not yet verified:** real Oreslang guest evaluator executing arbitrary
`on_panic` bodies, an automatic trusted actor STOP implementation, full
Maven/Truffle or LLVM build, GraalVM native image, and identical-source
end-to-end child physical-finalization ordering with a production runtime
for both backends. The production compiler entry points still reject
general `define supervisor`; no `await`/RESTART/ESCALATE parity is claimed.

Do not treat the host decision sink as an Oreslang method or as proof of
general execution-context, defer/recover, or lifecycle-policy lowering.


## Restricted typed Failure binding: STOP-only extension

The opt-in STOP source compilers now distinguish two explicit source forms:

- `self.stop(); return;`: historical current-failure STOP request.
- `self.stop(problem); return;`: the named `problem` must be exactly the
  `on_panic(problem: Failure)` parameter, checked against the source AST
  (Java) or restricted source grammar (LLVM). Both lower to a host STOP
  **request for the current delivered failure**.

These forms do not create an actor handle, evaluate arbitrary expressions,
or make `problem.child`, `problem.actor`, arbitrary actor IDs, nested
property access, async `await`, RESTART, or ESCALATE executable. Those
must remain rejected until stable logical-child identity and typed
lifecycle-operation lowering are implemented.

Java's restricted host CONTROL integration checks the delivered notice's
supervisor/group and TERMINAL_FAILURE kind; the new source test asserts
the STOP decision retains the failed ActorId from that notice. Native
source parsing also records whether the typed binder was explicitly used.
That form requires a real native typed PANIC envelope with a nonzero
actor ID and generation; a legacy zero-kind host notice cannot impersonate
the typed source `Failure`. The no-argument legacy compatibility path
remains separate.

Both implementations still rely on the trusted host decision sink to
apply lifecycle effects. `resolved` counts a successfully returned sink,
not a durable restart/stop commit receipt. The current opt-in compiler
slice is intentionally **synchronous**; `async on_panic` remains rejected.
Full guest hook evaluation, generation-checked authoritative lifecycle
operations, durable commit receipts, `await` suspension, and source parity
remain separate release gates.


## Native terminal-disposition race hardening

The native scheduler owns the authoritative terminal classification for
each `(scheduler_domain, actor_slot, generation)`. It now serializes
`publish_failure` with `seal_normal_exit` under the scheduler mutex:

- A successful terminal publication claims the failure once. Retries of
  the same generation cannot enqueue a second parent CONTROL event.
- A well-formed terminal publication attempt also forbids normal sealing
  if delivery was rejected because the parent retired or CONTROL saturated.
  The host must retry or escalate; it may not quietly relabel a failed child.
- A clean-exit seal succeeds only after physical finalization and only
  when no terminal publication has been attempted or published. The seal
  prevents any subsequent terminal publication for that generation.
- The supervisor bridge consumes its child registration only **after** the
  scheduler confirms the clean-exit seal. It must never rely solely on
  an earlier non-atomic `poll_done` observation.

These rules secure the host-level scheduler and native bridge. They do not
prove that a higher-level runtime has classified all exits correctly or
installed a policy for rejected CONTROL notifications. A normal-exit
lifecycle owner must still invoke the seal/retirement path for every
successfully terminated registered child. Parent CONTROL saturation must
have an authoritative fail-closed escalation path before release.

Funded exact-blob C11/C++20 bridge ASan/UBSan and focused audit workflow:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38177949783

Do not infer full LLVM CMake/CTest, Java Maven/JDK25, source guest hook
execution, durable restart semantics, or AOT parity from this focused run.


## STOP-only hardening audit: finalization barrier and typed native admission

Additional release constraints arising from the restricted STOP source slice:

- **Java**: a failed actor's immutable supervisor Notice is captured during
  unregister/retirement but published only when its runtime finalization
  Future has settled successfully. This barrier follows the done Future and
  actor cleanup. A malformed/failed finalization barrier must record
  undelivered CONTROL without invoking guest lifecycle policy.
- **Java CONTROL drain**: a fatal barrier event can retire the pending queue
  concurrently with a host callback already running. The returning callback
  must observe terminal state and must neither pop an empty queue nor claim
  additional successful delivery.
- **LLVM**: all source-defined `on_panic(f: Failure)` hooks, including the
  `self.stop()` spelling, require a typed terminal PANIC envelope with
  nonzero actor identity and generation. Untyped zero-kind legacy host notices
  are not guest-language `Failure` values. Cancellation never implies STOP.
- **Both**: an explicit lifecycle request is not the same as verified host
  lifecycle effect. A host decision sink that returns normally is considered
  an acknowledgement by contract, not proof that a specific actor was stopped.
  Future runtime integration needs an authoritative, idempotent lifecycle
  manager keyed by supervisor identity, actor incarnation and turn generation.

These are narrowly scoped hardening commits; the normal compiler still
rejects general guest supervisor execution. Full Maven/JDK25/GraalVM/LLVM
integration and production-level real-child finalization proofs remain
separate release gates.
