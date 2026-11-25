# ADT payload-discard patterns v1 — conformance admission

Source compiler: [Atto Rust/Wasm #246](https://github.com/atto-lang/atto-source.rs/pull/246), exact commit `290dd2ae2141b42e81083c6299aa31a07836aa84`. Related spec: [atto-spec #53](https://github.com/atto-lang/atto-spec/pull/53).

The six byte-for-byte copied `.atto` fixtures include three positive Result pattern checks whose real Wasm `main()` returned 42, and three negative diagnostics with **no guest artifact**. They cover `Ok()`, `Ok(_)`, `Err()`, `Err(_)`, named `Ok(n)` and `Err(message)` with `when` guards, guarded fallthrough, duplicate/unreachable patterns, exhaustive-match enforcement and absence of any implicit binding.

**Evidence:** private [SHA-verified, executed Rust/Wasm carrier run #43970162738](https://github.com/anticaptrad/atto-ci/actions/runs/43970162738), carrier commit `31dff949910abedcafbaf9fcaa43e1d987e48905`, **58/58 scoped original source Git blob SHA1 matches**. The carrier ran real native compiler and wasm32 compiler builds, Rust tests, 18 positive/negative guest checks (including these six), and real Chromium Worker JSPI. This is a bounded mirror and not entire-repository tree identity. Source Actions zero-step failure is **NOT_EXECUTED**, not a compiler failure.

**Java, LLVM, .NET NativeAOT, and Forge remain NOT_EXECUTED** for these six fixtures. A backend accepting or rejecting their text alone is not parity. To promote a backend, require its exact compiler/tree identity, compiled positive guest output and no-artifact negative diagnostic evidence, stepful runner receipt, and explicit AOT target. Do not silently convert unsupported syntax to successful conformance.

Host-only contract test: `python3 -m unittest discover -s tests -p test_adt_payload_discard_contract.py`. Passing it verifies source bytes and admission metadata **only**, not compiled guest semantics.
