# Actor `external` lifecycle entrypoints — proposed contract v1

**Status:** normative design candidate and compiler-fixture backlog; **not** evidence of an implemented language feature, executed guest, or five-backend parity.

## Intent

AttoLang's `external` is an **ingress-role marker**, not Solidity-style unrestricted ABI/public access. `external init` enters only through runtime-controlled actor creation; `external receive` enters only through a checked mailbox turn. Neither is a guest-callable actor method. Public export (`pub`) and runtime ingress (`external`) are independent concepts.

Canonical out-of-line, receiver-first proposal (the syntax intentionally follows the draft Java receiver binding stack):

```atto
namespace demo;
declare actor Worker;

define external mtd (Worker w) init(): void {
  return;
}

define external mtd (Worker w) receive(ActorMail<int> mail): void {
  // Delivered by the runtime; never invoked directly by another guest.
  return;
}

pub mtd (Worker w) describe(): int { return 7; }
```

### Declaration versus definition

- **Canonical out-of-line nominal actor:** `declare actor Worker;` (or `declare pub actor Worker;` when an exported nominal type is required). No receiver alias, actor instance, empty class, state storage or runnable dispatch table is synthesized by this declaration.
- **Inline implementation:** `define actor Worker as ... end` remains the actor-body form; a full inline definition is not equivalent to a declaration.
- **Migration compatibility:** existing `define actor Worker as worker;` is parsed by the Java draft, but is not the canonical spelling for a declaration.
- **Future contracts:** `declare actor Worker implements WorkerApi;` requires retaining the nominal contract list in the standalone actor AST and proving link-time conformance. The initial Java parser deliberately rejects this extension rather than silently discarding it.
- Inline actor-body methods may eventually use `external init(...)` and `external receive(...)` with the same verified role metadata. Those spellings are not yet implemented by the current static Java draft.

The new Java compiler draft admits `declare actor` only as nominal/static metadata and continues to fail closed before executable lowering. The Java `main` frontend does not accept this exact code; cross-backend compiler/runtime parity remains unproven.

## Normative semantic rules

1. `external` is contextual in **actor-method declarations** and is retained in AST, typed HIR/MIR, metadata and conformance receipts as an explicit entry role. A tokenizer accepting the word alone, or dropping the modifier during lowering, does not implement the feature.
2. `init` is an optional, nonstatic, non-generic, actor-owned initialization hook. For every actor **incarnation** the runtime may invoke exactly one chosen `init` (or one compatible legacy `on_start`, never both) at most once, before READY and before any guest receive. A restart is a new incarnation with a fresh generation. `init` can accept spawn arguments only through a typed, bounded, detached bootstrap transfer. The source-level state builder, return shape and initializer effects must obey the existing staged compiler contract; a raw `Actor`/`self` return is forbidden because actor ownership cannot escape.
3. `receive` is the mailbox-owned, nonstatic, non-generic handler. The initial canonical ABI is exactly one `ActorMail<T>` argument and `void` result; any future typed reply/stream role needs a separately versioned ABI. Delivery passes through typed sendability, tenant/capability admission, mailbox capacity, epoch fencing and scheduler turn isolation.
4. Lifecycle entrypoints are **private to guest callers** even when marked `external`: `pub external init`, `pub external receive`, direct `actor.init`, `actor.receive`, `self.receive`, unqualified receive calls, bound-method capture, reflection and foreign trampoline calls are rejected. This follows the existing private-mailbox contract stack. Do not reinterpret `pub external` as authority to bypass mailbox send.
5. The only enabled external roles in v1 are `INIT` and `RECEIVE`. An ordinary `pub mtd` may satisfy a public actor interface, but does not become an externally callable RPC. Any future `external mtd deposit`/`withdraw` must explicitly lower to a typed, capability-checked message protocol; no direct user-method ABI is invented here.
6. Exactly one effective `init` and at most one active `receive` signature per concrete mailbox role are admitted after cross-file/link-time resolution. Duplicate inline/out-of-line slots, overloaded lifecycle hooks, ambiguous namespace ownership, class impostors and conflicting inherited roles fail closed.
7. No `external` lifecycle entrypoint may issue an unmanaged actor-context, state loan, supervisor CONTROL authority or raw cross-actor pointer to its caller. Startup state publication must be atomic; failure emits a supervisor lifecycle notification, does not publish READY, and frees staged resources.
8. `external receive` may not be reentered by direct calls, callbacks or reentrant host bridges. A suspended message resumes only through the runtime's generation-scoped continuation authority; shutdown and cancellation cannot start a new turn from a sealed inbox.
9. Static-AOT backends record entrypoints in an internal dispatch table with role, nominal actor, package namespace, type signature and generation policy; the source marker must not silently create ELF/CIL/Wasm public exports or a reflection-based RPC surface.
10. Compatibility: legacy `on_start`, `receive` and LLVM `on_message` remain versioned adapters while migration tests are developed. **Strict v1 mode** requires explicit `external` on declared `init`/`receive`. An actor without custom initialization may omit `init`; an actor that cannot receive messages may omit `receive` if its role/transport supports it. Never invoke both legacy and canonical startup handlers.

