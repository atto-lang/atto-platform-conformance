# Actor-service compiled-guest promotion gate v1

**Status: proposed registry and executable receipt-shape verifier, NOT an actor
implementation or verified backend parity.** The registered test cases are
acceptance requirements; they do not imply that the required `.ores` sources,
compiler integrations, hardware, or CI evidence already exist.

The initial shared milestone is a hot-upgradable, fault-tolerant, networked actor
service. It supports longer-term work on OTP/telephony, Phoenix-style applications,
actor-based gaming, data science services and protected FaaS. Hard real-time has
a separate, stricter promotion profile.

## Profiles

| Profile | Additional requirements |
| --- | --- |
| `actor-core` | Distinct heaps/state, loan exclusion, independent progress, physical reclamation, stale-handle rejection, exactly-once continuation/supervisor notice, safe upgrades |
| `networked-service` | All actor-core cases plus owned HTTP endpoints, bounded I/O and upgrade with in-flight requests |
| `protected-faas` | Networked service plus real OS process/microVM enforcement, denied ambient effects, tenant scrubbing and hostile-worker containment |
| `hard-realtime` | Actor core plus bounded scheduler, overload rejection, target-hardware deadline execution and WCET analysis |

All profiles require the **same compiled `.ores` guest** to provide an assertion
for every registered case, even when host instrumentation is also mandatory.
Host-only tests cannot replace guest execution. Compiler syntax admission alone
cannot promote a runtime profile. A fixture's Git blob is recorded on every row;
actual suite registration and matching the blob to trusted source must be
checked independently. The contract intentionally does not mark any backend
as verified or exempt one backend from the required language semantics.

`contracts/actor-service-v1.json` specifies the registry. Generate a report
from an actual backend run, then run:

```sh
node bin/verify-actor-service-receipt.mjs /secure/path/receipt.json
node --test tests/actor-service-receipt.test.mjs
```

The validator requires exact source/tree IDs, compiler and guest artifact hashes,
fixture-set hash, a matching CI run URL, positive actual runner/job IDs and
steps, successful exact-head conclusion, zero skipped/failed/errored cases, all
required guest assertions, and additional host instrumentation where needed.
It rejects zero-step workflow failures and host-only substitution. Protected
FaaS additionally needs an enforced OS process/microVM boundary; an actor heap,
Truffle Context or unsandboxed in-process JIT alone is not sufficient. Hard
real-time additionally needs physical hardware, strict allocation/admission
limits and an independently analyzed WCET upper bound within the deadline.

## What passing means, and what it does not

A CLI `SHAPE VALID` result **never attests** that source/tree SHAs belong to the
claimed compiler, that workflow IDs really existed, that code executed, that
host instrumentation is independent, or that results are trustworthy. A
synthetic report can pass the shape check; this is why `tests/` labels all
positive examples synthetic and never publishes them as runtime artifacts.

A separate, trusted promotion reviewer MUST:

1. Verify exact source commit and tree, source file/fixture Git blob, binary
   digest, compiler provenance and workflow/runner/job IDs against the actual
   private GitHub repositories and raw CI logs.
2. Confirm the real compiler compiled the committed guest `.ores` fixture and
   the target executed it; ensure case assertions are not replaced with host
   code or hardcoded expected JSON.
3. Inspect missing/skipped tests, job annotations, worker admission failures,
   exit status, malicious-input negative controls, resource bounds, and
   independent reclamation/sandbox instrumentation.
4. Require separate end-to-end HTTP, actor upgrade/rollback and process
   containment observations; for hard real-time, verify WCET assumptions,
   physical target, CPU reservation, contention envelope and deadlines.
5. Produce independent immutable attestation/approval before marking a backend
   or deployment profile production-ready. Keep unsupported features pending.

Do not copy private source into a public CI carrier. For alternate private
runners follow the existing `private-mirror-publish.mjs` policy: verify
visibility/allowlist **before** copying, create a fresh isolated branch, pin
source tree and blob identities, and retain exact Git SHA evidence.

## Suggested first implementation dependency order

1. Add one canonical `.ores` fixture for two same-kind actors, plus a host
   reclamation/scrubbing probe, with independent positive/negative oracles.
2. Establish exact-head executed-guest evidence on Java/Graal. Close the
   protected source-worker bootstrap before making physical-isolation claims.
3. Run byte-identical fixtures through LLVM and .NET as guest lowering arrives;
   explicitly fail closed for unsupported operators, actors and state access.
4. Add owned HTTP request transport, cancellation and bounded backpressure.
5. Validate generation-aware upgrade/rollback and denied stale continuations.
6. Prove process/microVM tenant sandboxing and physical realtime on their
   separate profiles; add Wasm, Forge and Cranelift as real lowering arrives.

Do not promote a profile for any backend until its **complete profile case set**
is independently evidenced. Benchmark throughput, tail latency, actor memory
and cost per request separately; none follows from receipt-shape validation.
