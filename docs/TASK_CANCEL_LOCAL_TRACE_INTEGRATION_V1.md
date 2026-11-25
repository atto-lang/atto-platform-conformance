# AttoLang Task cancellation, context-local and causal tracing integration gate (v1)

**Status: target contract only; guest execution NOT_EXECUTED.** The source-free reference model and its Node test suite are intentionally non-promoting. This is a cross-cutting integration gate, not a replacement for existing backend implementations or a proof that the proposed guest API already parses.

## Audit findings and hardening target

Existing work is fragmented across Java TaskScope/TaskOwnedLeases/SourceTaskHandles, continuation/callback tracing, LLVM local-context host prototypes, and platform conformance scoped-local models. The remaining unproven security boundary is **their interaction** when a Task suspends, migrates, cancels with a live lock, unwinds defers, and physically joins descendants.

The authoritative continuation descriptor must include runtime/tenant/isolate, authenticated TaskId and generation, parent TaskScope, TaskLocal storage handle, actor incarnation (when admitted), immutable trace/span ancestry, cancellation epoch, cleanup state, and owned logical-lease registry. Only the scheduler may bind or rebind these handles to a carrier. ThreadLocal is physical scratch and never ambient authority.

## Normative behavior

1. **Composable:** sequential/waterfall, parallel, race/first, queue and DAG adapters must distinguish *borrowed Future observation* from *owned Task cancellation rights*. A user-supplied ordinary Future may not be cancelled merely because a consumer scope exits. Do not implicitly flatten nested Future/Option.
2. **Cancellable:** scope exit seals admission, requests cancellation of owned descendants, unwinds compiler-owned lexical scopes exactly once, and awaits physical retirement without blocking an actor carrier. Cancellation is not catchable as a normal guest exception and does not demote PANIC. A timeout cannot fabricate success.
3. **Lock cleanup:** thread-affine/native locks must be released by their owning execution at a safe unwind point; holding one across an unproven await is a compile error. Only verified task-owned transferable logical leases can retire from a runtime notifier. Never remotely unlock a Java monitor, ReentrantLock or OS mutex while its owner still executes.
4. **Local storage:** TaskLocal survives await/cooperate/migration and defaults to *no child inheritance*, except explicit immutable Send snapshots. ActorLocal survives turns within the same generation and remains critical-gated. ThreadLocal follows OS thread only. RequestLocal stays request-bound. No ambient local value or trace context is a capability.
5. **Tracing:** capture immutable, bounded W3C-compatible trace/span metadata across task spawn/await/resume/cleanup, actor message, callback, join and supervisor escalation. Preserve selected causal branch at fan-out; no fake stack frames or invented sibling total order. Propagate only safe sanitized fields across actor/network boundaries; never send local storage handles, principals, or response-writer capabilities.

## Smallest compiler-backed integration test

Implement an identical `.atto` guest case across Java/Graal, LLVM, .NET NativeAOT, Forge/Cranelift and Wasm: parent Task binds TaskLocal trace label, owns a logical async lock, spawns two children (one explicitly receives an immutable snapshot), suspends then resumes on a different carrier, and is cancelled while one child holds a grant. Assert no early unlock; no child TaskLocal/actor-state leakage; LIFO, exactly-once cleanup after child retirement; `get_done` only after physical quiescence; coherent same-trace parent/child span IDs across await; and ThreadLocal not transferred. Add negative compilation for a thread-affine lock crossing await and a mutable TaskLocal/ActorLocal borrow escaping to child.

Before claiming positive parity, verify the API is actually compilable, source-mapped and executed as guest code on each backend. Each failure/cancellation/await race also requires the negative cases from `contracts/task-cancel-local-trace-v1.json`. Native platforms need sanitizer and forced migration/cancellation stress; browser Wasm requires real Worker execution, not Wasmtime-only evidence.

## Related work / avoid overlap

- Java #2698 (quota rollback), #2699 (Future.first owned-candidate snapshot), #2711 (carrier ThreadLocal poisoning), #2321 (callback trace provenance).
- LLVM #1389 (native local-context host slice), platform-conformance #564/#568 (local storage receipts) and #617 (borrow-critical model).
- Java docs `TASK_CANCEL_DEFER_RECOVER_LOCKS_V1.md`, `TASK_MUTEX_AUTO_RELEASE_INTEGRATION_V1.md`, `SOURCE_TASK_CANCEL_UNWIND_V1.md`, and platform docs `LOGICAL_CONTEXT_LOCAL_STORAGE_V1.md`.

This new source-free model verifies only internal reference invariants. It must not be mistaken for implemented compiler semantics, a JDK25/JUnit run, guest execution, CI parity, verified cleanup, or an actor isolation proof.

## Evidence requirements

Every positive case requires independently verifiable exact PR head SHA, root tree SHA, guest source blob, compiler executable digest, run attempt and real nonzero executed steps, guest test ID, native/AOT invocation, result, physical cleanup witness, and typed diagnostic for negatives. `steps=[]`, `steps=null`, `runner_id=0`, source-free model tests and host-only canaries are **not execution evidence**. Private source must remain in authorized repositories; never bypass the source-publishing policy by mirroring to an unapproved carrier.
