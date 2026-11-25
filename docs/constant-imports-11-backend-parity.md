# AttoLang typed-constant import parity ledger — all 11 compilers

**Status: TARGET / NOT_EXECUTED, not green parity.**
Source of truth: `contracts/constant-imports-v1.json`, companion
`atto-spec/language/constant-imports-v1.md` and
`atto-spec/language/file-module-const-v1.md`.

## Semantics required across compiler profiles

- `define const` and `define pub const` are immutable declarations at
  namespace/file scope. Top-level mutable bindings are forbidden.
- `import const a, b as other from "std.http";` is a typed export filter.
  `"./file.atto"` is a file selector. Explicit `from pkg "std.http"`
  is equivalent to the dotted package/namespace selector.
- Verify exact source-unit identity, package/namespace export kind, public
  visibility, type, alias collisions and ownership before execution.
- Ordinary closed constexpr expressions are folded deterministically with
  overflow/cycle checking. `std.env.read_env("KEY")` and legacy
  `os.read_env("KEY")` are **runtime-startup-once exceptions**, never
  constexpr or compiler-host environment reads.
- The standard environment accessor must be identified by the authenticated
  standard namespace and a permission capability, not a spelling-only match.
  An unsupported provider must fail closed. No secret is logged or embedded.
- Each declared environment-backed field is evaluated once per program/
  isolated deployment unit; two independent fields reading the same key do
  **not** imply one shared host API call. Re-importing a declaration performs
  no new initializer invocation. Reusing a compiled AOT artifact with another
  launch environment observes the new launch snapshot.
- Compiler-owned `.atto` core/alloc/std implementations may differ by
  backend. Maintain a compatible public contract, not byte-identical source.

## Compiler implementation audit (22 Nov 2026)

| Repository | Current scoped work | Exact verified guest parity |
| --- | --- | --- |
| `atto-source.rs` | [PR #551](https://github.com/atto-lang/atto-source.rs/pull/551): parse-only dotted const selectors plus bounded *candidate* executable one-hop relative scalar literal importer; callable/namespace providers and wrong-kind diagnostic hardening; environment startup still unsupported | **NOT_EXECUTED** |
| `atto-source.java` | [PR #686](https://github.com/atto-lang/atto-source.java/pull/686): static const folding, import graph, typed `import const` syntax/aliases and public-kind preflight added; deliberately rejects runtime value linkage until typed import/initializer exists | **NOT_EXECUTED** |
| `atto-source.llvm` | [PR #604](https://github.com/atto-lang/atto-source.llvm/pull/604): logical source identity and newly recorded typed-const selections; parser and source loader deny LLVM IR until typed value/link startup semantics exist | **NOT_EXECUTED** |
| `atto-source.net` | Evaluate existing import/constant AST and add native AOT, same-image two-startup test | **NOT_EXECUTED** |
| `atto-source.forge` | Add typed export linkage and JIT/AOT cold-start equivalence checks; no ambient env read during compilation | **NOT_EXECUTED** |
| `atto-source.wasm` | Add independent browser/Node worker import linker and explicit permission-supplied env provider | **NOT_EXECUTED** |
| `atto-source.cranelift` | Add typed const resolution and native object startup-initializer gate | **NOT_EXECUTED** |
| `atto-source.js` | Add static source-unit export graph and immutable once-per-isolate env snapshot | **NOT_EXECUTED** |
| `atto-source.hdl` | Define freestanding/no-host-env support boundary; either target-provided authenticated build/runtime provider or explicit unsupported rejection | **NOT_EXECUTED** |
| `atto-source.atto` | Self-hosted bootstrap: prove import constant semantics without requiring identical library source or recursive compiler initiation | **NOT_EXECUTED** |
| `atto-source.realtime` | Only pre-critical-startup environment admission; prove no late read, allocation or scheduling in critical code | **NOT_EXECUTED** |

The table describes source/PR scope, **not** confirmed execution. Existing
Java work in PRs #683/#673 and LLVM macro-import work in #619 overlap; merge
by a reviewed source-owned DAG, not by overwriting branches.

## Structural receipt checker — never automatic certification

`lib/constant-import-evidence-v1.mjs` and
`tests/constant-import-evidence-v1.test.mjs` reject a forged PASS when the
source SHA/tree, selected CI job, material checkout/compile/guest steps,
all 27 case receipts, negative zero-artifact proofs, per-declaration
initializer invocations or same-AOT two-launch artifact digests disagree.
The receipt uses only `PASSED`, `FAILED`, `UNSUPPORTED` and `NOT_EXECUTED`
as backend/case execution statuses. A candidate `PASSED` must also pin an
independently selected compiler SHA-256, toolchain version, target, source
commit/tree, immutable registry Git blob SHA and per-case SHA-256 manifest
that covers the complete inline `.atto` fixture, launch inputs and oracle.
A `PASSED` report with a mismatched fixture, compiler or target is invalid.
`STRUCTURAL_REVIEW_REQUIRED` is a validator classification, **not** a release
status.

Even a complete, synthetically well-formed receipt returns
`STRUCTURAL_REVIEW_REQUIRED` with `releaseQualified:false` and
`guestParityCertified:false`, **never PASS**. Its runner/job/step fields
are untrusted input until an independent reviewer fetches them from an
authenticated CI API and compares the exact Git tree, blob SHAs, and actual
compiled guest binary and logs. Source-free or zero-step statuses remain
`NOT_EXECUTED`. Tests of this checker are host-only, not compiler guests.

## Promotion and backend evidence requirements

For each backend, attach a report bound to the **exact latest source head/tree**:
the toolchain/compiler, target triple, source file bytes and normalized paths,
material workflow step records, compile exit, emitted artifact hash, guest
execution exit/value and required diagnostics. Zero-step Actions results,
metadata-only test plans and skipped guests must remain NOT_EXECUTED.

For environment-backed fixtures, execute the **same AOT artifact twice**
with two distinct launch environments, verify isolation and permissions,
then assert imported immutable aliases never trigger another host read.
Negative tests must leave **no** executable, LLVM IR, object or guest output
behind. JVM/Graal Native Image, LLVM/Clang and .NET NativeAOT need actual
artifact-level evidence; Rust's browser compiler must instantiate generated
Wasm. Run native sanitizers where supported.

Source runner recovery: first check source-local runners. An alternate
private carrier needs an independently approved export policy for the
source and immutable destination repo ID, verified reader/access/retention,
exact Git tree/individual blob SHA validation and source-free runner
capacity evidence. A source-free runner success does not grant export
approval. Never mirror source from a repository whose allowlist is empty or
whose guard explicitly denies that destination. A read-only token-free
Git-tree mirror **is still a source transfer**.

### Recommended gates

1. **Milestone A:** Rust/Java/LLVM parser and typed-kind negative gates
   stepfully run and reviewed without host-environment baking.
2. **Milestone B:** Java/LLVM/Rust file and dotted namespace *value* linker
   with public immutable exports, cycles and exact source identity.
3. **Milestone C:** Standard `std.env.read_env` startup-only representation
   and permission gate in hosted targets, with strict freestanding denial.
4. **Milestone D:** Implement same observable contract in .net, forge, wasm,
   cranelift and js; separately attest .atto, realtime and hdl profiles.
5. **Milestone E:** All 11 backend statuses promoted only from independent
   exact-head material guest evidence, with no false positive or waiver.
