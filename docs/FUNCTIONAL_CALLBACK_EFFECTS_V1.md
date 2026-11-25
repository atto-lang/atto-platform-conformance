# Higher-order functional callback effects: conformance v1

**Status:** proposed cross-backend contract and source-only host reference oracle.
**No real AttoLang compiler, interpreter, native AOT artifact or guest program
was executed by the checked-in Node test.** Backend statuses remain NOT_EXECUTED.

## Motivation

AttoLang functions such as `map`, `filter`, `fold`, `flat_map`,
`and_then` and user-defined higher-order functions inherit the **resolved
callback's** effects at each invocation. They do not assume all callbacks are
pure or all callbacks are impure.

The first Java compiler follow-up now includes a checked-source callback
analysis API and real `.atto` fixtures in draft PR #3081. This remains
**partial compiler integration**, not a new user-visible syntax, an implementation
of generic collection combinators, or verified native backend support.

## Contract

`contracts/functional-callback-effects-v1.json` specifies seven cases:
1. Pure callback to `map`: allowed allocation effect, no I/O.
2. I/O callback to `map`: rejected when invoked under the pure effect bound.
3. Unbound callback: always produces `UNKNOWN_CALL`.
4. Same-named function: does not accidentally satisfy a callback formal.
5. Mutually recursive callback: transitive I/O is preserved.
6. Trapped callee: erases only ordinary `THROW`, not `PANIC`.
7. Unresolved imported callback: `UNKNOWN_CALL`, never implicitly pure.

`tests/functional-callback-effects-v1.test.mjs` is a Node reference model
to catch accidental changes in this manifest. These tests are useful contract
and test-inventory checks **but cannot certify an Atto compiler**.

## Source-first implementation sequence

- **Java:** use the compile-time `EffectContracts` callback-slot API (draft
  PR #3081), connect resolved callable arguments and method references to the
  compiler's existing type/effect pipeline, and add positive/negative `.atto`
  guest fixtures. Host graph tests alone do not prove guest capability.
- **LLVM:** preserve the callback effect row during HIR/MIR lowering; reject
  unverified dynamic call targets before native code generation.
- **.NET:** generate statically resolved callback targets and effect descriptors
  compatible with Native AOT; no reflection-based purity inference.
- **Wasm:** verify compiler-emitted wasm32 guest calls instead of a JavaScript
  shadow interpreter. Keep host worker/capability handling independent.
- **Forge:** verify both the compiled guest call path and separate independent
  Forge/Cranelift claims, without assuming one certifies the other.

When the frontend supports source-level `pure` and typed callback effects,
publish actual `.atto` acceptance and rejection fixtures, immutable Git blob
IDs, exact compiler commit and toolchain identities, nonempty CI job steps,
diagnostic assertions, guest outputs, and proof that rejected programs emitted
no executable artifact.

## Safety requirements

No automatic closure sharing across actor boundaries, no suspending or
effectful callback under sealed-state critical locks, no hidden writes through
captures, and no impure user code concealed by `trap`. Lazy iterator fusion
must preserve evaluation, ownership-drop and effect order.

The contract's `receipts: []` is deliberate. Do not change backend status
to PASS based on this document, a source-only fixture, a host oracle or a
zero-step CI workflow.

## Canonical source-level fixtures

The manifest also pins these five Git-blob-identical `.atto` guest inputs
on the Java and conformance branches:

| ID | Expected compiler/guest behavior |
| --- | --- |
| `inline-option-map-pure` | Typecheck; Graal guest stdout `42` |
| `typed-helper-unresolved-purity` | Typecheck; conservatively `UNKNOWN_CALL` |
| `wrong-callback-result` | Semantic type rejection, no executable artifact |
| `value-match-pipeline` | Typecheck; functional `|>` in exhaustive value match, stdout `42\\n0` |
| `nonexhaustive-option-match` | Semantic rejection of missing `None` arm |

`tests/functional-callback-effects-v1.test.mjs` verifies the exact Git
blob SHA-1 for each `.atto` source and rejects a one-byte mutation or
symlink substitution. That **does not** execute Java/LLVM/.NET/Wasm/Forge
compilers and does not advance their status above `NOT_EXECUTED`.

The Java regression suite now includes an actual Graal `Context.eval`
assertion for the positive guests, but that JUnit test is **authored,
not yet observed passing**. An eligible native runner must execute tests
with immutable tree/head evidence and nonempty job steps before any
support or parity claim.
