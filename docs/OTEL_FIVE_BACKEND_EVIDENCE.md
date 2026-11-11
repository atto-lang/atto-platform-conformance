# OTel guest parity v1 — five compiler repositories, six execution profiles

This proposal promotes **existing Oreslang-native telemetry**, not a second
telemetry format. The library source is [oreslang-otel](https://github.com/ores-truffle-oreslang/oreslang-otel)
`src/otel.ores` with its source-owned `tests/smoke.ores`.
The fixture is an independently pinned **legacy .ores** guest; do not call it
validated `.atto` compilation or claim that a backend supports imports and
classes simply because its scalar compiler works.

The contract at `contracts/otel-five-backend-v1.json` fixes the fixture and
library Git blob identities, all five backend source repositories, six target
profiles, and **current unverified/blocker** status. A source-free test **must
not** promote a backend. No private compiler code is exported to a CI carrier.

## The real execution target

Run the unchanged fixture in each profile and capture raw, unmodified stdout
and the exit status of the **actual compiled guest**. The same observable
contract requires, in order:

- six correlated and correctly filtered log records (including all JSON
  controls and exact printable signed-i64 extremes);
- one child and one parent span with explicit hierarchy, nonnegative monotonic
  duration, idempotent completion and correct HTTP outcomes;
- one metric counter observation with the same service and trace;
- exact `oreslang-otel.v1` field sets, safe log/body handling and no
  automatically disclosed request metadata.

The guest's `ores_trace_id` is **not a W3C trace ID**; the local JSONL schema is
**not OTLP**. Any future conversion to OTel `traceId`/`spanId` requires a
real, explicit adapter with W3C field rules, sampling, propagation and security
tests. Do not reinterpret opaque IDs as native OTLP IDs.

## Per-backend execution and current gaps

| Source repo | Required profile | Evidence and implementation gap |
| --- | --- | --- |
| `oreslang-source.java` | GraalVM JIT and full native-image AOT | Native library targets the Java stdlib; execute imported guest through real compiler and test actor carrier nonblocking log behavior |
| `oreslang-source.llvm` | LLVM-generated native executable | Existing native strings/console are a prerequisite, **not** proof the complete classes/imports/span library compiles and executes |
| `oreslang-source.wasm` | Real LLVM → core-Wasm artifact on Node worker | Current zero-import `() -> i64` ABI cannot emit guest stdout; add a capability-gated bounded telemetry transport rather than bypassing host import policy |
| `oreslang-source.forge` | Real native generated executable | Independent scalar/bootstrap compiler lacks required string/module/stdio/Span semantics |
| `oreslang-source.net` | **Full .NET Native AOT** host artifact | Scalar-only CIL compiler lacks imports, strings, Span class and stdio; managed host tests cannot substitute for Native AOT guest execution |

For Wasm, preserve the LLVM source/binary SHA, Clang/LLD identity, emitted
Wasm SHA, Node worker admission and a real guest-output channel. For .NET
require a published self-contained Native AOT executable; no JIT or managed
fallback counts. Forge must exercise generated native code rather than only
the checked interpreter. Java Native Image must execute an actual guest.
All imported OTel and standard-library source dependencies must be pinned
and checked, including the fixture's `../src/otel` relative import.

## Evidence capture, not self-certification

The offline entrypoint is:

```sh
node bin/verify-otel-guest-parity.mjs /path/to/receipt.json /path/to/raw-guest-stdout.jsonl
```

It rejects unknown/duplicated JSON fields, excessive input, stale library
fixture IDs, changed output digests, malformed counts, incorrect trace/span
correlation, missing/zero-step runner metadata, failed program exits, mismatched
backends and fake CI repository URLs. It reports
`RECEIPT_SHAPE_AND_CAPTURE_ONLY` with
`compilerExecutedIndependentlyVerified:false` and
`releaseCertified:false`.

**A self-declared GitHub URL, compiler SHA, runner ID, command, or an apparently
valid stdout file can be fabricated.** Therefore the verifier alone does not
prove real execution. `--require-parity` always fails until an *independent
trusted runner auditor* corroborates approved GitHub run/jobs/steps, source
commit/tree and actual build artifact digest, compiler provenance, guest
artifact, process invocation, raw stdout artifact and real exit status.

Machine-reported `EXECUTED_GUEST` must never be minted from fixture files,
prewritten outputs, a mocked host, an interpreter in place of AOT, or a
workflow whose jobs ran zero steps. A parsed telemetry line is not evidence
that a compiler emitted it. A single passing profile is not five-backend
parity. Dashboard/collector admission also requires independent authenticated
OTLP export and storage/readback proof, beyond this guest JSONL gate.


## Opt-in real compiler/guest process launcher

`bin/run-otel-guest-execution.mjs` executes an explicitly selected, SHA-pinned
**real compiler** and then a real guest process. It has **no fake compiler,
cached-output, checker-only or silent skip fallback**. It refuses missing
source checkouts, wrong original fixture/library Git blob IDs, dirty
checkouts, nonabsolute executable paths, tool hash drift, missing generated
artifacts, nonzero exits, process timeouts and malformed/oversized JSONL.

Example configuration **shape only** (replace the placeholder absolute paths
and hashes with independently approved local binaries and clean checkouts;
do not commit the resulting machine-specific file or any credentials):

```json
{
  "schema": "oreslang-otel-real-guest-execution/v1",
  "profile": "java-graalvm-jit",
  "backend_source_root": "/secure/source/oreslang-source.java",
  "backend_source_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "otel_source_root": "/secure/source/oreslang-otel",
  "otel_source_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "compiler_executable": "/trusted/jdk/bin/java",
  "compiler_binary_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "dependency_pins": [
    {"path": "/trusted/compiler/oreslang-compiler.jar", "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}
  ],
  "compile_argv": ["{compiler}", "-jar", "/trusted/compiler/oreslang-compiler.jar", "--check", "{fixture}"],
  "run_argv": ["{compiler}", "-jar", "/trusted/compiler/oreslang-compiler.jar", "{fixture}"],
  "artifact_kind": "source_fixture",
  "timeout_ms": 30000
}
```

The example compiler and command flags are **illustrative**, not a verified
current CLI invocation or an approved binary identity. Update them to the
backend's actual reviewed CLI. For a native-generated profile, set
`artifact_kind:"generated"`, make the compiler write to `{artifact}`,
and ensure `run_argv` actually invokes `{artifact}` through the pinned
native runtime or host launcher. Only `java-graalvm-jit` may use
`source_fixture` (no generated native application artifact). A verified JIT
source input is not a Native Image artifact.

```sh
node bin/run-otel-guest-execution.mjs /absolute/path/to/reviewed-local-config.json
```

The launcher emits private, bounded `capture.json` and
`guest.stdout.jsonl` in a fresh local temporary directory, labeled
`REAL_PROCESS_CAPTURE_CANDIDATE_UNATTESTED`. This local provenance is
**not sufficient for production parity**, since command identity and source
origin still require independent GitHub-run, dependency/build and artifact
corroboration. It never sends private source code to an outside carrier,
automatically uploads an artifact or exports telemetry over the network.

In particular, this runner cannot manufacture a working Wasm stdout import
or the language features Forge/.NET are still missing. Those profiles fail
rather than claiming parity.

## What to implement next

Start with a **real Java/GraalVM JIT guest** under the pinned source-owned
library and Rust semantic oracle. Extend the same guest to Java Native Image
AOT and independent LLVM; then address the missing Wasm host telemetry ABI,
Forge language lowering and .NET full-AOT guest compiler. Each backend must
publish native source feature support or an explicit rejection—not a silent
simulated record. After the six profiles have independent executed receipts,
connect the same authenticated traces/logs/metrics to the approved Rust OTLP
collector and verify real exporter acceptance, tenant fencing and durable query
readback; neither the collector staging tests nor this contract establish that
complete chain.
