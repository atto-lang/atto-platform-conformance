# Atto-XO checked signed debit — v1 candidate

Seven identical guest sources exercise price × whole shares + fee with checked signed-i64 intermediate operations. Three success cases return 42/43 (including a near-maximum exact debit); four require an overflow fault, including cancellation and a multiply-by-zero consumer. The guest calls a parameterized function, so a pure constant-expression checker cannot substitute for guest execution.

This is deliberately a **signed-i64 subset** of the Rust application's unsigned-cent range, not an approved cash reservation contract or full u64 parity. It does not assert nonnegative input validation, fee approval, database atomicity, or a portable fault wire ABI. The negative cases specify arithmetic overflow; backend-specific native trap versus language error must be recorded separately.

Rows are pipe-delimited: ID, expected outcome, price, shares, fee, adjustment operator, adjustment, and exact guest source. The independent BigInt test checks the corpus; it does not compile guest code.

Backend lanes: Java/JVM and Native Image, LLVM, .NET NativeAOT, Forge, Rust native, JS, Cranelift, and delegated Wasm are NOT_EXECUTED for this corpus until their actual guest observations at exact reviewed commits are available. Self-hosting, HDL and real-time targets remain capability-gated. No claim of compiled parity is made by this source-only contract.
