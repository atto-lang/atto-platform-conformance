# Cross-backend Task cancellation / physical cleanup conformance v1

This folder is a **draft source contract**, not a passing compiler test. The
`.ores` fixtures are proposals: their parser and host hook boundaries remain
unverified. The Node test checks only metadata completeness and explicit
absence of execution receipts; it never sets a backend `verified` flag.

Java/GraalVM host work: [#1887](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1887).
LLVM source cleanup and continuation binding: [#866](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/866).

Both backends must compile the **same source file** and generate a transcript
of callback order, task completion/error classification, actor DONE ordering,
active native carrier count, waiter release, and resource/FFI loan retirement.
The harness must orchestrate cancellation at a real suspended await and must
not implement guest `defer`, `finally`, or `panic` as host callbacks.

The actor-STOP case requires source actor integration and authenticated
post-stop cleanup-only control admission; a test exercising only
`OresScheduler.close()` is useful fail-closed host coverage but NOT this
positive acceptance gate.

For negative native admission, prove that stale or foreign continuation
handles cannot advance cleanup even after actor ID reuse. For all scenarios,
record backend/compiler SHA, full native executable hash, test command,
runner ID/steps, terminal classification, trace and sanitizer output.
An unsupported parser feature is an explicit FAIL/UNIMPLEMENTED gate,
not a green skip.

Do not mutate `sourceExecutionVerified` or per-case `verified` unless
the corresponding exact-source Java and LLVM executions have actually run.
