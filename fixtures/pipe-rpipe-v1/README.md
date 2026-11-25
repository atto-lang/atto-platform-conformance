# Directed pipe/rpipe target fixtures (not guest evidence)

Authority: [atto-spec PR #45](https://github.com/atto-lang/atto-spec/pull/45), companion compiler [atto-source.rs PR #224](https://github.com/atto-lang/atto-source.rs/pull/224).

These new `.atto` files are **candidate source fixtures only**. They are not expected to run on the current public compiler; their existence does not certify transport, AOT, channel/stream support, or even acceptance of `susp` in every frontend. The manifest records all backend statuses as `NOT_EXECUTED` until exact-source evidence is attached.

Forward and reverse spellings must yield the same directed source-to-sink graph; an actor requires an explicit `emits T` to act as a source, and `receives T` to act as a sink. Two equivalent graph statements constitute two attempted attachments, **not** a duplex connection. Multiple downstream consumers require a deliberate fan-out adapter, not `rpipe`.

Passing gates require each compiler to parse/type-check the test cases, fail closed on invalid port roles and mixed direction, execute the positive cases as real Atto guests, report bounded backpressure, cancellation, EOF, and supervisor CONTROL isolation, and supply the receipt fields in `contracts/pipe-rpipe-directed-endpoints-v1.json`. For hardware- or bootstrap-only backends, report an explicit capability rejection instead of inventing runtime parity.
