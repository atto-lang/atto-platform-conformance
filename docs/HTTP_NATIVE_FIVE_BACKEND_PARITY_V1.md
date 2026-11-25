# Native HTTP acceptance: five-backend evidence contract v1

This is a **source-free, fail-closed parity evidence gate**, not an implementation
of HTTP or a certificate that Java, LLVM, Wasm, Cranelift and .NET can run the
Phoenix-style server. It pins 14 observable cases and five independent compiler
repositories, intentionally **not Forge** (which is separately in scope elsewhere).
Each backend must be verified with its actual target and runtime, not another
backend's host model. Existing `npm test` discovers the new Node test file.

## Cases and required native behavior

The 14 canonical case IDs in `contracts/http-native-v1.json` cover the exact
three-string UTF-8 MIME profile and rejection; conflicting Content-Length and
Transfer-Encoding ambiguity; one valid Host; strict routes and methods;
exact 16,384-byte echo and rejection at 16,385; bounded header/body trickles;
real 503 under overload; actor failure recovery; graceful drain/restart; and
hot-code generation affinity.

The timing and overload tests must measure actual runtime/transport behavior.
A compiler check, pure-JS/Python model, mocked adapter, status-only test, or
source registration is not a substitute. First-response rejection after an
ambiguous pipelined request cannot prove that no second request dispatched;
that requires runtime trace/dispatch accounting.

## Stage semantics

- `unsupported`: honest lack-of-capability record, evidence=null. Accepted as
  a record but **never** counted as parity. Do not silently map to success.
- `compiler-check`: exact pinned compiler source-check with a nonzero runner,
  executed steps and success; explicitly zero native guest steps and zero
  successful HTTP test cases. Accepted as compiler-only evidence.
- `native-execution`: exact-head success, nonzero runner and executed steps,
  source check, native guest execution, compiler/target digests, and a
  complete ordered 14-case native PASS array.

Receipts must bind exact 40-hex source/demo commits, specific source repository,
target profile, contract SHA-256, GitHub run ID/URL and precise stages.
Host-only or zero-step successes, malformed IDs, swapped repository/profile,
missing/duplicate/failed cases and altered contract inventory are rejected.
Any unsupported or compiler-only backend forces the five-backend parity result
to **false**, even when every supplied receipt is structurally valid.

**Important:** The verifier checks receipt *shape and internal consistency*;
it cannot authenticate an external workflow's claimed steps, independently
link a binary digest to a source revision, prove compiler outputs or authenticate
the request handling without reading underlying logs, build provenance, and
actual transport traces. Do not treat a synthetically green receipt as proof
of native parity. Review actual runner metadata and native outputs separately.

## Current backend capability boundary (audit, not tested parity)

| Backend | Known draft direction | Inbound Phoenix HTTP claim |
| --- | --- | --- |
| Java | HTTP actor/runtime work, pinned JDK 25 and Graal paths | Requires exact native guest tests |
| LLVM | Native HTTP exchange substrate; some source transport actor lowering still rejects | Unverified |
| Wasm | Isolated worker/source actor proof-of-concept, real LLVM-to-Wasm compiler gate pending | Unsupported until server transport is implemented and tested |
| Cranelift | Scalar compiler with fail-closed actor authority denial | Unsupported |
| .NET | Native AOT tenant/actor infrastructure draft | Unsupported until inbound HTTP actor guest path is implemented and tested |

This matrix is an evidence review, not a static declaration of what future
backends will always support. An implementation can advance by producing
fresh independently reviewed exact-head evidence, not by weakening contract
requirements. Do not export private compiler source across orgs for CI;
current incident/approval restrictions remain in force.

## Run

```sh
node --test tests/http-native-receipts.test.mjs
node bin/verify-http-native-receipts.mjs /path/to/reviewed-five-receipts.json
```

The second command exits nonzero on incomplete/unsupported/zero-step cases.
A passing receipt check is **not** permission to merge or release; it only
allows an independent review of the referenced real compiler and runner logs.
