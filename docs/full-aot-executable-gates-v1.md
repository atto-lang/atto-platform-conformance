# AttoLang full-AOT executable feature gate v1

**Status: draft, not executed for any backend.** This source-only registry is a sibling of \`atto-spec\` PR #56 and \`atto-source.rs\` PR #242. It does not change the language, compiler, or runtime by itself.

## Purpose

Nine portable \`.atto\` sources cover:
- Four successful source-to-Wasm compiler and actual guest executions: scalar 42, recursive 55, canonical \`|n| : int ->\` closure 42, and tagged \`Option<int>\` matching 55.
- Five mandatory fail-closed rejections: arbitrary \`eval\`, runtime source compiler, arbitrary reflective dispatch, runtime native-symbol loading, and runtime type creation.

Every fixture has an exact Git blob SHA stored in \`contracts/full-aot-executable-gates-v1.json\`. The shared registry enumerates six target profiles, **all initially \`not_executed\`**. A contract-test pass must never promote any feature or backend to executable parity.

## Real executable runner (Rust -> Wasm adapter only)

First, independently build the native \`attoc\` compiler from an exact source checkout of \`atto-lang/atto-source.rs\`. Then run:

\`\`\`bash
node bin/run-full-aot-executable-gates.mjs \
  --profile rust-source-wasm \
  --attoc /path/to/source-checkout/target/release/attoc \
  --source-repo /path/to/source-checkout \
  --checkout-head <actual-local-checkout-SHA> \
  --source-head <original-source-PR-SHA> \
  --source-tree <source-tree-SHA> \
  --receipt /tmp/atto-full-aot-execution.json
\`\`\`

A cross-organization exact Git-tree mirror has a **different commit SHA** but must have **identical tree SHA** to the original. The flags deliberately record those identities separately. Each fixture is SHA-verified before compiling.

The runner calls the real native \`attoc\` twice per fixture and requires identical emitted Wasm. It executes a real Wasm guest, checks the public \`main\` result, forbids pure-profile host imports and unexpected language panics, and rejects all five unsupported dynamic operations twice with stable \`E_*\` diagnostics and **no output artifact**. A failure writes no pass receipt.

**Native-AOT caveat:** This proves source-to-Wasm AOT emission and real guest execution, but Node's WebAssembly engine may internally JIT. Its receipt explicitly states \`native_aot_proven: false\`, \`runtime_engine_jit_policy: engine-dependent\`, and \`independent_provenance_check_required: true\`. It must not be used to certify LLVM/GraalVM/.NET/Forge or precompiled native Wasm targets.

## Host-only contract checks

\`\`\`bash
node --test tests/full_aot_executable_gates.test.mjs
\`\`\`

These tests verify the nine real Git object hashes and reject forged pass statuses, duplicate or unsafe paths, missing evidence fields, contradictory native-JIT profiles, or a native backend adapter pretending to work. The workflow \`.github/workflows/full-aot-executable-gates.yml\` intentionally runs **only** these host tests.

## Next adapters and promotion

For each other backend, add an independently implemented compiler adapter that yields:
1. A statically compiled executable or precompiled native module with verified compiler/source SHA and artifact hash.
2. Correct observed output/exit, deterministic negative compilation diagnostics, and proof that rejected sources emitted no executable artifact.
3. Explicit runtime JIT and GC mode, native ABI, and untrusted-actor isolation receipts.
4. A real Actions job with executed build and guest steps. Zero-step jobs remain \`not_executed\`.
5. Independent verification of the claimed source head, checkout tree, guest hashes and workflow steps before certifying parity.

Do not adopt new syntax solely from these feature gates. These fixtures are portable candidate contracts, not proof that all backends currently implement closures or Option/Result.
