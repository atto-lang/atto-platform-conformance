# Actor fault claim admission v1 (source-free)

This opt-in checker is an **admission filter for declarations**, not a crash
test, kernel fault-containment verifier, CI receipt authenticator, or release
approval. It accepts an in-memory plain-data record matching
`atto.actor-fault-claim.v1` and returns `certified:false` and
`releaseReady:false` **on every path**, even for a claimed execution.

`node --test test/actor-fault-claim-v1.test.mjs` runs the portable,
safe shape-model tests. This test does not deliberately trigger SIGSEGV, OOM,
SIGKILL, or VM corruption.

The supported backends are Java, LLVM, Wasm, Forge, .NET, Rust and Cranelift.
Every claim names a failure class, claimed domain (actor, tenant or process),
an explicit isolation mechanism, dedicated-worker isolation, independent
supervisor, OS memory limit and whether an execution is merely claimed.

For native segfaults, host OOM, killed processes and VM corruption:
a claimed actor/tenant survival boundary requires a dedicated OS worker
process and an out-of-process supervisor; actor-level claims additionally
require one actor per worker. Host OOM also requires an OS-enforced limit.
These are **necessary metadata**, never sufficient proof.

The in-process guest-panic/stack/bounds/actor-quota cases likewise need
real compiler lowering, CONTROL supervision, physically retired resources
and post-fault healthy-sibling progress before any certification. A
`not_executed` record is honest bookkeeping, not a passing test.

The input is a JavaScript object already parsed by a trusted parser.
This library refuses proxies, accessors, inherited records and extra keys;
it does **not** check duplicate JSON keys or validate signature provenance.
Do not pass attacker-provided `JSON.parse` output and treat this validator
as an authentication boundary. See the language-spec fault-containment
chapter for the required runner/artifact evidence and safe child-process probes.
