# Tenant actor resume ABI v3 — draft, not implemented

This is a proposed **host/compiler conformance contract**, not an executable AttoLang feature. Source of truth: `contracts/tenant_actor_resume_v3_draft.json`. All nine execution cases start as `not_executed`; do not promote them to `passed` without an actual compiler-generated `.atto` fixture and backend-specific execution evidence.

## Scope and compatibility

ABI v2 runs synchronous actor handlers. V3 adds explicit suspension boundaries and guest-owned continuation frames. The version is announced in the exact `atto.actor.abi` custom section. The host **must fail closed** on an unknown marker, rather than guessing v2/v3 based on function names. Existing v2 guests continue to use the v2 host path.

One tenant is a browser Worker or Node.js `worker_threads` execution context. Multiple actors share that worker and its scheduler, but every actor owns a distinct Wasm instance and a separate, bounded **unshared Wasm32 memory**. There is no raw cross-actor pointer access. Browser Workers are not necessarily V8 isolates.

## Proposed guest exports

- `actor_init(i32 actor_type) -> i32`: initialize instance-specific actor state
- `actor_deliver(i64 sequence, i64 value) -> i32`: admit one typed scalar message (the v3 starter subset); accepted/full/closed are distinct outcomes
- `actor_resume(i32 fuel) -> i32`: perform at most a metered quantum and return a well-defined status
- `actor_stack_used() -> i32`, `actor_heap_used() -> i32`: explicit actor-local resource accounting
- `memory`: privately instantiated, bounded, unshared 32-bit linear memory

Status values are frozen **only within this draft**: `0 YIELDED`, `1 WAITING_MAILBOX`, `2 WAITING_IO`, `3 COMPLETED`, `4 RAISED`, `5 PANICKED`.

A continuation includes the return point, live locals and ownership/borrow information in actor-owned memory. Merely reserving a memory region does **not** preserve the native Wasm execution stack. The compiler must lower suspendable AttoLang functions to resumable state machines, and resume must start as a new Wasm entry call.

## Safety and progress gates

1. **Memory:** inspect declared memory limits *before* instantiation, then enforce actor and tenant aggregate page budgets. Stack/heap regions must be checked for overlap, integer overflow and growth, with bounded continuation depth.
2. **Fairness:** compiler instrumentation must enforce the `fuel` budget at loops, recursion and other potentially unbounded instruction paths. Calling a JavaScript function during an infinite Wasm loop does not suspend it.
3. **Messages:** admission uses per-mailbox monotonic sequence numbers. Actor references include tenant, actor and generation. Old generations never regain mailbox admission after restart.
4. **Failure:** recoverable actor traps and panics produce supervisor CONTROL notices and permit healthy siblings to proceed; fatal worker/process faults are still tenant-wide.
5. **Host portability:** test actual Node.js worker threads and browser workers independently. A host-only test cannot claim compiler support.
6. **Evidence:** require source SHA, compiler SHA and real guest `.wasm` witnesses. Record passed/failed/unsupported/not-executed separately. Browser previews do not constitute execution.

## Proposed implementation order

First implement v3 emission behind an explicit compiler feature gate with a real resumable loop fixture, then add mailbox suspension, then nested `suspends` / `await` continuations and stack checks. Enable the v3 host only when the marker and exports validate. Finally add cross-worker actor generation fencing and benchmark fairness, memory usage and P99 latency. Do not replace v2 until all v3 conformance gates pass.
