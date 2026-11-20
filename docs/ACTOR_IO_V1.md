# Actor-local I/O v1

This contract separates **process I/O** from **actor-local logical I/O**.

Process/root code owns `stdio.*` and root `print(...)`. Actor execution uses the
implicit `io` capability with `io.in`, `io.out`, `io.err`, `io.events`
and `io.meta`. `io` is execution context, not `self` state.

The five promotion participants for this tranche are Java/GraalVM, LLVM, .NET,
Wasm, and the independent Cranelift backend. A backend may land a bounded runtime
substrate before its source frontend supports actors, but that state is explicitly
**not source parity**.

Promotion requires the real backend compiler and runtime to execute the shared
positive fixtures and reject the negative fixtures for the intended reason at an
exact source head with nonzero CI steps. Cranelift must remain fail-closed until
its native actor IR/ABI exists. Wasm must use the pinned real Oreslang frontend
and execute the produced guest module; a host JavaScript model is insufficient.

The output stream is data-only. Explicit mailbox transport is a separate
capability boundary and may carry allowed `ActorRef` capabilities. Restart or
hot reload must revoke old I/O authority and must never let a new generation
reopen queued input/output/errors/events/metadata from a retired generation.

See Java #2109, platform-conformance #177, Java #2420, LLVM #1273, .NET #304,
Wasm #242, and Cranelift #48/#52.
