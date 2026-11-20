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
Java/GraalVM now has a draft `--analyze` implementation in
[PR #2518](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2518);
it is not yet compiled or differentially executed at the exact head.
Neither Java's earlier `--check` nor `--build-analysis` by itself was
equivalent to this analysis interface. No actual cross-backend diagnostic
equivalence is established.

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

The eight included fixtures cover scalar, bool, argument and transitive
unknown cases. The recursive and unresolved-effect fixtures are deliberately
fail-closed: a source rejection is acceptable evidence of rejection, not
evidence of successful typed effect analysis. Subsequent promotion must
require corresponding actual `status=inconclusive` receipts and typed
Java/GraalVM diagnostics for each supported construct.

### Java/GraalVM candidate

[Java PR #2518](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2518)
implements a corresponding conservative parser/typechecker-backed
`--analyze` mode. Supply a trusted, pinned
`ATTO_ANALYZE_JAVA_COMPILER` executable alongside
`ATTO_ANALYZE_LLVM_COMPILER` to run byte-identical output comparisons
for the small declared admitted scalar subset. Missing executables
**skip the differential test**, not pass it. Source-error classification
and recursive-call rejection are tracked separately: two compilers can
reject the same source at different stages without proving semantic
equivalence.

### Required exact-head CI gate

Source-only `node --test` may report passing contract checks while the
three optional binary tests skip. Such an outcome is **not** compiler
parity. To require executable evidence, set
`ATTO_ANALYZE_REQUIRE_EXECUTABLE=1` together with absolute compiler and
formatter paths and their pinned SHA-256 hashes:

- `ATTO_ANALYZE_LLVM_COMPILER` and `ATTO_ANALYZE_LLVM_SHA256`
- `ATTO_ANALYZE_JAVA_COMPILER` and `ATTO_ANALYZE_JAVA_SHA256`
- `ATTO_ANALYZE_FORMATTER_BIN` and `ATTO_ANALYZE_FORMATTER_SHA256`

Strict mode fails if **any** required binary is absent, unpinned, or its
SHA-256 does not match the provided digest. The differential tests must
also execute and pass; no step-free GitHub Actions receipt can satisfy
this requirement. The hashes bind executable bytes, not source
provenance by themselves: separately record the commit SHA and
build steps for each binary.
