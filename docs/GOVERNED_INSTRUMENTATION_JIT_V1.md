# Governed instrumentation JIT v1: tracing running AOT code

**Status:** source-free reference model only. Nothing here compiles code,
switches real dispatch or exports OTLP.

Contract: [governed-instrumentation-v1.json](../contracts/governed-instrumentation-v1.json).
Model: [governed-instrumentation-v1.mjs](../src/governed-instrumentation-v1.mjs).
Tests: `node --test tests/governed-instrumentation-v1.test.mjs`.
Builds on [tenant isolation v2](TENANT_ISOLATION_V2_SHARED_PROCESS.md).

## Principle

AOT for execution. A governed runtime JIT for selective specialization and deep
tracing. One telemetry runtime for context propagation and export.

| Mode | What runs |
|---|---|
| `off` | the AOT version; no span recording or export work |
| `probes` | the AOT version with precompiled probe sites switched on; no code generation |
| `deep` | chosen functions recompiled with detailed probes, switched in by versioned dispatch |

A sealed native binary cannot be re-instrumented by accident: the compiler has
to emit stable function IDs, probe sites, dispatch points and (optionally) a
signed, validated instrumentation IR as a separate artifact.

## Who may instrument what

- **Operators only.** Guest code can never request instrumentation, executable
  memory or compilation.
- **One tenant per request.** The operator must hold that tenant. A scope that
  includes another tenant's function is refused whole; nothing is applied.
- **Untrusted tenants keep the v2 boundary.** The instrumented variant comes from
  the trusted producer and is re-validated: instrumented Wasm is validated
  before lowering into the tenant's cage, or Truffle instrumentation runs inside
  the tenant's Graal isolate. Native code is never patched in place, and CIL is
  never produced for an untrusted tenant.

## Switching code safely

- **AOT stays authoritative.** A failed, mismatched or unvalidated compile
  leaves the running version untouched.
- **Versioned dispatch.** New calls take the new version at a safe point. Calls
  already running finish on the version they entered; that version is reclaimed
  when its last call ends. The AOT version is never discarded, and `off` returns
  to it.
- **Off the actor path.** Compilation runs on a separate service with a
  per-tenant compile quota; an actor turn never waits for it.
- **Real-time sections.** Functions marked real-time refuse deep recompilation.
  Prepare variants outside them; probes are still allowed.

## Telemetry

- Bounded per-tenant buffers. When full they drop and count; they never block
  or grow. Export (OTLP over HTTP/protobuf or gRPC) is asynchronous.
- Attributes are allowlisted. Payloads, bodies, secrets, credentials and actor
  state are refused even if someone allowlists the key. Per-key cardinality is
  capped.
- Trace context rides immutably in the actor message envelope and in suspended
  continuations, never in OS thread-locals, so it survives `await`, carrier
  changes and migration. This matches `oreslang-otel`, which passes IDs
  explicitly and has no ambient context.
- W3C `traceparent` at external boundaries is correlation only. Invalid input
  (wrong version, all-zero IDs, uppercase hex, bad length) starts a fresh trace,
  and incoming context never carries tenant identity or authority.
- Fan-out and batch consumption use span links, not invented parent-child edges.

## Per-backend mechanism

| Backend | Probes | Deep |
|---|---|---|
| Java/GraalVM | precompiled probe nodes | Truffle instrumentation inside the tenant's Graal isolate |
| LLVM | precompiled probe sites | trusted: ORC on retained instrumentation IR; untrusted: instrumented Wasm re-validated and re-lowered into the cage |
| .NET | precompiled probe variants in the NativeAOT image (no CIL JIT in NativeAOT) | untrusted tenants are Wasm on the native core, so LLVM's re-lowering covers them |
| Wasm | probe imports toggled per tenant | instrumented module variant, re-validated, swapped through the actor version protocol |
| JS | probe calls toggled per tenant | instrumented Wasm/JS variant instantiated by the host; V8 internals are not controlled |
| Forge | none yet | none until validated code generation exists |

## Promotion gates for a real backend

On a pinned source tree, with CI that executed steps: turn tracing on and off on
a running `HTTP → Parse → Validate → outbound HTTP → Sink → OTLP collector`
pipeline without redeploying or losing actor state; trace and span IDs survive
suspension and migration; spans close on return, throw, cancellation and
supervisor restart; a tenant cannot instrument another tenant; tracing-disabled
overhead is **measured**, not assumed to be zero.
