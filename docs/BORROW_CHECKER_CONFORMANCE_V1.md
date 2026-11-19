# Borrow-checker integration conformance matrix v1

**Status: TARGET TEST PLAN / NOT_EXECUTED.** This is a versioned **integration** registry for the public [AttoLang borrow-checker guide](https://github.com/atto-lang/.github/blob/main/BORROW_CHECKER.md). It records 40 proposed compiler/guest cases (20 positive + 20 negative) across 20 feature families. Its source snippets are deliberately not presented as already compilable; parser, typed ownership, AOT and runtime admission are separate.

The canonical case list is [`contracts/borrow-checker-v1.tsv`](../contracts/borrow-checker-v1.tsv), with each row pointing to an independently readable `.atto` fixture under [`fixtures/borrow-checker-v1/`](../fixtures/borrow-checker-v1/). Each `PASS` row requires a compiled Atto guest that **runs and returns 42**; each `REJECT` row requires the intended ownership/type diagnostic and **zero emitted guest bytes**, not a generic syntax error substituted for the intended type/effect check. Every row starts at `NOT_EXECUTED`, including bounded Rust/Wasm features already verified at a different exact SHA or with different test inputs.

## Cross-branch semantic baseline

This registry intentionally assumes the **feature-branch target semantics** will be reconciled and merged, while recording the exact currently reviewed sources:

| Contract or implementation | Feature branch / PR head used for design |
| --- | --- |
| Expanded ownership words, including pinned relocation guards | [atto-spec #94](https://github.com/atto-lang/atto-spec/pull/94) `a83e6422770ef69bd28650ba4973a2ffb9a19739`; predecessor [#92](https://github.com/atto-lang/atto-spec/pull/92) |
| Nonprimitive arguments borrow by default | [atto-spec #89](https://github.com/atto-lang/atto-spec/pull/89) and [conformance #74](https://github.com/atto-lang/atto-platform-conformance/pull/74) at `81b5bc848f9b012a7e1d3c1d3093f0920e33e69d` |
| Shallow `copy!`, deep `copy!!`, actor graph fan-out | [atto-spec #39](https://github.com/atto-lang/atto-spec/pull/39) and [conformance #64](https://github.com/atto-lang/atto-platform-conformance/pull/64) at `781bda978f38ad9c13de2f7a480eff9c7534d93d` |
| Frozen `share!` and synchronized writers | [atto-spec #90](https://github.com/atto-lang/atto-spec/pull/90) |
| `freeze!`, `weak!`, `pin!`, `drop!`, `lt!` models | [conformance #76](https://github.com/atto-lang/atto-platform-conformance/pull/76) at `09c1bae49555bc57232dc1b46484127bb643c884` |
| Typed `Pointer<T>`, actor state, Mailman and suspension | [atto-spec #18](https://github.com/atto-lang/atto-spec/pull/18), [#29](https://github.com/atto-lang/atto-spec/pull/29), [#64](https://github.com/atto-lang/atto-spec/pull/64), [#27](https://github.com/atto-lang/atto-spec/pull/27) |
| Bounded compiler actual behavior (not general parity) | [atto-source.rs #264](https://github.com/atto-lang/atto-source.rs/pull/264) checked handles; [#265](https://github.com/atto-lang/atto-source.rs/pull/265) flat-class AOT `copy!!` |
| Independent host ownership verifier | [atto-borrow-checker.rs #43](https://github.com/atto-lang/atto-borrow-checker.rs/pull/43) |

These PRs have different ancestry and maturity. This matrix does **not** claim any unmerged branch has been combined, reviewed, or executed on all backends. In particular, `copy!` is **shallow**, `copy!!` is **deep**, `share!` is **frozen readonly** and ordinary nonprimitive function arguments **borrow**, never silently move.

## Coverage

| Feature | PASS fixture | REJECT fixture |
| --- | --- | --- |
| `scalar_value` | [pass](../fixtures/borrow-checker-v1/pass/scalar-value.atto) | [reject](../fixtures/borrow-checker-v1/fail/scalar-value.atto) |
| `implicit_borrow` | [pass](../fixtures/borrow-checker-v1/pass/implicit-borrow.atto) | [reject](../fixtures/borrow-checker-v1/fail/implicit-borrow.atto) |
| `read_loan` | [pass](../fixtures/borrow-checker-v1/pass/read-loan.atto) | [reject](../fixtures/borrow-checker-v1/fail/read-loan.atto) |
| `write_loan` | [pass](../fixtures/borrow-checker-v1/pass/write-loan.atto) | [reject](../fixtures/borrow-checker-v1/fail/write-loan.atto) |
| `take` | [pass](../fixtures/borrow-checker-v1/pass/take.atto) | [reject](../fixtures/borrow-checker-v1/fail/take.atto) |
| `share` | [pass](../fixtures/borrow-checker-v1/pass/share.atto) | [reject](../fixtures/borrow-checker-v1/fail/share.atto) |
| `copy_shallow` | [pass](../fixtures/borrow-checker-v1/pass/copy-shallow.atto) | [reject](../fixtures/borrow-checker-v1/fail/copy-shallow.atto) |
| `copy_deep` | [pass](../fixtures/borrow-checker-v1/pass/copy-deep.atto) | [reject](../fixtures/borrow-checker-v1/fail/copy-deep.atto) |
| `deep_graph` | [pass](../fixtures/borrow-checker-v1/pass/deep-graph.atto) | [reject](../fixtures/borrow-checker-v1/fail/deep-graph.atto) |
| `mut_binding` | [pass](../fixtures/borrow-checker-v1/pass/mut-binding.atto) | [reject](../fixtures/borrow-checker-v1/fail/mut-binding.atto) |
| `lt_binder` | [pass](../fixtures/borrow-checker-v1/pass/lt-binder.atto) | [reject](../fixtures/borrow-checker-v1/fail/lt-binder.atto) |
| `freeze` | [pass](../fixtures/borrow-checker-v1/pass/freeze.atto) | [reject](../fixtures/borrow-checker-v1/fail/freeze.atto) |
| `weak` | [pass](../fixtures/borrow-checker-v1/pass/weak.atto) | [reject](../fixtures/borrow-checker-v1/fail/weak.atto) |
| `pin` | [pass](../fixtures/borrow-checker-v1/pass/pin.atto) | [reject](../fixtures/borrow-checker-v1/fail/pin.atto) |
| `drop` | [pass](../fixtures/borrow-checker-v1/pass/drop.atto) | [reject](../fixtures/borrow-checker-v1/fail/drop.atto) |
| `checked_handle` | [pass](../fixtures/borrow-checker-v1/pass/checked-handle.atto) | [reject](../fixtures/borrow-checker-v1/fail/checked-handle.atto) |
| `pointer` | [pass](../fixtures/borrow-checker-v1/pass/pointer.atto) | [reject](../fixtures/borrow-checker-v1/fail/pointer.atto) |
| `actor_state` | [pass](../fixtures/borrow-checker-v1/pass/actor-state.atto) | [reject](../fixtures/borrow-checker-v1/fail/actor-state.atto) |
| `actor_handoff` | [pass](../fixtures/borrow-checker-v1/pass/actor-handoff.atto) | [reject](../fixtures/borrow-checker-v1/fail/actor-handoff.atto) |
| `suspension` | [pass](../fixtures/borrow-checker-v1/pass/suspension.atto) | [reject](../fixtures/borrow-checker-v1/fail/suspension.atto) |

## Required execution and evidence gates

1. **Static Rust matrix check**: run `rustc --edition=2021 --test tests/borrow_checker_matrix_v1.rs -o borrow_checker_matrix_v1` and then `./borrow_checker_matrix_v1`. It verifies all local fixtures, unique IDs/paths, both verdicts for every family, unexecuted statuses and non-empty oracles. It deliberately does **not** execute an Atto compiler.
2. **Compiler preflight**: use exact source branch/head, grammar/effect profile and compiler target for each case. A positive is `PASS` only when its actual `.atto` guest compiles **and runs** with result 42. A negative is `PASS` only when the intended diagnostic family is emitted with no executable/Wasm artifact; `E_SYNTAX` on an ownership-negative fixture is **not** a pass unless that case explicitly tests syntax.
3. **Ownership and runtime**: test nested aliases/cycles and constructor non-reexecution for `copy!!`, shallow copy denial of a unique nested child, fail-atomic mailbox admission, freeze/weak generation fencing, pin relocation, guarded state and cancellation cleanup. Authenticated domains, precompiled copy plans, fixed budgets and independent message graphs need real runtime witnesses, not a host reference oracle.
4. **Exact-head per backend**: record **source commit SHA and tree SHA**, toolchain, target, compiler and guest artifact SHA-256, full executed command, test log/step count, expected vs actual exit/output, diagnostic/no-artifact evidence, and reviewer. Repeat for each backend/feature at the **actual merged or stacked exact SHA**. A test passing on another head cannot be transferred.
5. **No invented support**: `PASS`, `FAIL`, `UNSUPPORTED` and `NOT_EXECUTED` describe execution results per case and backend; a proposed expected verdict `PASS` or `REJECT` in the TSV is **an oracle, not a test result**. If a backend cannot implement a feature safely, it must fail closed; zero-step CI and skipped tests remain `NOT_EXECUTED`.

## Runnable guest adapter (Node.js, narrow ABI v2 only)

The browser compiler's generated guest WebAssembly exports `main(): i64`, not a WASI process `_start`. The Rust driver checks the **runner process exit**, so its positive tests require a correct guest adapter rather than calling `wasmtime guest.wasm` or simply running the compiler.

[`bin/borrow_guest_exit.mjs`](../bin/borrow_guest_exit.mjs) is a fail-closed Node.js adapter for the **scalar/class-only** subset relevant to six compiler-candidate cases. It validates Wasm and the expected Atto guest ABI exports (`main`, `panic_code`, optional `memory`), allows only the `atto.print_*` host imports, actually instantiates the generated guest, invokes `main()`, checks `panic_code`, and maps the resulting i64 value 0–255 to the process exit status. Actor, state, foreign, unsupported imports and unknown exports **reject**, rather than being silently simulated.

Run against **an actual compiler artifact** by supplying to the Rust driver `--guest-runner "$(command -v node)" --guest-arg "$(pwd)/bin/borrow_guest_exit.mjs"` (the adapter path must be absolute if the driver is invoked from elsewhere). The driver additionally requires `--fixture-repo`, `--fixture-head`, `--fixture-tree`, `--fixture-blob-sha`, and `--manifest-blob-sha`, all checked against the on-disk Git trees/blobs. For `PROFILE_CANDIDATE_DRAFT` cases specify `--allow-draft-profile` and use the correct compiler feature branch head.

[`tests/borrow_guest_exit_v1.test.mjs`](../tests/borrow_guest_exit_v1.test.mjs) uses **synthetic Wasm** to exercise adapter exit-value propagation and fail-closed behavior. It is not compiler evidence or an ownership proof. Those Node tests can run independently of the Rust toolchain, but they can never qualify a backend as passing a fixture.

## Evidence integrity hardening (November 2026)

The Rust verifier now **rejects dirty compiler and fixture working trees**, checks semantic diagnostic tokens with exact code boundaries, and requires a genuinely **empty output directory** for negative compilation (a zero-byte `.wasm` still counts as a forbidden artifact). It prints the compiled guest artifact SHA-256, verifies the guest-runner executable SHA-256 through `--guest-runner-sha256 <64-hex>`, and removes isolated temporary output directories on normal exit or Rust unwinding.

These are stronger **integrity gates, not test results**. Runner binary digests do not alone prove the runtime's implementation; use the reviewed Node adapter from the exact fixture checkout and pin that source as well. The Node adapter's local synthetic test matrix was expanded from four to seven cases (nonzero panic, out-of-range return, and actor-module denial).

## Optional compiled-guest execution gate (Rust, exact compiler inputs)

[`bin/run_borrow_checker_matrix.rs`](../bin/run_borrow_checker_matrix.rs) is a dependency-free Rust **single-case** runner for candidate cases. It intentionally rejects `TARGET_ONLY` fixtures and unapproved draft-profile execution; it never marks a fixture passed merely because source code was checked in. Compile with:

~~~sh
rustc --edition=2021 bin/run_borrow_checker_matrix.rs -o borrow_checker_exec_v1
~~~

Run a supported case by passing **all actual immutable compiler provenance**: `--case BCV1-015`, `--compiler /path/to/attoc`, `--compiler-repo /path/to/atto-source.rs`, `--compiler-head <40-hex>`, `--compiler-tree <40-hex>`, `--compiler-sha256 <64-hex>`, `--fixture-blob-sha <40-hex>`, `--manifest-blob-sha <40-hex>`, `--guest-runner /path/to/actual-guest-runtime`, `--guest-runner-sha256 <64-hex>`, and any necessary repeated `--compiler-arg` or `--guest-arg`. A draft-profile case also requires explicit `--allow-draft-profile`; the source's first line already chooses the temporary migration profile, so **do not redundantly add** a conflicting `--ownership-profile` flag.

The runner verifies both the compiler and fixture checkout Git HEAD/root tree before running and checks source integrity. The runner checks source Git HEAD and root tree, verifies the compiler binary's SHA-256 on Linux, verifies the selected fixture and contract manifest against their **independently expected Git blob SHAs**, confirms the on-disk manifest equals the compile-time embedded manifest, then compiles the selected source with an isolated `-o` destination, and checks the intended semantic diagnostic **and zero artifact** for negatives. For positives it demands a nonempty generated guest and actually invokes the supplied guest runtime, requiring exit code 42. It does **not** infer the correct Wasm runner from the backend, and it does **not** validate compiler provenance from a claimed SHA alone: the person invoking it must build the exact compiler binary from the verified tree and record that build receipt. A returned status of 2 indicates unsupported/unexecuted admission rather than a semantic compiler failure.

The included workflow only runs **host Rust unit tests** for this runner; it never substitutes those tests for a real configured compiler/guest invocation. An authorized, exact-tree carrier runner must supply the actual compiler artifact, runtime and reviewed command before backend conformance can be promoted.

## Initial backend execution status for these exact fixtures

| Backend | Initial status | Note |
| --- | --- | --- |
| Rust/browser compiler and generated Wasm | NOT_EXECUTED | Some narrower operations have separate verified evidence, not these fixtures |
| Independent Wasm backend | NOT_EXECUTED | Worker/actor semantics need independent compiled guests |
| Java / GraalVM Native Image | NOT_EXECUTED | Host JVM tests are not Native Image execution |
| LLVM native | NOT_EXECUTED | Needs compiled native guest and sanitizer/ownership checks |
| .NET Native AOT | NOT_EXECUTED | Needs published/native AOT executable evidence |
| Forge | NOT_EXECUTED | Needs independent compiler and runtime confirmation |
| Cranelift, JS, HDL and other declared targets | NOT_EXECUTED | Add rows only with independently proven target admission |

## Compiler-slice audit (updated 18 November 2026)

The *expected test verdict* is not a run result. The TSV's **admission** field now distinguishes candidate feature branches from other target-only fixtures:

| TSV operation | Admission | Exact evidence and remaining gate |
| --- | --- | --- |
| `implicit_borrow` (2 cases) | `PROFILE_CANDIDATE_DRAFT` | `atto-source.rs#346` head `d1b88b4e4feb3ba630465380de58eca390747a8a` has exact-head source-carrier evidence, but is **draft**; its temporary `// atto-ownership: borrow-default-v1` header must be on line 1 of each test source |
| `write_loan` (2 cases) | `PROFILE_CANDIDATE_DRAFT` | `atto-source.rs#347` head `e80e16987d71246d1f8839eccb85b0b52f867985` adds `fnc update(mut Counter p)` and `update(mut counter)` under the same temporary opt-in, and remains **draft/stacked** |
| `copy_deep` (2 cases) | `COMPILER_CANDIDATE_MERGED` | `atto-source.rs#265` **merged**; only verified **flat scalar-field class** deep copies are admitted. Positive fixture changes the cloned object's field then checks the source stayed `42`; negative checks `E_BORROW` on copying with a live exclusive loan |
| Other 34 cases | `TARGET_ONLY` | No general compiler admission is inferred. Some tests require future grammar/library APIs, actor-local graph cloning, pointer region types, named lifetimes or suspension proofs |

**Candidate is NOT passed.** The `backend_status` column remains `NOT_EXECUTED` for **every case**. Running the Rust schema validator proves neither compiler admission nor guest behavior. The actual test runner must select the **exact compiler version/profile**, prove each expected rejection is not a lexical/parser surrogate, run guest positives (exit 42) and pin the entire source and artifact digests. Neither a PR #346 carrier receipt nor a merged #265 receipt automatically applies to the new fixture bytes in PR #80.

The known compiler-profile examples were aligned with source fixtures in compiler #346/#347 and the accepted flat-class copy path from compiler #265; they include `expect-exit` / `expect-error` headers. The remaining target-only fixtures are **not** yet executable compiler conformance tests and must stay excluded from admission counts until their precise grammar and backend witnesses are reviewed.

## Target-only fixture integrity audit

The following **source defects were corrected** without claiming execution or new backend support:

- `actor_state` now uses a declared `ActorMail<int>` handler instead of undeclared `Increment`/`Read`, and explicitly exercises the guarded state callback. The intended negative still writes through `critical-read`.
- `actor_handoff` declares the receiving actor and the typed class-message handler. The intended negative passes an actual live borrow into the mailbox rather than failing name resolution.
- `suspension` now declares the actor used by `await spawn`; the positive loan ends inside a block, and the negative loan remains live across the await.
- `pointer` uses a `Result<int, PointerError>` function for `?` and an explicit `main(): int` result match, as proposed in `atto-spec#18`. The exact fallible API remains **unratified**, so this is still not an executable compiler test.
- `weak` creates a stable owner before borrowing and upgrading, so its provenance negative cannot pass merely by rejecting a borrow of a temporary.
- `lt_binder` now actually calls `choose_left` with two distinct owned inputs and observes the returned borrowed view; a function definition left uncalled would not test runtime/provenance behavior.

These changes remove obvious *extraneous* errors but do **not** prove grammar admission, runtime semantics or backend support. The `deep_graph` target pair remains blocked on the specification and implementation of legal cyclic/repeated mutable-alias construction and the verified copy memo; simply compiling a shallow `Array` expression must not be misreported as deep-copy graph conformance. The actor-state, async, pointer and weak candidates likewise remain `TARGET_ONLY` until their accepted surface syntax and compiled witnesses are established.

## Source limitations and test design notes

Some target snippets intentionally exercise language constructs not yet known to be admitted together by current parsers: `Pointer<T>` allocation effects, named `lt!` binders, actual cycle builders, `weak!.upgrade`, `pin!` actor handoffs, out-of-line state callbacks and `await` while an owner is live. They are **acceptance targets**, not claimed runnable test artifacts. Before promoting any case to `EXECUTABLE`, implement or revise its precise accepted grammar; maintain at least one wrong-capability negative in the same feature family. Do not modify an expected failure into a different, easier parser failure to get a green result.

This integration registry is **additive** to existing conformance PRs #74 (implicit borrowing), #64 (copying) and #76 (ownership capabilities). It does not replace their fixtures, introduce Python, or assert that their own tests executed. Future work should integrate approved fixtures, migrate existing Python contract tests to Rust with parity, and update the matrix by evidence rather than by assumption.
