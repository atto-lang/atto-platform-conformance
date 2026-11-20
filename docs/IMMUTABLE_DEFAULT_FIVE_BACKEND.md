# Immutable-by-default bindings: five-backend admission and guest evidence

**Not a parity certificate.** Shared language proposal:
`oreslang-common-source#203`. Candidate implementation:
`oreslang-source.cranelift#21`. Java scalar inference tests:
`oreslang-source.java#2405`. LLVM scalar inference/cast compiler:
`oreslang-source.llvm#1256`.

The new `contracts/immutable-default-v1.json` pins **32 actual .ores
source files** (12 intended successful guest programs, 19 intended
compile-time rejections, and 1 eager checked-overflow trap). The Node
contract test protects source-byte equality and checks 14 deliberate
manifest mutations. It does **not** invoke a compiler. The independent
Java and LLVM paths do not automatically enable the new type-first
`int x = 7` spelling.

| Backend | Current admission position | Required runnable proof |
| --- | --- | --- |
| Java / Graal | `const`/inference draft; new typed-default spelling not proven | parser + type/ownership errors + JUnit actual guest results |
| LLVM | staged native scalar inference/casts; typed-default not verified | real source-to-LLVM IR, Clang-linked binaries, checked negatives |
| Wasm | LLVM native compiler delegated; only narrow import-free guest ABI | pinned LLVM frontend, Wasm emission, validation and actual guest outputs |
| Cranelift | draft int-only native SSA/JIT implementation | `cargo test --locked --all-targets`, exact CLIF and native results |
| .NET | shipping scalar compiler has no local declarations; structured path experimental | verified structured CIL + exact-head Native AOT execution, no JIT fallback |

**Never promote** a backend based on parsing, host-only tests, a
source-grep/source manifest, generic parser failure for a negative
semantic case, or a failed workflow with `steps=[]`. A lexical
rejection of `int x` does not prove readonly enforcement; the
backend must first admit the declaration, then reject the assignment
for its actual resolved binding permission.

## Minimal exact-head matrix per backend

1. Pin source repository, commit/tree, compiler binary SHA-256, runner/job
   identity, executed steps, and compiler version. Require policy-authorized
   private build; do not export private source across organizations.
2. Compile+execute IDB-01..06 and IDB-21..25 as guest programs with typed return and
   exact value receipts (not only OS process exit truncation).
3. Reject IDB-07..16, IDB-18..20 and IDB-26..30 with **compiler-owned semantic reason**,
   meaningful source location, no emitted executable and no crash/timeout.
4. Compile IDB-17, then execute and prove a checked arithmetic failure
   even though `unused` is not read (eager initializer semantics).
5. Compare emitted semantics between Java, LLVM, Wasm, Cranelift and
   .NET at the *common supported feature slice*. Mark unsupported
   targets explicitly; never substitute fake or interpreter receipts
   for a native guest run.
6. Re-run on the final exact reviewed tree, with independent approval
   and required protected-branch controls before declaring parity.

`node --test tests/immutable-default-v1.test.mjs` checks the
**manifest and fixture integrity only**. It is safe to run without
compiler dependencies, but a pass does not count as compiler execution.

Additional deeper test targets: field/index writes, mutating method
receiver, closure captures, pattern bindings, definite assignment,
nested types, actor `handle_state`, message Sendability, pure effects
and `rt mut borrow` lifetime crossing await/cancellation. These need
backend capability support; they are not covered by the 18 scalar cases.

### Compatibility correction

Java `docs/LANGUAGE.md` defines standalone `const` as a compile-time
constant and `val` as runtime single-assignment. IDB-19 and IDB-20
explicitly reject runtime-dependent standalone `const` initialization;
the new type-first `int x = e` is a readonly **runtime** binding.
This distinction is essential when inspecting inference drafts in Java,
LLVM and .NET. IDB-17 uses `int unused = ...` deliberately: an
unused runtime initializer must still eagerly execute and trap on overflow.

### Expanded functional / compatibility cases

IDB-21..25 probe readonly boolean inference, multi-hop constexpr values,
existing `val` single-assignment, explicit `let` rebinding, and nested
lexical shadowing. IDB-26..30 add boolean rebind/type confusion, explicit
const rebinding, definitely initialized locals, and mutable borrow rejection.
These are **target conformance source files** and may be unsupported by
individual frontends; only real compiled guest results and semantic diagnostic
reasons on exact source trees may upgrade their statuses.

## November 1 exact-byte readback and implementation PRs

Read back all 32 Oreslang fixture files through the connected GitHub API on
this draft branch and compared their UTF-8 contents byte-for-byte to
`contracts/immutable-default-v1.json`: **32/32 identical**, with no duplicate
case IDs or paths. This is a source-integrity check only. It does NOT prove
Node suite execution, parser/type checking, native guest execution or CI.

Actual additional compiler branches under review:
Java #2414 (scalar type-first parser + type/borrow JUnit fixtures),
LLVM #1266 (stacked native lowering + Rust/Clang real guest CTest),
.NET #298 (stacked readonly structured CFG/CIL),
Cranelift #21 (native JIT scalar slice), Wasm #227 (LLVM-to-Wasm real
execution gates). Keep these separate from the parent inference/cast drafts
Java #2405, LLVM #1256 and .NET #282 until reviewed reconciliation.

