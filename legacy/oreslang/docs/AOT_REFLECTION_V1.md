# AttoLang full-AOT reflection — descriptor ABI v1 (candidate)

Status: **DESIGN ONLY / NOT_EXECUTED**. This is a cross-backend semantic and
evidence contract; no backend compiler or native guest has been validated by
this document or by the contract's host-only JSON tests. The shared design
request is [AOT Reflection Design](https://chatgpt.com/share/6ae8ab63-a31c-83e9-a8ac-7bb1f158d410).
Legacy GitHub repositories and .ores files retain their names until migrated.

## Objective and strict boundary

AttoLang offers `type_of<T>()`, `fields_of<T>()`, `methods_of<T>()`
and `implements<T,I>()` as **closed-world queries** backed by immutable,
compiler-emitted data. The API spellings are proposals, not evidence of parser
admission. A compiler may support other surface forms with the same typed IR.
No reflection feature may silently fall back to a JIT, runtime AST,
Reflection.Emit, classpath scan, dynamic proxy, runtime generic specialization
or reflection-dependent serializer. A backend that cannot lower a query must
reject with a stable diagnostic and no executable output.

Metadata inspection is not dynamic method invocation; a method descriptor is
not a callable pointer. Reflection must not mint ownership rights, mutate
actor state, grant a capability, or expose a layout offset or native pointer.
A capability to inspect *live* state is distinct from compile-time/public
type metadata.

## Minimal lowering, in compiler order

1. Resolve package identity, imports/aliases, nominal type symbols,
   visibility, interface/typeclass witnesses, and finite generic instances.
2. Typecheck reflective intrinsics as **pure metadata queries**; maintain
   ordinary borrow, ownership, effect, actor-isolation and capability rules.
3. Compute a bounded reflection reachability set. Default: public descriptors
   only for explicitly reachable/retained types. Explicit retention may
   enlarge metadata, **never** security authority.
4. Generate a canonical portable descriptor table plus optional target ABI
   section. Each entry has an unambiguous versioned, collision-checked type
   identity; resolved generic arguments; public fields in source order; and
   static method signature and witness references. Use checked indices,
   lengths and total table size. No native address, object pointer or
   mutable alias in the public table.
5. Re-run ownership/effect/visibility checks on generated accessors and
   serializers. Emit static accessor/witness IDs and finite dispatch tables.
6. Lower `type_of` to a constant table reference or bounded index.
   Lower `fields_of`/`methods_of` to immutable table slices;
   `implements` to a compile-time boolean or a closed witness lookup.
   There is no generic runtime type construction.
7. Link and dead-strip unretained tables. Require binary section/symbol
   inspection proving both presence of rooted metadata and physical
   absence of unrooted metadata, rather than trusting a source manifest.
8. Execute the exact guest source in the compiled AOT artifact and compare
   values, visibility redaction, rejection diagnostics and resource bounds.

Portable identity must not assume Java object layout == LLVM layout ==
CIL layout == Wasm linear memory layout. Type symbol identity and
versioned contract semantics can be shared; physical storage, alignment,
endianness, object lifetime and table linking remain target-specific.

## Suggested versioned descriptor envelope

An immutable compiler-emitted section, conceptually:

```text
Header {
  magic, schema_major=1, schema_minor, section_byte_length,
  record_count, offsets_width, canonical_encoding, integrity_digest
}
TypeDescriptor {
  stable_type_id, package_identity, resolved_symbol_id, generic_args,
  visibility, kind, public_fields_slice, public_methods_slice,
  witness_slice, target_abi_reference
}
FieldDescriptor { name_id, resolved_type_id, ordinal, visibility }
MethodDescriptor { name_id, arity, parameter_type_ids, return_type_id,
                   effect_flags, visibility, dispatch_witness_id }
```

All scalar widths, encoding normalization, length limits and digest domains
must be locked before any ABI-stable release. This is **not yet** a frozen
wire format and has no guest-controlled address fields. Descriptor references
are opaque bounds-checked handles; the runtime rejects invalid tables before
using them. A hash is for deterministic identity/integrity and is not an
authorization token or a substitute for signing/review.

## Security: actor and state-container inspection

Public type shape and private **live instance state** are different domains.
An isolated actor's state must remain invisible through type descriptors.
For live debugging, the runtime, not guest metadata, issues an authorization
ticket bound to tenant, isolate, actor identity, activation generation,
specific allowed fields/operations, and expiration/cancellation epoch.

Inspection is performed in the actor's owning execution context under the
existing `handle_state` / `critical` discipline and produces a deliberately
bounded immutable snapshot (or a lexical guarded loan that cannot escape).
No guest thread may read actor-owned heap pointers from a foreign isolate.
A stale activation, foreign tenant, forged role or revoked ticket rejects
without producing partial data. The ticket cannot be serialized as reusable
cross-tenant authority. Untrusted MCP/devtools clients have no bypass.

## Retention, stripping, and precompiled hot loading

Retention roots are separate from actor permissions. A rooted descriptor
does not automatically root the full method implementation, generic graph,
interpreter, compiler or Java reflection engine. Compiler/reachability
diagnostics must explain every retained entry. Opt-out and opt-in AOT binary
size / symbol tables are measured using exact build artifacts.

Hot loading accepts only **precompiled** images with verified package/module
identity, metadata-schema version, target ABI, declared capability envelope,
and generation. Registration is transactional; incompatible images are
rejected before publication. Old generations are kept until outstanding
borrowed snapshots/handles quiesce, then retired. NativeOS loader APIs,
Wasm module instantiation and GraalVM closed-world constraints differ; no
universal promise of arbitrary runtime native-image class loading is made.

## Backend-specific first execution gates

| Backend | Smallest compiler change | Required actual execution | Current evidence in this change |
| --- | --- | --- | --- |
| Java/GraalVM | Typed intrinsic + generated immutable table + Native Image retention rules | JDK25 guest compile, GraalVM Native Image binary with no runtime class scan | NOT_EXECUTED |
| LLVM | Resolve intrinsics in typed HIR, emit rodata and checked section lookup | Native executable; ASan/UBSan negative bounds and ownership checks | NOT_EXECUTED |
| .NET NativeAOT | Static CIL table + trim-safe roots, no Reflection.Emit | Published NativeAOT executable on Linux and Windows | NOT_EXECUTED |
| Wasm | Immutable/readonly metadata data segment + capability-gated guest export | Wasm compiled/instantiated AOT module; isolated host and bounds checks | NOT_EXECUTED |
| Independent Forge/Cranelift | Closed typed metadata lowering with static constants | Independently emitted and executed AOT artifact (not LLVM output) | NOT_EXECUTED |

Do **not** call a Truffle-on-Native-Image interpreter a proof that a guest
program was separately AOT-compiled; report the distinction. A source-free
canary, parser-only acceptance, JUnit host primitive, JSON selftest or CI
runner-admission failure cannot be promoted to compiler-backed guest proof.

## Test/evidence protocol

The machine-readable [32 candidate oracles](../contracts/aot-reflection-v1.json)
cover positive reads, rejections, security checks, binary metadata stripping,
hot load, AOT escape hatches, and deterministic builds. Cases are not .ores
fixture syntax yet: each backend must bind the same oracle ID to an exact
`.ores` file, source SHA-256, exact compiler invocation and expected output
or diagnostic before claiming coverage. Unsupported language forms must
remain fail-closed; don't invent passing tests.

A promoting test record needs exact source commit **and tree** SHA, compiler
binary digest and build provenance, complete stepful job records, fixture
digests, produced binary hash, target triple, concrete native execution
command and stdout/diagnostics, symbol/section retention inspection,
independent review, and evidence of no runtime-JIT fallback.
A run with `steps=[]`, `steps=null`, or runner_id=0 is **NOT_EXECUTED**.

### Staged, strictly nonpromoting receipt lint

A receipt must specify `scope: "complete"` (all 32 oracle IDs) or
`scope: "milestone"` (a named `milestoneId`, an explicit subset,
and at least one `guest-aot` oracle). A milestone is **not** full backend
parity, and its `MILESTONE_SHAPE_VALID_UNATTESTED` classification must never
be promoted to an executed guest proof. Every reported negative compiler
case requires exit code 1, a stable diagnostic class and no output artifact.
Binary-inspection cases must name the exact artifact digest being inspected.

```sh
# This intentionally exits nonzero EVEN WHEN receipt JSON has valid shape.
node bin/verify-aot-reflection-receipt.mjs receipt.json

# Exit success means ONLY that receipt fields are structurally consistent.
# It does not verify a GitHub job, prove native execution or grant merge authority.
node bin/verify-aot-reflection-receipt.mjs receipt.json --lint-only
```

A self-declared SHA, `runnerId`, `steps`, `compilerGuestExecuted`,
`reviewUrl` or `noJitFallback` boolean can be forged. An independent
promotion adapter must fetch GitHub job/run-attempt steps, pin the exact
source Git tree, rebuild or verify the compiler binary, verify all artifact
and fixture digests, execute the guest, inspect machine code/linker symbols
and validate independent review through trusted systems. This JSON tool is
*never* that independent promotion adapter.


Private-source mirroring is subject to the existing pre-copy privacy,
approved-carrier and independent-authorization hold; content integrity
alone does not authorize export.

## Compatibility with adjacent projects

- Static serializer/Zorde metadata may *consume* this descriptor contract,
  but does not gain dynamic field access or mutable actor state.
- State-container / virtual-actor substrate contracts remain separate;
  inspection is a privileged bridge rather than direct heap reflection.
- AOT macro/generic closure occurs **before** descriptor finalization.
- `oreslang.reachability/1` receipts can bind retention roots, but binary
  inspection is still necessary to prove the linker removed dead sections.

## Java compiler-only static query bootstrap (NOT guest AOT)

[Java draft PR #2473](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2473)
introduces a limited `Parser.parseStaticTypeOfQueryV1("type_of<Person>()")`
entry point that uses the production lexer/expression parser. The opt-in
`OresCompiler.compileStaticTypeOfQueryV1(declarations, packageIdentityClaim, query)`
parses and type/ownership-checks **declarations** and binds the parsed query
to an explicitly rooted public, import-free, namespace-free nominal class.
It emits an immutable compiler-side table and stable type ID using the existing
bounded encoder and strict readback validator.

This is intentionally narrower than language semantics:

- `type_of<T>()` **inside guest source functions still fails closed** in
  `TypeChecker` until real typed HIR, guest value representation and AOT
  lowering are implemented. The `.atto` test fixture
  `type_of_unlowered_reject.atto` must reject with that explicit diagnostic.
- Query syntax accepts one concrete nominal parameter, no runtime arguments,
  no method receiver, no open generic instances or contextual symbol aliases.
  Private, inherited, actor or unbounded/unresolved field types reject.
- The `packageIdentityClaim` parameter is self-declared input and **does not
  attest** package provenance, source Git identity, a compiler binary or
  artifact output.
- JUnit source fixture and rejection tests are authored in the Java draft.
  Unless the exact-head job has executed steps and passing tests, these remain
  `NOT_EXECUTED` as CI evidence. A static metadata table does not establish
  native guest compilation, machine code, runtime no-JIT behavior or linker
  retention.

This bootstrap is *not* a passing instance of the
`type_of.closed_nominal` or `aot.native_execution` guest conformance oracle.

### M1b: compiler-owned typed MIR for a single guest return

The Java draft [#2473](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2473)
now contains `AotReflectionTypedMirV1`, an **opt-in, narrow compiler MIR** for
a parsed `.atto` source file containing exactly one public, pure
`main(): TypeDescriptor` with the single return
`type_of<ClosedPublicNominal>()`. The production parser handles all source.
The ordinary TypeChecker and OwnershipChecker still admit every other
declaration; the special entry is validated by a separate conservative
closed-shape gate, not silently marked as a fully typechecked generic guest
expression.

The MIR declares its own compiler-only `TypeDescriptorType` and supports two
typed operations, `LoadTypeDescriptor(tableIndex=0, typeIdHex)` followed by
`ReturnDescriptor(registerIndex=0)`. Its plan constructor verifies the
immutable table bytes, payload digest, canonical type identity and exact
instruction sequence, exposing defensive byte copies. No runtime invocation,
Java reflection, raw pointer, interior alias, dynamic specialization, actor
authority or foreign tenant type discovery is admitted.

**This is not a general `Types.Type` or normal guest `TypeDescriptor`
runtime value.** It cannot run the entry, emit native code, or prove any
GraalVM/LLVM/.NET/Wasm/Forge AOT guest result. The ordinary compiler intentionally
continues to reject source-level `type_of<T>()` until a real typed effect/
ownership/HIR integration and backend constant emission exist.

The committed `typed_main_type_of_nominal.atto` fixture and companion JUnit
positive/negative tests are candidate tests, **NOT_EXECUTED** until actual
exact-head Maven/JUnit evidence exists. The 32 backend guest conformance
oracles are unchanged and remain NOT_EXECUTED.

## Priority implementation slices

1. Java/Graal typed `type_of<T>()` for public nominal types + one generated
   read-only table; native binary test; explicit unsupported-feature errors.
2. Public field descriptors, then `implements` static witnesses and
   method signatures with zero dynamic invocation.
3. Retention-root + linker audit and generated serialization integration.
4. LLVM, .NET, Wasm, independent Forge identical oracle fixture IDs.
5. Generation-fenced, runtime-authorized actor snapshot capability and
   precompiled hot-load integration, both with cross-tenant negative tests.

No promotion/merge of a guest claim without nonzero-step, exact-head,
compiler-backed AOT execution and independent review.
