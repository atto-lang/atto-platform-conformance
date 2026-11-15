# Typed actor contracts v1 (source-only)

Canonical language proposal: [atto-spec #28](https://github.com/atto-lang/atto-spec/pull/28).

The 15 fixture files and Rust reference model are **SOURCE_ONLY and NOT_EXECUTED**; no actual compiler, actor runtime, or supervisor lifecycle is exercised. Positive and negative expectations are targets, not measured results. The Rust policy oracle validates that a message is allowed by BOTH the sender's `sends` bound and the particular destination's `receives` contract; supervisor CONTROL is a separate authenticated lane.

```sh
rustc --edition=2021 --test tools/typed_actor_v1.rs -o /tmp/typed_actor_tests
/tmp/typed_actor_tests
rustc --edition=2021 tools/typed_actor_v1.rs -o /tmp/typed_actor_oracle
/tmp/typed_actor_oracle
```

This verifier must never be used to promote Java/LLVM/.NET/Wasm/Forge support. Each backend requires independently executed compile-positive, compile-negative and runtime guest traces with exact compiler SHA, toolchain and target, and real CONTROL/mailbox evidence. Existing Java `ActorRef<ActorClass>` must remain compatible until an explicit migration plan is proven.