Where a test duplicates an existing semantic scenario, do not double-credit.
Orphan/overlapping source fixtures from concurrent changes were removed; the
manifest's final 32 source entries are authoritative on this draft head.

### Reconciled current-parent implementation branches (Nov 1)

The active newer compiler validation branches are **Java #2449**, **LLVM
#1301**, and **.NET #333**, stacked on parent scalar-inference PRs #2405,
#1256, and #282 respectively. Their initial conflicting children (#2414,
#1266, #298) were closed *unmerged* when their parent code was found to
already implement the type-first parser path. The new branches preserve parent
parser changes rather than overwriting them.

LLVM #1301 uses Rust for a real compiler→Clang→native guest test with
20-second subprocess timeouts and 1-MiB output caps; assignment/duplicate
negative tests require matching semantic diagnostics. Java #2449 executes
GraalVM guest programs including a helper-produced runtime initializer.
.NET #333 introduces distinct runtime-`Readonly` HIR metadata in its
experimental structured compiler, retaining separate `Const`/ `Val`/`Let`.
Wasm #227 and Cranelift #21 remain separate draft gates. None of these has
an admitted *stepful, exact-head* execution result at this writing.

**Important:** merging the parent or passing a source-only conformance manifest
is not enough. Verify guest execution and the real mutable-`let` positive
control on each backend, otherwise a parser that rejects all assignments can
falsely appear to enforce immutable bindings.

### Private exact-tree carrier readiness audit — November 2, 2026

Security review requested at
[`canonical-cloud-test/readiness-edge-e2e#39`](https://github.com/canonical-cloud-test/readiness-edge-e2e/issues/39).
A recent stepful job in this **private** carrier repository confirms that some
hosted Actions jobs have run there, but not that the present Actions budget is
available for a new compiler job. Source CI sampled on LLVM #1301 has **zero
executed steps**; it cannot be counted as a compiler pass.

Exact source heads and Git root trees inspected using the GitHub API:
- Java #2449: head `45bea9a3672f322fd1658373006d157fa6e2f84f`,
  tree `3bd262cc02dfa182f7d7a84f5f0e343ac6e39df6`,
  **1,195 regular files**, 11,273,804 bytes, untruncated.
- LLVM #1301: head `da676e954b9b134a0af0e2d336fda5e1422fae38`,
  tree `be1325e23b6d9fad78b8a6a1be35382a9bd6ad96`,
  **1,322 regular files**, 6,901,404 bytes, untruncated.

The reviewed carrier's existing max of **1,024 source files** rejects both,
even though both fit its **40 MiB total** and **10 MiB per-file** caps.
A source-free proposal raises the count cap to 1,536 only, adds strict
1,536/1,537 boundary regression coverage, and offers SHA-pinned test plans for
the *current* Java and LLVM PR heads. These are **proposed**, not merged.

The carrier verifier, reviewed test-plan files and associated sandbox controls
are CODEOWNERS-protected. Independent approval is necessary before changing
the trusted carrier, and no private source transfer may bypass review,
authorization, or platform safety restrictions. No cross-org checkout token
or secret may be passed into the test org. An exact-tree Git mirror must
preserve tree/blob IDs, use a private destination, create an expiring
single-use receipt, run only preapproved commands, and delete temporary refs.
Until then, **no source mirror was created and no compiler guest pass exists**.

The local source-free synthetic boundary audit passed 1,536 regular files,
rejected 1,537, and rejected a symlink. This is not an Actions, compiler,
NativeAOT or Wasm guest test. Retain draft/non-verified release classification.

### Exact-tree private CI plan hardening — November 2, 2026

LLVM [#1301](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1301)
advanced to `e107ef81a1335c65f4b63a9b89a3f5efc3ee3cbc`,
source root tree `6d07b5cfd052bb3baa0f2c03dfcdc6a72834cd34`.
The native Rust guest harness now monitors compiler/linker/guest stdout and
stderr size **during** the 20-second child lifetime, terminating oversized
writers early and rejecting monitoring errors. Its 1-MiB cap is sampled, not
a kernel-enforced disk quota; retain carrier sandbox resource budgets.

An additional source-free audit of the private carrier identified that its
reviewed test plans constrain repository and PR number, but the current
verifier does not independently bind the **approved source head and root tree**
to a trusted test-plan entry. Proposed review-only patches add
`required_source_head_sha` and `required_source_tree_sha` to the Java
#2449 and LLVM #1301 plans and check these at source verification,
dependency preparation and sandbox execution. Local adversarial tests reject
forged/missing head or tree pins and stale blob pins. These checks alone do
**not** authenticate the source organization or authorize transfer.

Security review [carrier #39](https://github.com/canonical-cloud-test/readiness-edge-e2e/issues/39)
remains open. Carrier and compiler `main` branches lack enforced protection;
an independent source-transfer approval has not been recorded. The latest
sampled LLVM head Actions jobs still report no executed steps. No private
source tree was exported, no compiler-backed guest execution was observed,
and all compiler parity claims remain **unverified**.
