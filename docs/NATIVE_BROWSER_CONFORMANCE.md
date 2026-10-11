# Native Oreslang source → Wasm → browser conformance gate

This repository contains an **executable native-source gate**, not an IR fixture runner. The `bin/real-source-wasm-browser.mjs` command requires:

- A real native (ELF/PE/Mach-O) Oreslang LLVM compiler executable. Shell, JavaScript, and test-only IR printers are refused.
- SHA-256 pins for the compiler bytes, source bytes, Wasm bridge, and browser adapter module. The test runner also checks exact original Git blobs for all mirrored source files before invoking any compiler.
- Compilation of actual `.ores` source with `--target=wasm32`, production bridge validation, Wasm artifact manifest SHA-256, exact `() -> i64` ABI, and browser loader execution.
- A canonical signed-i64 expected value, matched against the actual guest result.

## Executed fixtures

The funded integration run contains four positive source programs:

| Fixture | Actual result | Meaning |
| --- | ---: | --- |
| `constant-main.ores` | 42 | Source parser, LLVM codegen, Wasm link, runtime |
| `forward-call-main.ores` | 42 | Same-module forward function calls |
| `return-arithmetic.ores` | 28 | Arithmetic precedence and parentheses |
| `negative-literal.ores` | 42 | Signed arithmetic |

A fifth fixture, `wrong-arity.ores`, **must be rejected by the actual compiler**. An attempted synthetic compiler or unpinned executable fails the gate.

## Worker execution

`tests/real-compiled-worker.test.mjs` takes the source-compiled artifact and its verified manifest and runs it using the existing `oreslang-browser` Worker host and actual isolated Node worker_threads. This proves browser-Worker-compatible module code executes inside a real isolated Node Worker, **not** that it has been tested in Chromium or Firefox.

## Explicitly not certified

- Java/Graal vs LLVM runtime output parity across the full common fixture corpus.
- Oreslang source actors, MessagePack actor send lowering, typed replies, supervisor trees, ownership across suspension, or cleanup.
- Arbitrary class graphs and transitive import dependency locking.
- Host OS sandboxing; browser capability grants beyond the zero-import scalar guest.
- Source-to-compiler reproducibility from the declared Git tree; hashes attest bytes, not build reproducibility.

Use existing paired Java/LLVM source-check gates for compiler admission evidence and separate actual guest runtime tests for behavioral parity. **Do not substitute this scalar source-to-browser report for full cross-backend conformance.**
