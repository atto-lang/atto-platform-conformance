# AttoLang actor base lifecycle and implementation contracts v2

**Status:** proposed semantic contract and source-free test specification; NOT production compiler execution, five-backend parity, or AOT certification. Stacked on the existing candidate [actor external-entrypoints v1](../docs/ACTOR_EXTERNAL_ENTRYPOINTS_V1.md). Do not merge or claim support based on fixture inventory or a model passing.

## Audit findings (verified scope)

- Java main has a concrete host ActorRuntime with ActorCodeExecutor.initializeActor, receiveActor, tearDownActor, opaque ActorRef ready/done observers and physical cleanup gates. These are **host bridge mechanisms**, not proof that the proposed AttoLang syntax compiles and runs. In Java main, teardown is cooperative/graceful, and init startup is a distinct barrier from terminal physical completion.
- The external-entrypoints v1 draft proposes runtime-only, private external init and receive; Java and other backends have unmerged prototypes, legacy spellings and different feature limits. Preserve its diagnostics and negative fixtures.
- The Java core protocol draft reserves ActorLifecycle / Receives / Supervisor as compiler/runtime authority. An arbitrary trait implementation must never grant mail delivery or supervisor CONTROL capabilities.
- The .NET main ActorMailbox host provides bounded admission and generation revocation/terminal disposal. It is not, by itself, executable Atto actor lifecycle support.
- LLVM legacy on_message and Java legacy on_start adapters require versioned migration; they must not run in addition to canonical init/receive.

## Three separate contracts

**Runtime-owned intrinsic actor base (not an ordinary user-overridable class).** Every declared or inline actor receives a generated nominal Actor identity, sealed dispatch slots, an actor-owned state cell and opaque ActorRef. The runtime owns spawn, mailbox admission, stop/cancel, get_ready, get_done, supervisor failure reporting, generation fencing and physical retirement. No source code can override those transitions or forge a runtime entrypoint by defining a similarly named method.

**Implementation hooks.** Exactly one canonical external init per actor incarnation (optional, default no-op) and one external receive per mailbox-driven actor (required). Source-only/timer-driven actors may omit receive only if an independently checked actor-role declaration explicitly permits that. Proposed optional hooks are tear_down for bounded graceful cleanup and diagnostic observers on_throw and on_raise. These are not equivalent to try/catch or defer/recover and do not alter error propagation. No on_panic hook exists on an actor; a panic is a supervisor CONTROL notice, never guest DATA.

**Requirements and state witnesses.** Ordinary traits can require named callable behavior (e.g. a typed config() accessor, serialization snapshot, or typed emission) without granting permissions. A compiler-owned state schema/witness must separately validate required fields and their initialized types against sealed attached state. A trait alone cannot require physical storage layout, directly access private state, provide a privileged critical-section grant, or serve as ActorLifecycle. Do not accept user-defined ActorLifecycle / Supervisor / Receives authority.

## Illustrative AttoLang source (not accepted-production syntax evidence)

Canonical receiver-first example for actor role binding:

~~~atto
use namespace workers;

declare actor Counter;

define external mtd (Counter self) init(): void {
  return;
}

define external mtd (Counter self) receive(ActorMail<int> mail): void {
  // Checked actor-local methods may access sealed state only under
  // the compiler-validated critical-read / critical-write boundary.
  return;
}
~~~

A normal trait can express a behavior requirement; it is NOT a field-layout capability:

~~~atto
define trait HasConfig<C> as
  fnc config() => C;
end
~~~

The trait grammar is illustrative here; verify it against the compiler's actual accepted trait and receiver declarations before adding guest fixtures. To require that Counter stores and initializes a specific field, introduce a **compiler-owned attached state requirement** and verify that requirement at link/typecheck time, rather than pretending HasConfig itself exposes the field. If an actor implements HasConfig, it must supply the method with the exact type; the method may return a detached immutable value, not a live state alias.

## Hook lifecycle

| Hook | Dispatch authority | Default | Timing and limits |
| --- | --- | --- | --- |
| init | runtime-only external | no-op | at most once per incarnation; completes before READY; no raw actor owner escape |
| receive(ActorMail<T>) | runtime-only external | none for mailbox actors | serialized on owner, after READY, rejects direct guest invocation |
| on_throw(Error) | internal diagnostic observation, proposed | no-op | only for unhandled throw before raise conversion; cannot swallow |
| on_raise(Error) | internal diagnostic observation, proposed | no-op | only for unrecovered raise before escalation; cannot swallow |
| tear_down | cooperative runtime-only, proposed | no-op | at most once after graceful drain, only if initialized; no suspension in v2 |
| on_panic | **supervisor only** | n/a | not an actor hook, must not be catchable/interceptable by own actor |

