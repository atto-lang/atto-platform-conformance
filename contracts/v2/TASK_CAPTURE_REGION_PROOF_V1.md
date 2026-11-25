# TASK_CAPTURE_REGION_PROOF_V1 — compiler/runtime ownership gate

**Status: candidate, NOT ATTESTED.** This chapter is not a declaration that any backend has general non-lexical lifetime / region loan checking. Source fixture locators and expected behavior are recorded in `contracts/v2/task-capture-region-proof-v1.json`; the source files remain in the private Java source repository, not copied into this contract repository.

## Core decision

The protected **place/resource** has the read/write synchronization identity. A **logical Task / continuation** holds a compiler-proven loan token. An OS thread is a transient carrier and must never authorize a borrow, unlock, or actor-state access. Each actor's heap, stack/mailbox and incarnation remain separate from its parent Task or spawning actor, and actor-local access is still governed by sealed `handle_state` semantics.

Task submission, not the eventual `await`, consumes each affine MOVE. `rt copy` and `rt share` cannot convert a borrowed view or a guard into an independently transferable capability. Ordinary Task capture of actor `self`, actor-state loan, mutable region loan, MutexGuard, foreign pointer or thread-local reference is rejected. A verified ActorRef is only an explicitly limited communication capability, never an actor object/heap pointer.

## Readonly view vs owned snapshot

A readonly record type can describe a view into writable storage; a record's Send-safe field types alone do not prove that storage is frozen, uniquely owned or independently allocated. **Fail closed** for independent Task capture of unproven readonly record views. This is intentionally a conservative front-end stopgap: an actually independent immutable owned snapshot must remain expressible once the compiler emits a verified snapshot provenance witness (and transitive Send/Sync requirements are satisfied). An owned inline struct with Send fields and a valid affine move remains allowed.

The snapshot witness must be constructed by the compiler from proven allocation/alias facts, not provided by guest annotations, user-provided IDs, reflection, serialization, nominal wrapper tricks, optimizer-cloned AST metadata or a host-side model.

## Required staged compiler proof (HIR → typed MIR)

1. **Type/traits:** resolve fully substituted field graphs; reject unknown recursion, borrowed members, guard wrappers, raw pointers and unresolved nominal aliases. Compute Send separately from Sync and from actor/tenant transport permissions.
2. **Place and region:** assign symbolic owner root, projection/range, allocation origin, aliasing mode and lifetime region. Distinguish inline owned aggregates from readonly views and from independently frozen snapshot allocations.
3. **Control flow:** forward dataflow through branches, loops, pattern match, try/catch/finally, defer/recover and select. A MOVE cannot be used by any reachable successor; shared READ loans exclude WRITE; WRITE excludes other READ/WRITE; reborrows freeze conflicting parent access.
4. **Spawn admission:** compute exact lexical captures and transitive closures at submission. COPY values snapshot immediately; each MOVE transfers once; ordinary scoped loans, actor self and guards cannot escape. A scoped immutable READ exception needs a separately authenticated structured TaskScope and physically joined descendants.
5. **Suspension:** no ordinary critical section may await, block on select/channel operations, call a suspending function, or yield via `rt cooperate`/scheduler safepoint while its guard is live. Untrusted hard-fuel/accounting checks may still execute without yielding; a compiler-inserted cooperative yield must move outside the guard.
6. **Codegen boundary:** no lowering to interpreter executable guest, native LLVM IR, CIL, Wasm or Forge output unless the exact checked AST / source identity and loan effects survive all transformations. A rejected semantic program emits no executable IR/object.
7. **Runtime witness:** check tenant domain, actor incarnation, allocation identity+generation, logical task identity+generation, authenticated loan ID, read/write mode, bounded queue and retirement state. Recheck on resume and on release. Never authorize by OS thread ID.
8. **Cleanup:** release guards on return/throw/raise/panic/cancellation with exactly-once semantics. Failed Task submission restores parent ownership. A requested cancellation or Future completion alone is not physical quiescence; defer reclamation until actual child retirement and GPU completion fence where applicable.

## This wave: exact source fixtures

Java stacked PR #2686 is based on Java draft #2680. It contains these new candidate `.atto` files:

- `readonly-record-task-reject`: parser MUST accept; ownership compiler MUST reject the non-Send capture of `view`. A parser error, unsupported syntax, timeout, zero-step job or source-free oracle is **not** an expected semantic rejection.
- `owned-struct-task-accept`: compiler MUST accept and publish exact whole-program checked Task capture admission; it is *not* a certified Graal native AOT guest run.
- `scalar-copy-task-guest`: compiler MUST accept and an actual Graal guest evaluation MUST output `42`.

The JSON registry pins their source commit and Git blob SHA-1; downstream backends must use byte-identical sources or explicitly record a separate independently reviewed compatible fixture with its own SHA. This contract deliberately does not contain private source text or a source mirror.

## Release evidence: fail closed

- For each Java source test, pin exact source commit, fixture Git blob, compiler binary/class artifact, execution log, nonzero workflow step count and negative diagnostic / positive stdout.
- For LLVM, Wasm, .NET NativeAOT and Forge, run the same actual compiler-owned `.atto` semantic checks, or record `UNSUPPORTED/NOT_EXECUTED`. No false-positive parser rejection, host-only C++/Java/Node model or synthetic CI status may become a conformance pass.
- For real actor/Task critical regions add physical tests of concurrent reads, exclusive write, migration across carrier threads, child spawn, failed spawn rollback, cancellation/retirement, stale generation, task/actor nesting, exactly-once release, and no actor-private raw pointer transport.
- Keep independent review, exact-head nonzero-step executed tests, and applicable private CI runner/branch security gates. Do not merge source drafts based on the reference registry alone.

## Integration order

Java PR #2680 conservative trait check → stacked Java PR #2686 source fixtures/JUnit/CLI gate → this conformance registry → shared HIR/MIR proof representation → isolated LLVM/Wasm/.NET/Forge ports and executable guest receipts. Coordinate through platform-conformance issue #615; do not edit another agent's PR branches.
