# AttoLang scheduler-aware native threads — contract v1

Status: proposed; executable backend conformance not yet established.

## Execution identities
- Native Thread: physical OS thread (pthread / platform thread / .NET thread / supported Wasm worker).
- Task: logical, suspendable execution which may migrate across OS threads.
- Actor: logical supervised execution with sealed state and mailbox.

## Blocking-name rule
A `*_blocking` API has synchronous *source-level* semantics: it returns the result when ready, or propagates an error. In a scheduler-managed Task/actor it MUST suspend the current logical execution, release its worker for other runnable work, and resume from completion notification. It MUST NOT busy-poll or block an OS worker while waiting. On a standalone native Thread without a suspendable execution context, the same call MAY block the OS thread. The implementation MUST detect its context rather than silently treating a native thread as a task.

`join_async()` returns a future/task-like completion value; `join_blocking()` awaits the same one-shot completion event with synchronous-looking semantics. No thread-per-join waiters. A join result is consumed at most once; duplicate joins must report a typed error. Completion publication must establish a happens-before relation with join observation.

`sleep_blocking()` on Task/actor uses a scheduler timer, never worker sleep. Cancellation unregisters waiters; late notifications must not resume cancelled frames. Scheduler suspension while holding a non-suspendable critical lock or non-pinned borrow is rejected.

## Storage
- ThreadLocal<T>: keyed by physical thread, cleaned on thread exit.
- TaskLocal<T>: keyed by logical Task, preserved across migration, cleaned on task completion.
- ActorLocal<T>: keyed by actor identity, cleaned on actor teardown, subject to sealed actor state rules.
None of these types automatically grants cross-domain access. Destructors execute once.

## Ownership
Thread captures require transitive Send. Box<T> moves and invalidates the source binding. Arc<T> sharing requires valid shared backing and Send + Sync constraints. dyn Trait cannot erase the auto-trait requirements of its concrete implementation. State containers retain their critical-read/critical-write gates; native threads have no bypass.

## Backend targets
LLVM: pthreads; Forge/Cranelift: native runtime; Java/Graal: platform threads; .NET: OS-backed threads; Wasm: worker support only where available, otherwise explicit UnsupportedPlatform. Each backend must report its actual capabilities.

## Required executable tests
1. Spawn two native threads, join and verify returned values.
2. Verify completion notification resumes a parked Task without consuming an OS worker.
3. Verify task-local values survive worker migration; thread-local values do not follow a Task.
4. Verify actor-local isolation and teardown cleanup.
5. Verify Box move, Arc sharing and dyn auto-trait constraints with compile-pass/fail cases.
6. Verify cancellation-vs-completion race, double join, panic propagation, and thread creation failure.
7. Verify critical section and borrowed reference cannot be suspended unsafely.
8. Verify deterministic teardown and no leaked waiter registration under stress.
9. Verify unsupported Wasm targets fail closed.
10. Run executable fixtures on each supported toolchain; parser-only acceptance is not parity evidence.

## Release gate
Record source commit SHA, test runner org and SHA-equivalent mirrored tree, runtime exit codes, and sanitizer results. Do not claim backend parity until executable evidence exists.
