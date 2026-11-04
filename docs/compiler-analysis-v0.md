# Compiler-owned effect analysis v0: evidence boundary

This is a **candidate** five-backend CLI interoperability contract, not a
claim of Java/GraalVM, LLVM, Wasm, Forge or .NET implementation parity.

The canonical form is `atto-compiler --analyze path.atto` (legacy `.ores`
accepted during migration). Compiler-owned parsing/typechecking and
transitive effect closure must not generate IR/artifacts or execute guest
code. The formatter may delegate to a compiler; it never implements effect
semantics. `atto test --effects` remains a **lexical advisory** checker.

Exit 0 is permitted only for source admitted into an explicitly documented,
closed and verified analysis subset. Exit 1 means malformed/rejected source
or an execution failure, exit 2 means unsupported or incomplete analysis.
Unknown calls, effect-bearing cleanup, checked arithmetic without a verified
failure model, actors, unresolved imports and dynamic dispatch must **not**
be certified effect-free.

LLVM candidate: [native --analyze PR #1375](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1375).
Formatter discovery: [PR #109](https://github.com/ores-truffle-oreslang/oreslang-format/pull/109).
Java still has `--check` and `--build-analysis`, which are not equivalent
to `--analyze`. No actual cross-backend diagnostic equivalence is established.

## Runnable evidence

Source-free `node --test tests/compiler-analysis-v0-contract.test.mjs` checks
only the manifest/fixtures. It **skips** the executable LLVM case unless CI
supplies a trusted, pinned, real native binary using the absolute-path
`ATTO_ANALYZE_LLVM_COMPILER`. Even when the executable test passes, record
the compiler commit, binary hash, complete stepful logs, exact exit codes,
source hash and absence of artifact writes. Do not advertise semantic parity
until Java's real compiler and LLVM yield equivalent results on shared cases
and exceptions/actors have guest-level execution tests.

For formatter integration, provide **both** trusted, pinned absolute executable
paths: `ATTO_ANALYZE_LLVM_COMPILER` and `ATTO_ANALYZE_FORMATTER_BIN`.
The optional test invokes LLVM directly and through `oresfmt --analyze`
on the same file, compares exact exit status and stdout, and confirms no
source mutation or output artifacts. Absent either executable, the test
skips and **establishes no LLVM-to-formatter parity**.

The included recursive and unresolved-effect fixtures are deliberately
fail-closed: a source rejection is acceptable evidence of rejection, not
evidence of successful typed effect analysis. Subsequent promotion must
require corresponding actual `status=inconclusive` receipts and typed
Java/GraalVM diagnostics for each supported construct.
