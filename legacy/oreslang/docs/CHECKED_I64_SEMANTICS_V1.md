# Oreslang signed-i64 checked arithmetic — portable language contract v1

**Status:** candidate authoritative contract, review required; **not** an
executed Java/JavaScript/LLVM compiler-parity certificate.

This contract resolves the mismatch between the JavaScript backend's
`signed-i64-checked-provisional` Program IR and historic unmarked
Java/GraalVM `long` wraparound paths. The checked behavior is the proposed
portable Oreslang default. A backend that still wraps is **nonconformant**
for these fixtures, not implicitly grandfathered into a passing result.

## Domain and literals

* `int` is signed 64-bit, range
  `[-9223372036854775808, 9223372036854775807]`.
* Decimal digit separators may be used only according to the separately
  versioned lexer grammar; they do not change numeric range.
* `-9223372036854775808` is legal as a single directly signed
  literal, even though positive `9223372036854775808` is illegal.
  `-9223372036854775809` and positive values above the maximum are
  **compile-time** `integer_overflow` diagnostics.
* Unary negation of an **already evaluated** `INT64_MIN` value is
  arithmetic overflow, not a special literal case. For example,
  `-(-9223372036854775808)` must fail rather than wrap.
  Parentheses and source syntax may not silently change a valid negative
  literal into invalid positive-literal parsing.

## Arithmetic

* Binary `+`, `-`, `*`, and unary arithmetic negation calculate with
  unlimited *mathematical intermediate precision* for range checking,
  then produce a signed-i64 value only when within bounds.
* Every evaluated arithmetic node must check its own result.
  `(INT64_MAX + 1) - 1` fails at the first addition; cancellation,
  later casts, optimization, vectorization, LLVM nsw flags or JS BigInt
  narrowing must not mask that failure.
* `a % b` uses truncation-toward-zero quotient semantics for a nonzero
  divisor; the remainder has the dividend's sign (or zero). Specifically
  `INT64_MIN % -1 == 0`. `a % 0` fails as `division_by_zero`.
* **Existing language typing is preserved:** Java's `int / int` currently
  promotes to a floating-point result and the JS int-only slice rejects
  this operator. This document does **not** unilaterally redefine `/`
  as integral division. The conformance oracle defines a separate
  abstract `div_trunc` operation for any *future explicit integer-quotient
  primitive*: truncate toward zero, fail on zero divisor, and fail
  `INT64_MIN / -1` as integer overflow. No backend may claim that
  abstract case passes until an explicit source-language mapping exists.
* Two's-complement wrap is **not** the default and cannot be selected
  by ignoring an integer model tag. Any future wrapping operation must
  have an explicit, separately typed/named opt-in contract.

## Error phase and cross-backend classification

* A source integer literal outside the signed range is rejected during
  compilation with category `integer_overflow`.
* An ordinary arithmetic expression that overflows during execution
  fails with category `integer_overflow`; a zero divisor fails with
  `division_by_zero`. Backends may use distinct native exceptions,
  but evidence adapters must normalize them from **observed real guest
  behavior**, not from hand-authored JSON.
* Optimizers must preserve evaluation ordering and cannot silently elide
  a failing evaluated subexpression. A compile-time optimization may
  diagnose provable failure only if the standardized phase contract for
  that expression is explicitly updated and versioned for **all**
  backends.
* Error strings, Java exception names, process return codes, and host
  signals are not interchangeable with normalized guest error category.
  The parity runner must separately retain original diagnostics, stdout,
  stderr, runtime exit and signal information.

## Version and migration

`checked-i64-v1` is a **new** portable semantic authority candidate,
not a reinterpretation of `scalar-int64-v1` in draft conformance PR #71,
which describes the observed historical Java wrapping reference.
The JS Program IR's provisional tag should map to this contract only
after peer review; do not silently reuse or re-label existing artifacts.

The data-oracle vectors in `fixtures/checked-i64-v1.json` and
`src/checked-i64-oracle.mjs` validate the *mathematical contract only*. The fixture bytes are pinned to Git blob `44224caf6f6c76dedff429a47d51edc926830fdc` and the test suite independently checks every `guestSource` against a deterministic Oreslang source renderer. Source/AST divergence is a test failure. The oracle's `evaluateCheckedI64Json` entrance accepts bounded canonical JSON strings; arbitrary live objects and Proxy traps are not a safe cross-boundary input format.
They do not execute any Oreslang compiler or establish Java, LLVM or Node
backend parity.

## Transitional exact-source interop (Java PR #956)

Java PR #956 still preserves wrapping arithmetic for **unmarked** Oreslang
source. It enables experimental checked arithmetic only when the exact first
line is `// oreslang:checked-i64-v1\n`. That is **not** portable checked-by-
default semantics. Java's checked overflow marker is currently host-side
`ORES_I64_OVERFLOW`; guest Error, actor supervision, and complete checked
ABI parity remain open.

