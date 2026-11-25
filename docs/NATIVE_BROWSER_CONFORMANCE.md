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

## 2026-10-11 reconciled release proof (pinned snapshots)

[Latest native runner #38192283380](https://github.com/canonical-cloud/canonical-monorepo/actions/runs/38192283380) executed the immutable selected-source matrix stored in
`evidence/portable-native-release-pins-20261011.json` (52 exact Git blobs from four repositories):

- LLVM compiler source snapshot `641d227cd33e058999839bcf4b1871c31f222dd0`
- Wasm bridge and codec snapshot `774fb8a5ad0ac31b5b10b06ae711f0b92d74c8b5`
- Browser loader, Worker, and codec snapshot `6d39bf6aada790c9766a0bde01fde4f3564b9a97`
- Conformance compiler-to-browser source snapshot `4468c1f8243e60d66ed02d0404960e7a20a4bc67`

The SHA-exact verification now includes `bin/verify-portable-release-mirror.mjs`,
an **offline local-file gate** that rejects unpinned or changed Git blobs, path
traversal, symlinks, duplicate paths, oversized inputs, inconsistent origin
counts, and invalid commit/tree IDs. The verifier and its two standalone tests
were separately Git-blob pinned in the CI workflow (they cannot self-pin
inside a manifest that also includes itself).

The hosted run built the actual C++ Oreslang LLVM frontend, executed the
previously opt-in real LLVM-to-Wasm bridge test with **no skip**, passed
four positive and one negative genuine source fixtures through the Wasm/browser
pipeline, and executed actual compiler-produced Wasm in a Node Worker.
The offline release-mirror validator's **two adversarial tests also passed**.

**Scope boundary:** the 52 selected source Git blobs are independently
verified, *not the entire source trees of all four repositories*. This result
does **not** establish Java/GraalVM parity, guest actor message lowering,
browser engine parity, independent approval, originating repository required
checks, or production merge eligibility.


### Worker DATA replay and terminal CONTROL checks

[Browser/Wasm exact-source runner #38192283449](https://github.com/canonical-cloud/canonical-monorepo/actions/runs/38192283449) passed 58 Browser tests (including real isolated Worker duplicate/out-of-order ticket rejection, malformed frame denial, and abnormal exit/panic tests) and 23 Wasm tests, with one skipped opt-in native compiler test **in that host-only suite**. The separate current native run #38191829511 explicitly executed that opt-in compiler test with no skips. Worker tests exercise host/isolated transport endpoints; they do not implement or certify source-level Oreslang actor handler lowering.


The final audited Worker endpoint prevents an in-flight asynchronous message decode from issuing an ACK after a concurrent terminal panic, and scrubs owned `Uint8Array`, `ArrayBuffer` and `DataView` frame bytes. The Wasm compiler bridge also rejects substituted special-file FIFOs promptly, using nonblocking/no-follow descriptor flags rather than blocking on open. [Latest paired CI](https://github.com/canonical-cloud/canonical-monorepo/actions/runs/38192283449) exercises these regressions on the 52 selected exact-source blobs; the matching [native source-to-Worker gate](https://github.com/canonical-cloud/canonical-monorepo/actions/runs/38192283380) passes separately without skipped native compiler tests.