Do not add both on_stop and tear_down with overlapping ownership, and do not add an in-instance on_restart hook: a restart creates a new incarnation. State restoration is a separately typed, explicitly permissioned init input and must not inherit old actor memory or stale ownership.

## Required event/phase invariants

- ALLOCATED -> INITIALIZING -> READY -> TURN_RUNNING -> READY; eventual STOPPING -> DRAINING -> optional TEARDOWN -> TERMINATED. Any failure path enters STOPPING with an immutable terminal cause; FAILED is an outcome, not an allowed re-entry phase.
- Runtime can accept **bounded** mail while startup is pending, subject to identity and capacity, but no user receive may start until initialization succeeded and READY was published. If startup fails or STOP wins, fail pending arrivals without running receive.
- Only one physical guest turn at a time per incarnation. An await/continuation may suspend without relinquishing generation ownership. Never permit a stale callback, mutable loan or message to re-enter a retired incarnation.
- get_ready and get_done are independently reusable, non-cancelling observers. READY means init succeeded, never merely spawn admission. DONE requires **physical** retirement of source tasks, child actors, mailboxes, outputs, foreign I/O loans and resource ownership. A stop request is never successful DONE.
- STOP seals fresh ingress before teardown, cooperatively unwinds already-admitted work as policy permits, and publishes terminal supervisor receipts via CONTROL. Do not run a guest callback or complete host Futures while a lifecycle monitor is held.
- tear_down runs exactly zero or one time on graceful stop of initialized actors, on the owned actor lane. It cannot defer physical retirement indefinitely, reacquire a sealed mailbox, resurrect an actor or grant cross-domain state access. Cancellation/forced kill/panic do not promise a cooperative tear_down; trusted runtime reclamation still occurs.
- An observer hook failing cannot swallow the original failure. Retain original cause and report the diagnostic failure separately to the supervisor. on_throw occurs for unhandled throw; on_raise occurs for unrecovered raise. A panic skips both recovery hooks and goes straight to supervisor CONTROL. Any distinction between throw/raise and callback execution must be visible in typed IR, not inferred from strings.
- Stop/restart and readiness race on an incarnation generation. Restart requires monotonic new generation **after** the old incarnation is physically retired. Duplicate hook slots across files or namespaces are compile errors, not last-wins dispatch.
- Runtime events (SPAWN_ACCEPTED, READY_PUBLISHED, STOP_REQUESTED, FAILURE_REPORTED, PHYSICALLY_RETIRED and others in the JSON) are trusted structured events. Public actor mail must never spoof them. The event stream is not authorization; it is observable metadata.

## Trait/schema checking and visibility

The checker must verify (1) nominal actor implementation owner and namespace, (2) exact receiver type of each mtd slot, (3) no duplicated or inherited ambiguous lifecycle hooks, (4) runtime-only external marker preserved from AST through typed IR/AOT table, (5) no public export/RPC of lifecycle hooks, (6) exact trait method signatures including generic substitutions, (7) attached state layout, field types, initialization/definite assignment, and (8) critical state read/write authorization. Compile failure, not a host runtime fallback, is required for missing trait methods, missing required state members, direct state access, state borrow crossing await, and forged supervisor authority.

The compiler can synthesize an empty actor-owned state for stateless actors, but must never expose a raw host object, uninitialized alias or actor memory pointer. Schema contracts describe data shape only and do not authorize state sharing across actors.

## Cross-backend acceptance

The JSON companion contains 25 named test obligations across Java/GraalVM, LLVM/native, .NET NativeAOT, Wasm and Forge. Each backend must report explicit UNIMPLEMENTED or compile rejection where semantics are not available; tests must never silently skip positive source programs. Required evidence includes exact SHA and tree, typed compile diagnostics, real guest lifecycle execution with init/receive/stop/restart, physical loan retirement and AOT receipts where supported. JVM host-only unit tests and source-free JS models cannot promote a backend to GUEST_EXECUTED.

The source-free Node test for this contract covers declared policy consistency and an independent bounded lifecycle reference model. It does **not** execute any AttoLang source and must clearly report SOURCE_FREE_MODEL_ONLY.

Integration order: (1) freeze v1 external roles, (2) implement compiler-owned hook slot index + state witness in Java, (3) make Java guest lifecycle tests pass, (4) port executable contract to LLVM and .NET, (5) extend Wasm and Forge, (6) independently verify native AOT, failure/stop races, sanitizer results and restart generation fences. Existing draft stacks remain unmerged until these claims are actually proven.
