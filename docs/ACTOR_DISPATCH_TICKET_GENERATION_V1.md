# Actor dispatch ticket generation v1 (proposal)

This **non-certifying** contract refines the existing actor-finalization
`AF08` stale-ticket requirement with a separate dispatch-ticket lease identity:

`(actor_id, actor_incarnation, slot, generation)`.

A numeric dispatch slot is reusable. Delayed completions, cancellations and
wakeups belonging to an older generation of that same slot **must not**
revoke or modify the newer physical worker lease. Foreign actors and earlier
incarnations likewise have no authority. STOP fences new issuance but permits an
already admitted turn to finish; counter wraparound must fail closed rather than
reissue a still-replayable identity.

The proposed `contracts/actor-dispatch-ticket-generation-v1.json` has twelve
positive/negative source-free scheduling cases (ATG01–ATG12), including a
deliberately broken numeric-slot-only comparator. A separate Rust reference
oracle checks the case expectations and must detect that mutation:

```sh
cargo fmt --manifest-path tools/actor-dispatch-ticket-oracle/Cargo.toml -- --check
cargo clippy --manifest-path tools/actor-dispatch-ticket-oracle/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path tools/actor-dispatch-ticket-oracle/Cargo.toml
```

Java companion: [source.java draft #3127](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3127),
which separately explores two reusable slots, two epochs and two physical
workers in Rust, with a mandatory ABA mutant witness.

**Evidence status: NOT_EXECUTED.** The reference oracle is not a test of any
production scheduler, compiler, actual actor, native heap or GraalVM guest. A
passing reference test cannot promote Java, LLVM, Wasm, .NET, Rust, Cranelift or
Forge parity. Every backend must run reviewed implementation-level cases
against its own exact head with stepful CI and independent approval. A failed
Actions allocation with no executed steps remains infrastructure non-evidence.

**Privacy:** The contract is newly authored backend-neutral behavioral data,
not a copy of any private compiler source. No cross-organization source export
is authorized by this proposal.
