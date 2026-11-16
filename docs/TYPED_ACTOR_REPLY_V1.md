# Typed actor replies conformance staging (source-only)

Canonical proposed contract: atto-lang/atto-spec, proposals/TYPED_ACTOR_REPLY_PROTOCOL_V1.md (stacked on typed receives/sends PR #28).

The TSV inventory records **18 future compiled guest scenarios**; all are currently NOT_EXECUTED. The Rust program in tools/typed_actor_reply_v1.rs is a small host-only scalar reference model of reply-slot semantics with ten unit tests, **not** a parsed or compiled Atto program, not Java/LLVM/Wasm/NET/Forge parity, and not a substitute for testing the authenticated real runtime.

Run with Rust installed:

~~~sh
rustc --edition=2021 --test tools/typed_actor_reply_v1.rs -o /tmp/typed_actor_reply_tests
/tmp/typed_actor_reply_tests
~~~

Each implementation must eventually add an actual .atto positive/negative guest fixture for the corresponding ID and record executed proof (or UNSUPPORTED/FAILED) against an exact compiler/actor-runtime head and toolchain. Do not change NOT_EXECUTED based on host model CI alone. The compiler must reject unsupported reply syntax without generating false executable guest artifacts.

## Unary return, explicit reply and stream separation (additional staging)

The 14 new entries ACTOR-REPLY-19 through ACTOR-REPLY-32 are explicitly
NOT_EXECUTED compiled-guest targets, grounded in
[unary reply sugar specification](https://github.com/atto-lang/atto-spec/blob/proposal/typed-actor-replies-v1-20261116/proposals/UNARY_ACTOR_RETURN_AND_REPLY_SUGAR_V1.md).

The supplemental Rust reference model at tools/unary_reply_staging_v1.rs
exercises the crucial **stage -> commit** distinction: return R and
m.respond_with(R) use a single correlated permission; successful handler
completion commits one value, while panic/cancel after staging discards the
candidate reply and terminates with an error. It also models bounded slots,
missing replies, generation fencing and independent concurrent requests.

Run with Rust installed:

~~~sh
rustc --edition=2021 --test tools/unary_reply_staging_v1.rs -o /tmp/unary_reply_staging_tests
/tmp/unary_reply_staging_tests
~~~

This is deliberately a host-only reference. It does not parse AttoLang source,
type-check ActorMail<T>, exercise a real supervisor CONTROL path, check actual
HTTP framing, enforce Sendable/Serializable, or execute any backend. A stepful
Rust CI result proves only the reference-model tests. Do not promote any guest
backend conformance status based on these host tests.
