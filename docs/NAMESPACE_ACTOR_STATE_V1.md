# Sealed namespace-actor state v1 (draft)

## Goal

`define state on actor Foo` is an **out-of-line declaration of the same sealed actor-owned state schema** already modeled by the inline `state { ... }` feature. It is NOT a separate state-container, global singleton, public field, or independent actor instance.

## Candidate syntax

```atto
namespace foo;

pub define actor Foo implements ActorXYZ;

define state on actor Foo as {
    let int x : 5;
    let int revision : 0;
}

mtd (Foo f) init(): void {
    f.handle_state(critical-write |s| -> { s.x = 5; });
}

pub mtd (Foo f) bar(): void {
    f.handle_state(critical-write |s| -> {
        s.x += 1;
        s.revision += 1;
    });
}
```

The syntax is **proposed** and is NOT claimed compiler-executable. Inline `state { x: int = 5; }` must lower to the same internal schema. If both syntax forms appear for one nominal actor, reject rather than merge. Select the canonical formatter spelling after parser compatibility review.

## Compiler/linker invariants

1. Collect source units from a verified package manifest into a closed source set. Resolve each actor, state schema, receiver method, and actor-targeted nominal contract by `(package identity, namespace, actor name)` independently of file order. Reject ambient-path witnesses and unverifiable caller maps.
2. Exactly one actor identity and at most one state schema per actor in that source set. A free-standing state schema cannot manufacture an actor; wrong-namespace, duplicate, inaccessible, or imported foreign targets are errors. All fields are private, typed, unique and sealed.
3. Initial v1 state defaults are pure, deterministic typed constants; no I/O, await, state-dependent expressions, borrowed/shared references or effects. Keep complex state graphs fail-closed until deep ownership and initializer proofs exist.
4. Receiver-first external `mtd` is compiler-bound, never a raw actor pointer. A method named `init` is a one-shot private runtime lifecycle hook, returns `void`, and is not a public mailbox method. In particular `init(): f` must not return a raw receiver. Reserve `handle_state` and CONTROL/lifecycle slots from ordinary external declaration.
5. Verify actor-only `implements` signatures **exactly**, including name, arity, argument types/mutability, return type, visibility, suspension/effects, and inherited-slot coherence. Actor contracts may not export fields, state loans or supervisor CONTROL capabilities. Public methods require a public actor.
6. Only an authenticated same-turn actor receiver may invoke the compiler-sealed `handle_state(critical-read|critical-write |s| -> ...)` intrinsic. The mode is a closed AST enum, not a forgeable string. Direct `f.x`, `f.state.x`, reflective/destructured field access, state alias capture, copying mutable references, and state-view escape are errors.
7. `critical-read` grants a lexical immutable borrow; `critical-write` grants an exclusive lexical mutable borrow. Critical callbacks must be synchronous, void, nonescaping; no `await`, select, channel send, I/O, actor spawn, arbitrary callback effects, or borrow escalation. Scalar detached projections may be copied to an owned local. Runtime must independently enforce revoked-view and immutable-read checks.
8. Runtime permits bind actor ID, activation generation, execution identity, physical turn and actor memory region. STOP, crash, restart and hot-load deny new loans, physically drain existing loans, revoke old views and fence stale generations. Concurrent readers are allowed only when the runtime really admits them; a currently serialized guest must not claim reader parallelism.
9. External invocation via `ActorRef<Foo>` is mailbox-dispatched with admission checks. Same-receiver internal calls stay in the current non-reentrant turn. No method or state declaration creates ActorRef, ActorContext or supervisor authority by itself.

## Source-free reference and real acceptance

`test/namespace-actor-state-v1.test.mjs` is a **source-free host model** covering linker metadata and simple scalar state loans. Its caller-supplied `manifestVerified` flag is NOT proof of manifest verification; its generated incarnation counter is NOT a trusted runtime capability; its Proxy is NOT the production borrow checker, scheduler or memory isolation.

The companion `contracts/namespace-actor-state-v1.json` records 24 cases with every Java, LLVM, .NET, Wasm and Forge guest status set to `NOT_EXECUTED`.

Before changing those statuses, integrate with Java drafts [#2887](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2887), [#2823](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2823), [#2792](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2792), [#2813](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2813), and sealed-state [#2796](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2796). Add real positive and negative .atto compiler/guest fixtures, execute exact-head tests and Native Image/LLVM/.NET/Wasm/Forge paths, and require independent review. No private compiler blobs are transferred by this draft.
