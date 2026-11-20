# AttoLang backend-qualified host imports — conformance v0

This is a **source-fixture contract**, not evidence that JVM or .NET backends
have compiled or executed the fixtures. Every case in `manifest.json` is
`NOT_EXECUTED`, with no binary or runner receipt. The Java and .NET compiler
implementation branches are tracked in:
- [Java PR #2677](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2677)
- [.NET PR #422](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/422)

The portable AttoLang core/std must not directly depend on either host.

## Source syntax, ownership and compiler profile

```atto
import jvm "java.util.ArrayList" as JList;
```

The Java backend lowers this to the existing `java:` class import and must
still require `JAVA_INTEROP` and an exact allowed host class name. The
allowlist and actor admission checks happen at execution policy boundaries.

```atto
import dotnet "System.Math" as Math;
```

The .NET scalar subset permits `System.Math.Abs(Int64)` and
`System.Math.Max(Int64, Int64)` **only** when compiler invocation explicitly
includes `--capability interop.dotnet.math-i64`. This is neither arbitrary
CLR assembly importing nor automatic host privilege elevation. The capability
is explicitly supplied by a trusted build policy, never inferred from the
source import itself. Foreign host objects and collections remain unsupported.

## Contract semantics

- `accept` / `execute` entries require real compiled guest output, not
  parser acceptance or test-host simulation.
- `reject` / `source-check` entries require a compiler diagnostic on
  genuinely parsed source. A crash, runner failure or missing compiler is
  not a successful rejection.
- `reject` / `runtime-admission` entries must establish a restrictive
  host policy, and never call it a compile-time semantic failure.
- A JVM allowlisted name is not an unrestricted host authority. The
  negative `java.lang.Runtime` fixture is checked under a different
  allowed-class list and must be denied under that runtime policy.
- Cross-host import rejection is deliberately asymmetric. JVM source
  must reject `import dotnet`; .NET source must reject `import jvm`.

Each fixture is pinned by **canonical Git blob SHA-1** in `manifest.json`.
`node --test tests/host-interop-v0.test.mjs` validates only fixture identity,
manifest completeness and honest NOT_EXECUTED declarations. It does not
run compilers. Build and runtime receipts must include exact compiler
source/head SHA, real executed job steps, platform architecture, toolchain,
binary hash, native-vs-managed identity, actual guest exit/output, and
negative rejection evidence before a case may be promoted.

## Security boundaries

Importing a JVM or CLR library does not make its allocations actor-owned.
Strict zero-GC profiles must reject unsupported host allocations, and host
objects must not be sent over actor channels or pub-sub unless a future
compile-time checked Sendable handle adapter explicitly allows them. 32-bit
actor heap offsets remain distinct from 64-bit host pointers. JNI, reflection,
file/process/network authority, dynamic loading, cross-tenant handles and
unfenced callbacks are out of scope for v0.

## Additional fail-closed import-admission oracles

The stacked hardening extension adds four source-only negatives: a JVM
`java.lang.System` import must remain denied even when an exact class name is
included in the requested allowlist; both host import syntaxes require `as`;
and the .NET Math capability cannot authorize `System.Reflection.Assembly`.
The Java system-class test is **runtime-admission**, not source syntax rejection.
These additional cases are **NOT_EXECUTED** until compiler-owned and
restricted-host tests execute at exact source heads; the Node tests check
only pinned content and failure-classification integrity.