`renderCheckedI64GuestSource(expr,'portable-default')` emits the unmarked
candidate default form. It must **not** be counted as passing on the legacy
Java runtime for overflow cases. `renderCheckedI64GuestSource(expr,'checked-i64-v1')`
prefixes the exact first-line directive and is the interim source profile for
a Java ↔ JS checked-semantics test. Java and JS must receive **identical
rendered bytes** (the JS lexer accepts line comments). The runner must not
secretly prefix only Java and claim to have executed the same source. The
fixture suite checks both source forms against the exact AST and pins the
base fixture Git blob.

Passing the opt-in profile is not sufficient to claim the eventual unmarked
portable default. The two profiles require separate execution receipts,
versioned semantic status, and distinct CI gate names. No profile switch may
silently fall back to legacy wrapping behavior.

## October 19 remainder and source-admission implementation

The **draft implementations**, not the production default, now encode one
explicit zero-divisor marker: `ORES_I64_DIVISION_BY_ZERO`. Java #956 admits
signed `%` in marked checked source and throws a dedicated provisional host
exception for zero divisors; JS #23 checks both signed BigInt operands before
remainder and throws a marked RangeError on zero. Evidence adapters may
normalize an **observed** marker to `division_by_zero` only after verifying
the running compiler and exact fixture; a marker on its own authenticates
neither guest execution nor the producer. This is not yet a shared
Oreslang guest `Error`/Throw ABI.

Java's common experimental HIR exporter does **not** currently admit `%`.
This is a Java **linked guest runtime** probe and a JS program-v2 guest
probe, *not* a common-HIR-to-MIR remainder conformance result. The Java
and JS compilers must also use the **same** checked first-line header
validation. The JS parser now rejects malformed, duplicated or displaced
markers (including CRLF and unsupported versions) instead of silently
ignoring them; block-comment lookalikes do not select a profile.

### JS checked overflow versus foreign host-type failure (Oct 19 hardening)

JS integration PR #23 now distinguishes two previously conflated failure
classes in the **provisional generated host runtime**:

* A `BigInt` mathematical result outside signed 64-bit range raises a
  `RangeError` bearing `ORES_I64_OVERFLOW:`. The numeric evidence adapter
  recognizes **only this observed marker** as a checked-overflow outcome.
* A non-`BigInt` operand arriving from host JavaScript raises a `TypeError`
  bearing `Oreslang signed i64 BigInt required`. This is a foreign interop
  type failure; it must not be relabeled integer overflow.
* Remainder by zero remains `RangeError` with
  `ORES_I64_DIVISION_BY_ZERO:`, after validating both signed-i64 operands.

These markers are **provisional host diagnostics**, not an authenticated
guest `Error` ABI, LLVM parity attestation, or substitute for observed
GraalVM execution. Changes to these codes require corresponding negative
interop tests and a reviewed semantic version policy before production.

Source-org Actions for these private repos have been failing before steps
execute. Local JavaScript V8 source-generation/execution checks cover all
16 Node numeric-boundary expressions and header rejections, but cannot
replace Node 22 CI, Java/Graal linked guest JUnit, LLVM native tests, or
source-to-binary provenance.

**Do not** promote `checked-i64-v1` to the unmarked Java default yet.
Java #956 also restricts non-i64 operations in the experimental marked
profile. A safe default rollout needs separate typing-aware work to
preserve floating `/`, string concatenation, complex arithmetic,
literal diagnostics, and all other non-i64 operations, plus migration
review and executed regression evidence. Treat the current checked
profile as a compatibility bridge, not an approved language-wide flip.

## Required real-compiler parity gate

1. Review and freeze the contract and fixture bytes/hash.
2. Build both exact pinned compiler heads under approved source
   confidentiality controls; record full Git tree SHA, compiler artifact
   hash, toolchain, provenance and executed workflow/job/step IDs.
3. Compile and **execute** identical source programs on Java/GraalVM and
   Node 22. Compare typed values, error category, error phase, raw
   diagnostics, process outcomes, and complete fixture IDs. Missing,
   unsupported or skipped cases fail the parity gate.
4. Extend independently to LLVM, including overflow trapping without
   undefined behavior or optimization removal.
5. Reject reports from zero-step jobs, mocks, source-free oracles, or
   structural-only JSON consistency checks as certification.
6. Do not export private source into another organization until a
   protected and reviewed policy authorizes the **immutable destination
   repository ID and exact source commit/tree**, including incident
   resume gates for conformance security issues #22 and #77. Destination
   privacy or prior runner success by itself never authorizes a copy.

Related: JS PRs #13/#19/#21/#22 and integration #23;
Java PR #956 (opt-in checked Java execution); conformance PR #71
(historic wrapping differential matrix).