## Hardening boundary for canonical declarations

The canonical `declare actor A;` syntax is nominal-only. It does not allocate an empty executable actor, introduce an unresolved `declare type` forward, or authorize implementation by unrelated namespaces.

For a canonical declared actor, any out-of-line method named `init` or `receive` **must** carry the contextual `external` marker. Ordinary `define mtd` declarations remain static method metadata and cannot occupy the runtime lifecycle role. The older `define actor A as receiver;` receiver-alias spelling and inline actor classes retain legacy migration rules until their own adapters are reviewed. No direct caller access is granted to `external` hooks.

Until there is a typed, compiler-issued, ownership-checked state builder, `external init` must return `void`. A user-supplied type named `state` is not authority to construct a sealed state container. The Java draft now statically rejects `init(): state` with `ACTOR_INIT_STATE_BUILDER_UNVERIFIED`. This is a temporary fail-closed condition, **not** an assertion that actor state construction has shipped.

Malformed `declare async/shared/static actor`, duplicate visibility modifiers, actor/inline-class name collisions, cross-namespace receiver impersonation, duplicate lifecycle slots, source IDs with Windows colons, and bidirectional/zero-width Unicode format controls must all fail static admission. A declaration with `implements`, `extends`, generic parameters, receiver aliases or an inline body remains rejected pending separately versioned semantic support; silently ignoring contract requirements is forbidden.

Conformance evidence for this version includes 3 positive and 9 negative target fixtures. A successful *source-free inventory* check establishes only manifest and fixture integrity, never guest execution, runtime lifecycle behavior or five-backend parity.

## Lifecycle model

`ALLOCATED -> INITIALIZING -> READY -> TURN_RUNNING -> READY -> STOPPING -> TERMINATED` with failure edges `INITIALIZING -> FAILED` and `TURN_RUNNING -> FAILED`. Restart creates a **new** incarnation, not an illegal transition from TERMINATED back to READY. A provisional host-side ActorRef (currently staged in Java) must remain unable to deliver messages before initialization and must be separately audited for early-publication safety.

Safety invariants: (a) `receive_count_before_ready = 0`; (b) `init_count_per_incarnation <= 1`; (c) actor-state readers see either the fully installed state or no state, never partial staging; (d) stale-generation dispatch is rejected; (e) no externally visible method pointer can invoke `init` or `receive`; (f) cancel/stop cannot resurrect a mailbox lane. Progress: READY is published only following successful initialization; terminal init failure must notify the supervisor without indefinite wait.

## Existing integration paths — do not fork them

- Java/Graal [#2256](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2256): one-shot `init` + staged publication and scalar named-spawn bridge (draft; execution evidence not established).
- Java/Graal [#2822](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2822): reject direct/captured `receive` calls (draft).
- Java/Graal [#2789](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2789) -> [#2819](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2819) -> [#2823](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2823): typed out-of-line `mtd` AST, nominal binding, receiver-first cross-file indexing (draft/static-only).
- Java/Graal [#2786](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2786) and [#2792](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2792): private mailbox signatures and actor contract visibility rules (draft).
- LLVM `main` still compiles only its fixed `pub on_message(int): int` scalar actor subset. `.net`, `.wasm` and `.forge` require independent compiler/source-actor checks; host runtime behavior is not proof of frontend parity.

## Required backend acceptance

For **each** of Java/GraalVM AOT, LLVM native AOT, .NET NativeAOT, Wasm and Forge: parse and retain external metadata; typecheck positive and negative fixtures in `contracts/actor-external-entrypoints-v1.json`; prove actual emitted actor startup and mailbox guest execution; reject direct/fake ingress and stale generations; verify init failure supervision and stop/restart; provide exact SHA + executed job steps + test artifacts. `AUTHORED`, `PARSED`, `STATIC_BOUND` or `SOURCE_FREE_MODEL` evidence is not `GUEST_EXECUTED`.

Do not enable strict v1 or merge implementation changes until old fixtures have a migration path and exact-head tests are admitted. Never mirror private source to another org solely to work around zero-step Actions runs without independent approval of the source/tree, private carrier and transport policy.
