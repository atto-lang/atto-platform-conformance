# Execution-context callback source fixtures v1

This directory is the compiled-guest evidence layer for `CALLBACK_DISPATCH_AND_PREEMPTION_V1`.

The host/runtime vectors in each backend are necessary but not sufficient for source-language parity. A backend may report this fixture as **PASS** only when its real Oreslang compiler accepts the exact `.ores` source, lowers it through that backend's normal async/Future pipeline, executes the resulting guest program, and records the required receipt fields from runtime instrumentation.

## `callback_sync_resolve.ores`

The callback resolves synchronously while `Future.from_callback` is still registering. The program then awaits the already-terminal Future.

The visible stdout order is normative, but stdout alone does **not** prove the no-Zalgo rule. The execution receipt must additionally show that:

- callback settlement did not execute the awaiting guest continuation inline;
- the resumed guest segment entered through a fresh scheduler/actor dispatch;
- the logical execution identity was preserved across the suspension boundary;
- no producer/callback host context became active guest execution authority;
- the callback boundary remained `HOST_CALLBACK`.

Backends that do not yet lower this source feature must report **UNSUPPORTED** or **EXPECTED_REJECT** with an explicit compiler diagnostic. Parser-only acceptance, host-only helpers, handwritten IR/C#/C++/JS, or a zero-step CI job are not PASS evidence.

Exact fixture bytes are intended to be pinned by backend evidence receipts.
