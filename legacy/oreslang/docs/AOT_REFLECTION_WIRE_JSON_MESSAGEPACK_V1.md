# AttoLang reflection-derived JSON and MessagePack wire schema v1

Status: **CANDIDATE / NOT GUEST AOT VERIFIED**. Companion Java implementation:
[oreslang-source.java PR #2473](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2473).
This adds a **separate** 32-case
[`aot-wire-json-msgpack-v1.json`](../contracts/aot-wire-json-msgpack-v1.json)
contract. Do **not** rewrite or mark the existing 32 reflection oracles passed.

## Architecture: closed compiler-derived scalar schemas

```text
.atto declarations -> production parser -> TypeChecker -> OwnershipChecker
       -> public closed nominal -> ATTOREF1 verified descriptor
       -> AotScalarWireV1.Schema (immutable ordered Field slots)
            + JSON UTF-8 object parser
            + MessagePack map decoder
       -> immutable scalar slot values
       -> [FUTURE: compiler-generated owned guest constructor / native backend]
```

**Host status**: Java has `OresCompiler.compileAotScalarWireSchemaV1` backed by
`compileStaticTypeOfQueryV1`, `AotReflectionSourceRootsV1`, a deterministic
ATTOREF1 encoder and a strict descriptor reader. It uses no runtime
`Class.forName`, `java.lang.reflect`, JavaBeans, classpath scan, framework
reflection registration, runtime class generation, dynamic proxies or dynamic
guest-code compilation. JSON and MessagePack share **one checked field schema**.
The current decoder is a JVM/Graal compiler-side prototype, **not** an
AttoLang standard-library decoder, typed guest constructor, linked native
executable, or evidence that Native Image works. Native-image compatibility
must be demonstrated by an executed artifact, not inferred from source shape.

## Exact v1 limits

| Property | v1 |
|---|---|
| Input | JSON root object or MessagePack root map, no nesting |
| Fields | <=256; **all present exactly once** |
| Wire types | `int`/`i64` -> signed i64, `bool`, `string` |
| Numerical coercion | none; JSON fractions/exponents and MessagePack float/uint64 reject |
| Unknown/private fields | reject; private fields excluded from descriptor |
| JSON strings | strict escaping, UTF-16 surrogate validation, strict UTF-8 byte entry |
| MessagePack strings | fixstr/str8/str16, strict UTF-8 (no binary/extensions) |
| Bytes | <=65,536 whole input; <=4,096 UTF-8 bytes per string |
| Output | immutable ordered scalar slots, not a dynamically created guest object |
| Field aliases | **reject `@FromJson` and other annotated public fields** until a versioned schema carries distinct JSON/MessagePack key mappings |
| Defaults/null | not supported |
| Schema identity | domain-separated SHA-256 over the complete canonical ATTOREF1 table, **distinct from nominal type ID** |
| Source identity | caller package identity is only a **claim**, not authenticated provenance |

Compatibility is explicit: nominal type IDs hash a package/name/generic identity;
**they are insufficient as a wire schema version**. The optional
`decodeJsonWithFingerprint` / `decodeMessagePackWithFingerprint` entry
points verify the expected full schema digest **before parsing any payload**.
A digest is an equality fence, not authentication or tenant/actor capability.
An enclosing trusted protocol must authenticate the digest and version/tenant
identity when data cross trust boundaries.

## Required hardening and full-AOT promotion gates

1. **Compiler semantics**: bind the reflection source expression to resolved
   symbols in the *normal* TypeChecker, without the current special-MIR
   exclusion; check privacy, ownership, default arguments and effects.
2. **Generated codecs**: emit statically linked per-type field dispatch and
   owned guest constructors; prove memory bounds, partial-construction
   rollback, cancellation, actor/tenant generation fencing and serialization
   shape compatibility. No host `List<Object>` guest object boundary.
3. **Real Java/Graal tests**: execute production Maven/JUnit at the exact
   PR SHA/tree, including the committed `.atto` fixture and all positive/
   negative decoder tests. Reject zero-step Actions as NOT_EXECUTED.
4. **Native Image guest**: link and run a GraalVM executable for JSON and
   MessagePack decoding, verify outputs and inspect the binary for metadata
   retention, unwanted private names and runtime JIT/reflection paths.
5. **Backend parity**: independent compiled guest runs on LLVM, Wasm, .NET
   NativeAOT and Forge, with case-by-case receipt provenance and negative
   mutation tests. Binary formats and error behavior must be stable.
6. **Compatibility expansion**: new, independently reviewed schema version
   required for `Option`, nullability, defaults, field aliases, nested values,
   floats, unions, streaming or hot-upgrade schema generations.

## Expanded test and portable fixture matrix

- **Java host source:** `AotScalarWireV1Test` (28 authored JUnit methods)
  and `AotScalarWireV1MatrixTest` (21 additional authored methods).
  The native-image smoke script now invokes both classes. The exact
  committed scalar decoder has passed 12,143 original + 5,376 matrix
  isolated JDK21 checks with stand-in source/descriptor dependencies.
  Production JUnit and native guest tests remain unexecuted.
- **Conformance:** `tests/aot-wire-contract.test.mjs` now has 22 checks
  including canonical oracle ID/kind binding and immutable unsupported
  feature/shape policy; `tests/aot-wire-fixtures.test.mjs` has 8 portable
  fixture integrity checks. All 30 passed in an isolated V8 harness,
  **not** a hosted Node `node --test` run.
- **Cross-backend fixtures:** `contracts/fixtures/aot-wire-scalar-v1-vectors.json`
  pins 8 positive JSON + MessagePack equivalent vectors and 15 negative
  wire vectors, including signed-i64 extremes, UTF-8, size transitions,
  duplicate/unknown fields, nil, float, uint64, truncation and trailing
  bytes. The vectors themselves carry `NOT_EXECUTED` and cannot certify
  Java, LLVM, Wasm, Forge or .NET guest parity.
- **Decoder hardening:** constructing scalar slots from a null value
  now fails with `IllegalArgumentException` rather than a raw Java
  `NullPointerException`.

The candidate contract's 32 wire/AOT oracles are **NOT_EXECUTED**. Its 10
structural contract tests can pass under a V8 harness without proving any
compiler or native-code result. The Java JUnit cases must not be described as
passing until they actually execute on the production source.
