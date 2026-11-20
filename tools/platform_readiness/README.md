# Source-free AttoLang platform readiness gate

This is a **source-free, advisory and fail-closed** structural evidence evaluator.
It is not a merge bot, release authority, GitHub API attestor, verified branch
protection control, compiler, runner allocator, or private-source export tool.

Run:

    python3 -m unittest discover -v -s tools/platform_readiness -p test_readiness_gate.py
    python3 tools/platform_readiness/readiness_gate.py SNAPSHOT.json --output results.json

The snapshot must match the explicit v1 schema. It models a bounded PR merge
train (up to 25 PRs) and exactly five backends: Java, LLVM, Wasm, Forge, .NET.
A job only contributes structural step evidence when it records a source SHA,
run and job IDs, a verified run attempt, completed/successful steps including
an explicit test/assertion/regression step, and expected HEAD identity. Checkout,
setup, upload, packaging, and metadata-only steps never count as executed test
evidence. A reported "success" with zero steps is rejected. This conservative
name-based screen can reject real tests with unknown labels and can be spoofed
by untrusted JSON; it is *not* independent attestation of actual test execution.

Offline input is **untrusted**. Missing or contradicted evidence exits 1;
invalid input exits 2; a structurally consistent all-green snapshot exits 3.
There is **no exit 0**, because GitHub source identities, actual job logs, runner
allocation, codeowner approval, protected main, artifact signatures and real
compiler/guest execution must be authenticated separately through trusted,
independently reviewed live sources.

The workflow in this PR runs only these source-free tests with read-only
permissions and no secrets. It rejects external PR head repository identities
before checkout and does not invoke Git status/diff clean filters. It does NOT
prove byte-level checkout integrity or five-backend parity and must not be
promoted as a release gate until the organization's runner admission (#315),
protected-main configuration (#170), independent approval and private-source
incident holds (#22/#77) have been separately resolved.

Track integration and exact SHA in conformance issue #268. Don't create a
cross-organization source mirror to execute these tests.
