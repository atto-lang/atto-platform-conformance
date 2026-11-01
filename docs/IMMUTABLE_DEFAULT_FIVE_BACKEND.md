# Immutable-by-default bindings: five-backend admission and guest evidence

**Not a parity certificate.** Shared language proposal:
`oreslang-common-source#203`. Candidate implementation:
`oreslang-source.cranelift#21`. Java scalar inference tests:
`oreslang-source.java#2405`. LLVM scalar inference/cast compiler:
`oreslang-source.llvm#1256`.

The new `contracts/immutable-default-v1.json` pins **30 actual .ores
source files** (11 intended successful guest programs, 18 intended
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
