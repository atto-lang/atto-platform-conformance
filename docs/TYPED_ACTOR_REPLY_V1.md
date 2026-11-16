# Typed actor replies conformance staging (source-only)

Canonical proposed contract: atto-lang/atto-spec, proposals/TYPED_ACTOR_REPLY_PROTOCOL_V1.md (stacked on typed receives/sends PR #28).

The TSV inventory records **18 future compiled guest scenarios**; all are currently NOT_EXECUTED. The Rust program in tools/typed_actor_reply_v1.rs is a small host-only scalar reference model of reply-slot semantics with ten unit tests, **not** a parsed or compiled Atto program, not Java/LLVM/Wasm/NET/Forge parity, and not a substitute for testing the authenticated real runtime.

Run with Rust installed:

~~~sh
rustc --edition=2021 --test tools/typed_actor_reply_v1.rs -o /tmp/typed_actor_reply_tests
/tmp/typed_actor_reply_tests
~~~

Each implementation must eventually add an actual .atto positive/negative guest fixture for the corresponding ID and record executed proof (or UNSUPPORTED/FAILED) against an exact compiler/actor-runtime head and toolchain. Do not change NOT_EXECUTED based on host model CI alone. The compiler must reject unsupported reply syntax without generating false executable guest artifacts.
