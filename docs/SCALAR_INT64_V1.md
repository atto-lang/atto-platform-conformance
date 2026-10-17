# Scalar signed-int64 conformance v1

Reference source revision: `oreslang-source.java@12cdd17af7f949a3c54e045a46a2fc21be0ea5d0`.

This contract is deliberately narrow. It covers the scalar integer subset shared
by the experimental JavaScript backend and the Java/Truffle reference. It is
not actor, ownership, async, collection, floating-point or sandbox parity.

## Reference semantics

The Java reference implementation establishes:

- integer source literals are signed 64-bit values; the parser uses
  `Long.parseLong` and explicitly admits the negative endpoint
  `-9223372036854775808` without widening the positive literal domain;
- integral `+`, `-`, `*`, and `%` execute as Java `long` operations,
  therefore overflow is two's-complement wraparound;
- unary minus is Java long negation, so negating the signed minimum wraps to
  the signed minimum;
- `int % int` remains an `int`; remainder follows Java signed remainder
  semantics and a zero divisor is a runtime failure;
- `int / int` evaluates as `Double` and the type checker promotes its result
  to `float`. The current int-only JavaScript compiler therefore rejects
  `/` instead of fabricating an integer quotient.

The contract data lives in `fixtures/scalar-int64-v1.json` and contains 32
cases for extrema, overflow, precedence, calls, signed remainder, admission
failures and runtime rejection.

## JavaScript evidence

`runJsScalarMatrix()` requires:

- absolute path to the real `oreslang-jsc.mjs`;
- exact declared source revision;
- an independently trusted SHA-256 of the compiler script;
- Node execution of every accepted fixture.

The runner compiles every case independently and compares the returned BigInt
decimal string with the contract. Compile-reject and runtime-reject cases must
fail in the expected phase/category.

## Java evidence

`runJavaScalarMatrix()` accepts caller-supplied absolute check/run command
templates containing exactly one `{file}` token, plus an independently trusted
SHA-256 of the Java artifact and the exact Java source revision.

The production Java CLI deliberately maps `main(): int` to a process exit
status restricted to `0..255`, which cannot represent this contract. For
runtime cases, the conformance adapter rewrites only the canonical matrix
`main` return expression to:

```
stdio.println(<same expression>);
return 0;
```

The run command must grant only the required STDOUT capability (for example
the reviewed CLI equivalent of `--allow=STDOUT`). Helper functions and the
arithmetic expression remain unchanged. The adapter captures the full decimal
value from stdout while retaining a conventional zero process exit.

This transformation is test infrastructure, not language syntax or production
runtime behavior. It must be independently reviewed before evidence is
promoted.

## Promotion gate

A scalar parity claim requires both reports to:

1. use the same immutable matrix SHA-256;
2. use the exact Java reference SHA above;
3. bind each compiler/runtime artifact to independently reviewed provenance;
4. report all 32 cases passing;
5. preserve raw execution logs outside the normalized report;
6. execute on allocated runners with actual job steps.

Skipped, mocked, source-free, zero-step, or caller-declared-only provenance is
not parity evidence.
