# Core types v1 — cross-backend source-only contract

Nine independent draft `atto-source.*` PRs stage `core/types.atto` with scalar value-width constants, signed-i64 extrema and checked range admission for signed-int inputs. All source file Git blob SHA-1s, exact PR heads and guest fixture SHAs are recorded in `contracts/core-types-v1.json`.

`node tests/core-types-v1-source-model.test.mjs` verifies the source ledger and BigInt boundary oracle, **not** the actual AttoLang compiler, linker, guest runtime or AOT. The portable positive and negative fixtures currently live in the backend PRs. The positive fixture must link `core/types.atto` and return 0; the negative fixture must reject a `void` local without an artifact.

A `passed` status can be recorded only after actual compiled guest execution or compiler negative diagnostic, pinned to the **current** head and target/toolchain, with nonzero runner steps. Zero-step GitHub Actions failures are `NOT_EXECUTED`. No cross-org private source export was performed.

This registry does **not** claim first-class `Unit`, opaque `TypeId`, metadata `TypeInfo<T>`, ABI layout or real sized integer type support. Those require compiler changes. The backend-owned `.atto` source remains independent; this is a shared behavioral registry, not a canonical implementation.

## Expanded test suite (2026-11-22)

Every compiler PR now contains `tests/core-types-source.test.mjs`, which parses a deliberately restricted form of the real `.atto` function bodies and checks i64/unsigned range predicates against a BigInt boundary oracle, including values beyond IEEE-754 safe integers. The oracle has mutation controls (shifted endpoint, changed visibility, duplicate export, hosted import) and is explicitly **SOURCE_ONLY**, not compiled guest execution.

The shared `contracts/core-types-v1.json` pins the positive fixture, **eight compile-negative fixtures**, and source-model test Git blob SHAs at the current nine compiler PR heads. Java, LLVM and Rust include additional compiled guest test gates; the other backends currently stage source-only checks and fixtures, without pretending their subset compilers support the import/linker path. All nine compiled guest statuses remain **NOT_EXECUTED** until exact-head stepful test evidence exists.

## Second 63-case compiled-guest fixture

All nine independently owned backend branches now pin the same edge-matrix-positive.atto input and BigInt source-model test. Java, LLVM, and Rust must compile and execute two actual .atto guest programs, plus reject four negative fixtures. Neither source-only nor zero-step CI is compiled-guest evidence.

## Private carrier approval boundary

The Java source repository .github/private-ci-approved-repositories.txt has no active approved destination, and its .github/private-ci-approved-source-snapshots.txt does not approve the present core/types heads or carrier. The two source-free candidate carrier probes both had zero executed job steps. No private Git tree or source was exported. Before any transfer, an independent trusted reviewer must approve the exact source commit/tree, approved private destination numeric repository ID, readers, retention, and export guard. Current source export disposition is DENIED_UNAPPROVED.

## Typed public ABI negative cases

All nine independent core/types branches now stage six compile-negative .atto fixtures, adding bool-as-int invocation and an unsigned 64-bit literal outside the signed int input domain. Java/LLVM/Rust actual-compiler checks are updated to reject those without artifacts. Because the candidate private CI carriers recorded zero runner steps and the Java source export policy has no current approved destination, the compiled guest and negative rejection statuses remain NOT_EXECUTED. The source-only registry cannot promote them.

## Namespace-only implementation (November 22, 2026)

All nine backend-owned `core/types.atto` files now start (after comments) with the canonical `use namespace types;` header. Public functions are top-level `pub fnc` exports; no enclosing `define module` exists. The `import * as types from "../../../core/types.atto";` in positive guests is an explicit static source import, not a side effect of namespace declaration. This is distinct from directory-derived namespaces, whose source-path rules require compiler support and are not asserted here.

Two new negative cases reject duplicate and post-import namespace headers. The registry now pins eight negative fixtures. The source-only registry uniqueness assertion was fixed from a stale hardcoded 4 to `negatives.length`. Real compiler/parser and executable guest parity remain NOT_EXECUTED while runner admission and source-export authorization are unresolved.

## Source-free private runner recovered; export still denied

On 2026-11-22 the dedicated private carrier `sonus-auris-test/atto-ci` (numeric repository ID `1458331448`) ran the isolated [source-free canary](https://github.com/sonus-auris-test/atto-ci/actions/runs/45049791824) at commit `03582de5b7ef636d3e80adf3637f84f1545e85c9`, with **four recorded executed steps** and success. That is real runner-admission proof for a tiny Linux job, not proof of budget for Java/LLVM full builds.

The Java source's protected export allowlist remains empty and no independently approved exact source-head/tree/destination snapshot exists. **No private source or Git tree was transferred.** The new Rust import-linker validation explicitly supports namespace headers in independently authored imported `.atto` files, retaining E_DUPLICATE/E_SYNTAX/E_NAMESPACE_DEPTH rejection, and is staged with compiler-backed tests. Those tests remain NOT_EXECUTED until admitted to a runner. The shared registry now records the latest Rust and Java draft heads and both the stepful source-free control and the authorization denial.

## Native LLVM function-only namespace parity

The native LLVM C++ compiler's currently executable file linker accepts explicit `import fnc ... from "relative.atto";` but not the wildcard-binding syntax used by Java and Rust. The LLVM branch now allows a **file-scoped namespace header only for ordinary function-only linked units** and retains fail-closed rejection for unverified package namespace imports and cross-unit nominal types. Its two guest fixtures select all 13 functions by name and retain exactly 63 boundary assertions. The three source fixtures containing file-import statements that otherwise would have been rejected by syntax were rewritten to use supported imports; their blob SHAs are separately recorded under `backend_specific_guests.llvm`. This is backend-local fixture representation, not a change to public scalar semantics. The real LLVM compiler and native guests still require stepful CI before any `PASS` status.

## Additional namespace/header and private import admission audit (2026-11-22)

At exact Rust PR #532 head `a4cdd0d342fc53732a44fd63c0131097fdcbdf86`, the one-hop importer validates the **original** file before stripping import statements, preserves source namespace identity when injecting compiler-generated private modules, and rejects duplicate/late headers, private/missing exports, forged internal symbols, path traversal, and binding collisions. Nine compiler-backed Rust tests are staged, **NOT_EXECUTED**.

At exact LLVM PR #866 head `cdd8bc29b42878bab41038a3beb2e0380b93c0c7`, the native parser now accepts an optional source namespace header **before imports only**, and emits explicit `NAMESPACE_HEADER_ORDER` or `NAMESPACE_DUPLICATE` errors. Native guest negative-test gates require the corresponding diagnostic code, not merely any failing exit status; compiled O0/O2 guest execution remains **NOT_EXECUTED**.

The independent GitHub source check inspected eight Rust and seven LLVM code/test properties (15/15 static checks), **not executable compiler tests**. The only stepful runner evidence is the four-step, *source-free* private canary on `sonus-auris-test/atto-ci`. Source allowlist/export approval is still missing: no private blobs or Git tree were transferred, no conformance guest PASS or merge claimed.
