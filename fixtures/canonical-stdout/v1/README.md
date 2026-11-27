# Canonical stdout v1

Both `stdio.out.write(...)` and `process.stdout.write(...)` are canonical. This candidate corpus exercises the same raw string output without implied newlines, mixed spellings in LIFO cleanup and checked inline task failure. It does not prescribe new overloads or introduce unrestricted host access. Existing capability and isolation gates must remain.

Historical checked-unwrap v6 fixtures and their pins are unchanged. Backends must compile these exact bytes, execute real guest artifacts and compare raw stdout bytes and result; unsupported profiles stay gaps. Receipts must bind compiler head/tree, compiler artifact, fixture blob, execution target and actual result. Manifest verification alone proves source integrity, not guest execution. HDL/realtime need explicitly documented execution profiles; no simulated pass.

## Required follow-up: buffered output backpressure (2026-11-27)

The accepted contract in [spec #292](https://github.com/atto-lang/atto-spec/pull/292) requires bounded runtime-managed buffering and implicit producer parking without source suspension annotations. The existing four fixtures prove neither saturation nor scheduler liveness. Preserve their pinned bytes; add a separate versioned integration suite using an injected, capacity-limited sink and deterministic gate, not timing sleeps.

Test protocol: compile an ordinary direct and transitive caller with no suspension annotation, fill a tiny item/byte budget, gate the sink and verify the next write remains pending while an unrelated actor/task makes progress; release the sink and verify one resumption, exact mixed-alias bytes, order, no implicit newline, and bounded memory. Repeat for stderr and for cancellation-before-admission, failure, shutdown, generation revocation, unsafe critical borrows, oversized record, and explicit suspension negative controls. A host-only queue unit test is a useful prerequisite but cannot satisfy this gate. Java runtime groundwork: [#2019](https://github.com/atto-lang/atto-source.java/pull/2019). All new backend execution cells are NOT_EXECUTED until real exact-head receipts exist.
