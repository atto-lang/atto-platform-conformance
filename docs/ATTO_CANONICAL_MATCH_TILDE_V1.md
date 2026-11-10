# Canonical AttoLang match and tilde literal v1: conformance targets

**DRAFT / SOURCE_CONTRACT_ONLY / NOT_EXECUTED / NOT_CERTIFIED.** Downstream of [common-source #254](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/254). The validator is **not** the AttoLang compiler. Passing the Node tests proves only manifest integrity and fixture Git blob identity.

## Canonical grammar

```ebnf
MatchExpr ::= "match" ["first"] ["<" Type ">"] Expression "over" MatchArm* DefaultArm? "end"
MatchArm ::= "on" Pattern ["when" Expression] "->" Body
DefaultArm ::= "default" "->" Body
```

Normal match requires provably disjoint exhaustive arms. `match first` allows ordered overlaps. `default` is unique, unguarded and final; `on default` is not canonical formatter output, but the legacy input alias is accepted and normalized when it is semantically equivalent. Preserve legacy forms only when they are truly semantically equivalent; do not silently change procedural `do match` return behavior.

`~(foo: value)` and `~record(foo: value)` are closed readonly records; `~(key => value)` and `~map(key => value)` are typed maps with **evaluated** keys. `~()` must reject, even in a typed context; explicit `~record()` or type-witnessed `~map()` disambiguates empties. `#symbol` map keys remain Symbols; no implicit String coercion. `struct{}`, `infer struct{}`, tuples, arrays, vectors, `record{}` and `Entry` remain distinct; no coercion or formatter rewrite of legacy syntax. A `structural` pattern uses only an authorized readonly visible-field view, never hidden actor state. `on ~map(...)` is reserved for the separate, not-yet-promoted map-pattern v2 extension.

## Fixture targets and promotion blockers

The [manifest](../contracts/atto-canonical-syntax-v1.json) pins **26 actual .atto source files**: 13 accept targets returning exit code 42 and 13 compile-reject targets requiring nonzero diagnosis **without any emitted guest artifact**. All five backend results are `NOT_EXECUTED`, and every confirmedBackend list is empty. Expected diagnostic categories describe intended semantic classifications, not verified compiler strings.

Run `node --test tests/atto-canonical-syntax-v1.test.mjs` for source-only validation. For each of Java/GraalVM, LLVM, Wasm, Forge and .NET NativeAOT, real promotion requires exact source/fixture Git blob checks; compiled guest accept/reject results, exit codes and diagnostic/no-codegen checks; formatter roundtrip and ownership/actor isolation cases; workflow run/job/step evidence, and independent review. Native Image/AOT, map transaction and stable key Eq/Hash semantics are additional promotion gates. Zero-step Actions failures and parser-only carrier checks do **not** prove guest execution.

Relevant drafts: [Java #2715](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2715), [Java #2727](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2727), [Java #2732](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2732), [LLVM #1623](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1623). Do not mislabel their subset evidence as five-backend parity.

If source Actions minutes are unavailable, only a separately authorized **private** runner may use a SHA-verified minimal mirror: no cross-org source tokens, private source secrets or unreviewed workflows, and no weakening the source security gates. A subset mirror must not claim a full-tree identity check.
