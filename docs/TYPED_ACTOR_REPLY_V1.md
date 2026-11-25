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

The 18 additional entries ACTOR-REPLY-19 through ACTOR-REPLY-36 are explicitly
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

## Proxy acknowledgment model: SOURCE_ONLY

The 17 new proposed compiled-guest cases ACTOR-REPLY-37 through
ACTOR-REPLY-53 correspond to the [proxy ACK and durable-delivery contract](https://github.com/atto-lang/atto-spec/blob/proposal/typed-actor-replies-v1-20261116/proposals/PROXY_ACTOR_ACK_AND_DELIVERY_V1.md).
All are **NOT_EXECUTED**, including backend statuses. This addition does not
claim a proxy actor runtime is wired to authenticated app replies.

`tools/proxy_actor_ack_v1.rs` provides **14 Rust host-only unit tests**
covering proxy queue versus final recipient admission, Started versus
Processed, typed outcome conflict, inbox-versus-result durable scopes, absent
provider support, wrong tenant/target/attempt/token/protocol, bounded slots,
activation restart, network uncertainty, retry identity, panic, and cancellation.
Its numeric permit is a test double for a **runtime-private** authenticated
receipt; it does **not** implement or prove cryptographic transport security.

Run with Rust installed:

~~~sh
rustc --edition=2021 --test -D warnings tools/proxy_actor_ack_v1.rs -o /tmp/proxy_actor_ack_tests
/tmp/proxy_actor_ack_tests
~~~

A passing Rust test run proves only reference-model behavior, not that an
Atto guest, scheduler, proxy actor, persistence provider, network transport,
or any native/AOT backend implements the contract. Require exact-head job
steps and separate backend guest receipts before changing any guest status.

## Cross-process proxy IPC: real host processes (still not compiled Atto)

The 15 proposed guest conformance cases ACTOR-REPLY-54 through
ACTOR-REPLY-68 are all `NOT_EXECUTED`. See
[atto-spec cross-process IPC v1](https://github.com/atto-lang/atto-spec/blob/proposal/typed-actor-replies-v1-20261116/proposals/CROSS_PROCESS_PROXY_ACTOR_IPC_V1.md).

`tools/proxy_actor_ipc_two_process_v1.rs` contains 10 host-only executable
Rust tests which spawn a **different OS process** serving a real Unix
domain socket or loopback TCP endpoint. The independent child process
parses bounded binary envelopes, checks a **test-only** numeric capability,
enqueues a scalar in its host-owned mailbox and returns separate destination
admission and processing receipts. Tests cover wrong tenant/capability,
version downgrade, stale incarnation, target mismatch, forged correlation,
loss before ACK, loss after ACK and oversize framing.

Run on a Unix-like CI runner with Rust:

~~~sh
rustc --edition=2021 --test -D warnings tools/proxy_actor_ipc_two_process_v1.rs -o /tmp/proxy_actor_ipc_two_process_tests
/tmp/proxy_actor_ipc_two_process_tests --nocapture
~~~

The child is **Rust test infrastructure**, not an Atto actor, and the
loopback TCP path is **plaintext and test-only**. There is no mutual TLS,
peer identity, real scheduler, compiler guest, userland asynchronous reactor,
durability or full end-to-end wire authentication here. Do not promote
ACTOR-REPLY-54..68 guest statuses merely because the host two-process
checks pass. Production TCP requires mutual TLS and capability policy.
