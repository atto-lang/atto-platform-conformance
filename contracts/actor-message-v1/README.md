# Actor application-message contracts v1 — candidate parity oracle

This directory tracks the **proposed** `receives` / `sends` contract from [atto-lang/atto-spec#28](https://github.com/atto-lang/atto-spec/pull/28), against Java stage-1 [oreslang-source.java#3126](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3126).

`receives T` declares a typed **inbound** application mailbox, whose payload must agree with `receive(ActorMail<T>)`. A single actor can send to many independently typed `ActorRef<ActorClass>` recipients. `sends U` is an outbound **message-type effect**, never a destination count. An actor has one supervisor on a distinct authenticated CONTROL route; CONTROL messages are not application `sends` or `receives`.

## Source candidates and expected results

| Fixture | Java stage-1 expected | Required other backends |
| --- | --- | --- |
| `positive-multiple-recipients.atto` | typecheck accepts independent text/text/int recipients | acceptance only after actual compiler/guest evidence |
| `negative-wrong-downstream-payload.atto` | reject at integer recipient's ActorRef.send | diagnostic-specific rejection |
| `negative-unverified-sends.atto` | `ACTOR_SENDS_EFFECT_UNSUPPORTED` | reject unsupported effect; **not** a success claim |
| `negative-receives-never.atto` | `ACTOR_RECEIVES_NEVER_UNSUPPORTED` | deny CONTROL-only path until runtime separation is proven |

Run the dependency-free reference model:

```sh
cargo fmt --manifest-path tools/actor-message-contract-v1/Cargo.toml -- --check
cargo clippy --manifest-path tools/actor-message-contract-v1/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path tools/actor-message-contract-v1/Cargo.toml
```

The Rust test `tests/exact_fixture_blobs.rs` additionally pins the **exact Git blob SHA** for all four portable `.atto` fixtures and checks single-byte mutation detection. It runs as part of `cargo test` and depends only on Git being available on PATH. It hashes the embedded fixture bytes through `git hash-object --stdin`, not a cached index or local branch ref. A green fixture-identity check means **source bytes matched the approved pins**, not that Java or any other backend compiled or executed those files. Cross-repository blob pairing must still be verified against the immutable Java #3126 and conformance #740 PR heads; updating any pin requires independent approval.

The Rust tests are an **abstract oracle and fixture-presence smoke test**, not an Atto parser, source execution, native AOT proof, or end-to-end supervisor authentication test.

**Evidence ledger at creation:** Java PR proposed, Java JUnit **NOT EXECUTED**, reference Rust model **NOT EXECUTED**, LLVM/.NET/Wasm/Forge/Cranelift/Rust/JS/HDL backends **NOT EXECUTED**. No parity passes claimed. All backends need the same exact `.atto` source blobs, actual compiler identities, stepful exact-head test receipts, and verified positive+negative outcomes before promotion. Do not export private source trees to third-party runners without explicit source-side approval.
