# Source terminal-control admission v1

**State: DRAFT CONTRACT / NOT EXECUTED BY COMPILER BACKENDS.**

Host compiler source admission must reject a **raw** ASCII Escape (ESC, U+001B, byte `1b`) or Delete (DEL, U+007F, byte `7f`) anywhere in valid UTF-8 source, including inside line comments, nested block comments, string literals, quoted Symbols and raw templates. Such characters may alter terminal rendering and log interpretation. Check original input **before** comment/token elision, compilation, external compiler execution, or artifact publication.

Raw NUL (`00`) remains separately prohibited. When more than one of NUL/ESC/DEL appears, report the earliest raw source position. The diagnostic must not echo the control byte. Ordinary tab, LF, CR, CRLF, printable Unicode comments and **visible backslash-u escapes** remain admissible at this preflight stage; decoded string values are a separate policy layer.

## Coordinates

- LLVM, Forge, Rust, Wasm, Cranelift: zero-based **UTF-8 byte** offset, including multi-byte scalars preceding an offending byte.
- .NET scalar and structured parser, plus JavaScript: zero-based **UTF-16 code-unit** offset; include linked-import discovery entry points.
- Java lexer: one-based **line:UTF-16 column**, matching existing CRLF normalization and surrogate-pair columns.
- Ill-formed UTF-8 source is already rejected by the existing UTF-8 admission contract. This v1 terminal contract assumes valid encoded input; backend-specific diagnostics for invalid encoding are independently tested.

## Versioned fixtures and tests

The 13 checked-in hex vectors live in [`contracts/source-terminal-controls-v1.json`](../contracts/source-terminal-controls-v1.json). The Rust-only independent reference test is [`test/rust-source-admission/tests/terminal_control.rs`](../test/rust-source-admission/tests/terminal_control.rs), in the existing source-admission verifier crate.

Run from the originating repository once a trusted runner can execute:

```sh
cargo test --manifest-path test/rust-source-admission/Cargo.toml --all-targets
cargo clippy --manifest-path test/rust-source-admission/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path test/rust-source-admission/Cargo.toml --all -- --check
```

The reference Rust tests cover exact hex fixtures and exhaustive 65,536 two-byte precedence combinations. **They are not compiler execution.** Execute the native backend tests against the exact reviewed parent-and-child stack before recording any compiler, guest, Native Image, or cross-backend parity receipt.

Every backend is `UNVERIFIED` until a trusted run binds exact commit/tree IDs to non-skipped native tests. A zero-step CI failure means `NOT_EXECUTED`. No private Oreslang source may be transferred outside its security boundary while [private-source incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) remains open. Independent source-free Rust canaries on external private runners cannot authorize private-source transfers or prove backend parity.
