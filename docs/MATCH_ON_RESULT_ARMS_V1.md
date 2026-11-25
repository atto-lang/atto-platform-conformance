# Canonical `on` for Result match arms — cross-backend v1

**Canonical language authority:** [atto-spec #145](https://github.com/atto-lang/atto-spec/pull/145) (pending review). The user-confirmed source spelling is:

```atto
val result = worker.send(42);
do match result over
    on Ok(ack) -> { /* admitted; not necessarily processed */ }
    on Err(err) -> { /* admission refused; handle err */ }
end
```

Every `match ... over` arm uses the contextual introducer `on`. The same rule applies to `do match`, guarded arms and `on _`. A bare `Ok(...)` or `Err(...)` arm is a syntax error in this profile. `default` is for `switch`; do not silently rewrite `on _` to `default`.

In `return match ... end;`, the selected arm supplies the value of the match and the enclosing `return` exits the function. In `do match`, an arm may fall through or end with an explicit void return. The surrounding function continues after `end`.

## Fixtures and verification tiers

The six `.atto` files under `fixtures/match-on-result/v1/` are pinned by exact Git blob SHA in `contracts/match-on-result-arms-v1.json`: three positive ADT cases (Ok, Err with guard, `do match` wildcard) and three syntax negatives (bare Ok, bare Err, switch-style default). Expected positive guest exit is 42. Expected rejection diagnostic for the negatives is `E_SYNTAX` with **no output artifact**.

`node --test tests/match-on-result-arms-v1.test.mjs` verifies source identities and source-level corpus contracts **only**. It is not a parser, compiler or guest execution proof and never marks a backend passed.

A deliberately **manual**, real-compiler runner exists:

```sh
ATTOC_BIN=/absolute/path/to/verified/attoc ATTO_SOURCE_SHA=<exact-40-hex-commit> \
    node tests/match-on-result-guest.mjs
```

This command actually compiles each unchanged `.atto` fixture and instantiates the positive Wasm guests in Node, checks exit 42, and requires negative diagnostic + absence of a produced artifact. Run it only with an authenticated independently verified compiler tree in an authorized environment. The environment-provided SHA is a **claim** until independently attested. A successful run proves only **the specified compiler -> Wasm guest**; it does not prove independent Atto Wasm backend or LLVM native ELF parity. All six-backend/aggregate status fields remain `not_executed` until exact-compiler/exact-fixture provenance is recorded and reviewed.

## Backend status and integration

- **Atto LLVM browser frontend**: main's parser already requires `on` after `match ... over`, and typed `Result<int,string>` patterns are present in its existing ADT fixtures. That does **not** prove the native LLVM backend lowers arbitrary Result or actor send.
- **Atto LLVM native AOT**: [LLVM draft #292](https://github.com/atto-lang/atto-source.llvm/pull/292) adds host-only tagged actor mailbox admission; current guest emitter still treats `send` as void/trap. No language-level send Result claimed.
- **Atto independent Wasm**: [Wasm PR #49](https://github.com/atto-lang/atto-source.wasm/pull/49) reconciles the legacy worker/LLVM-bridge path; neither its host receipts nor a Rust-compiled wasm32 artifact may be substituted for independent Wasm guest Result execution.
- **Formatter**: [atto-format #45](https://github.com/atto-lang/atto-format/pull/45) provides a canonical `on Ok`/`on Err` round-trip regression without semantic parsing.
- **Other targets:** Java, Rust, .NET, Forge and Cranelift require their own exact-source compiler and executable guest proofs.

Send returns `Result<Ack,SendError>` only when the compiler, type checker, ownership ABI, runtime and conformance evidence actually support it. `Ok(Ack)` is mailbox admission, **not processed/durable delivery**. Failures never justify ownership loss, a forged capability or a false success. Preserve each backend's quarantine and CONTROL boundaries.

**No merge or parity promotion** solely on these source-only tests. No private source transfer to any other organization has been authorized by this contract.
