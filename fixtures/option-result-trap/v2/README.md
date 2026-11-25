# Option / Result / trap — modular guest suite v2

**Status: authored but not executed.** The V1 aggregate fixture is retained unchanged; the V2 suite separates feature dependencies so one unsupported feature does not obscure the status of every other feature.

| Guest | Intended source contract | Assertions |
| --- | --- | ---: |
| `option_scalar.ores` | Some(0), Some(false), None, unwrap_or, nested Option | 10 |
| `result_scalar.ores` | Ok, Err, unwrap_or, nested Result | 10 |
| `trap_scalar.ores` | trap callable success, Option<Option<int>>, Option<void> | 7 |
| `trap_result_data.ores` | Result.Err stays ordinary data inside Some | 5 |
| `trap_cast.ores` | eligible failed cast becomes None, success becomes Some | 2 |

Five negative `.ores` compiler fixtures reject cross-type coercions, implicit flattening, and treating a trapped Result as an untrapped Result. **34** positive assertions and **5** rejection fixtures.

`manifest.json` states the expected *exact* stdout of each independent guest. `fixture-lock-v2.json` pins the manifest and every native source file to Git blob SHA-1; `tests/option-result-trap-v2-integrity.test.mjs` checks inventory, labels, hashes and unsafe paths. Git SHA-1 pins are integrity checks, **not** a provenance or permission attestation.

The receipt verifier `bin/verify-option-result-trap-receipt.mjs` accepts both V1 and V2 manifests and refuses an unpinned fixture. A reported success **still requires independent** source-commit, compiler-binary, runtime, job/attempt and actual guest execution verification; its shape check cannot authenticate a fabricated receipt.

Run each candidate using the same `.ores` bytes against actual Java/Graal, LLVM, Wasm, Cranelift and .NET NativeAOT language toolchains. Report `unsupported` independently when the compiler lacks the required grammar/HIR/runtime feature. Do not count unsupported rejections as semantic-negative pass, and never promote a host-only mock or zero-step GitHub job.

**Next requirements:** exact-head JUnit/Graal guest execution, LLVM tagged ADT lowering, pinned LLVM-to-Wasm native guest, Cranelift independent Rust lowering, .NET compiler-generated CIL/NativeAOT guest. `trap` must catch only eligible ordinary guest failures, never panic, raise, cancellation or host failure. Nested `Option` and `Result` must not flatten implicitly.
