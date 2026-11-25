# Logical punctuation v1 — canonical AttoLang test vectors

This directory is an **exact-byte copy** of the draft spec's `contracts/logical-punctuation-v1` at the time this contract was created. Each `.atto` fixture is pinned by Git blob SHA-1 in `tests/logical-punctuation-v1.test.mjs`.

**Language contract:** `&&` = bool AND (short-circuit), `||` = bool OR (short-circuit), `^^` = bool XOR (eager, each operand exactly once, left-to-right). All are bool-only. Precedence: `&& > ^^ > ||`. Lowercase `and`, `or`, and `xor` remain usable identifiers, not operator keywords. Bare `&`, `|`, `^`, and comma are not boolean operators.

Run **source-only** integrity tests: `node --test tests/logical-punctuation-v1.test.mjs`.

For executable verification:
1. Java PR #3009: run `LogicalPunctuationOperatorTest` on the exact PR head, assert the shared fixture returns `42`.
2. LLVM PR #1728: run CTest `native_logical_punctuation_operators` on the exact head; compile `.atto` to LLVM IR and execute native binaries at O0/O2 with exit `42`, and verify invalid sources fail without emitted IR.
3. Other backends (.NET, Forge, Wasm, Rust, JS): compile and run the **same bytes** in separately executed guest environments, prove the negative fixtures and side-effect order.

**NOT EXECUTED / NOT VERIFIED:** These snapshot and source-only checks do not constitute a compiler-backed guest run. A failed GitHub Actions job with `steps=null` is runner admission failure, never semantic test evidence. Never promote this contract to verified based on a shaped receipt without independent exact-head/tree and executable step evidence.
