# DOP v1: source-workflow blob admission (non-promoting)

This is a **read-only evidence correlation safeguard**, not a signed release
attestation, compiler-output proof, or independent reviewer approval.

## Threat model

GitHub Actions workflow ID, name, job name, `run.head_sha` and ordered step
names alone do not fix the workflow **implementation**: a PR can change YAML
at the same registered `.github/workflows/` path and retain all those
identities. A source-free echo check could then masquerade as a real backend
guest job.

The `verify-dop-github-run-v1.mjs` CLI now requires three authenticated,
repository-local GitHub reads before it reports even
`CORRELATED_NOT_GUEST_ATTESTED`:

1. Exact `GET /repos/OWNER/REPO/actions/runs/RUN_ID`.
2. Exact `GET /repos/OWNER/REPO/actions/runs/RUN_ID/jobs?per_page=100`.
3. Only when the run/job snapshot matches, `GET
   /repos/OWNER/REPO/contents/.github/workflows/FILE.yml?ref=RUN_HEAD_SHA`.

The source file must be a regular file with the canonical path and Base64
encoding, at most 65,536 decoded bytes. The validator rejects declared-size
mismatch, malformed Base64, mismatch between the decoded bytes and Git's
`sha1("blob " + length + NUL + bytes)`, and a mismatch against the pinned
candidate Git blob for that backend:

| Backend | Workflow | Pinned candidate Git blob |
|---|---|---|
| Java | `dop-scalar-java-guest.yml` | `1e7e45f5b1bb7151d375609fd1ae00d922509f96` |
| LLVM | `dop-atto-soa-native.yml` | `a845d9f110940d8bf3da931c8bd52d021b7ffe6d` |

Those blob IDs were read from the source branches at Java #2571
`42f9a762fec48b39952b15043dc0da1314a844f2` and LLVM #1308
`4c800329b90ed8ee3db7ff59e77c67ff8daa5fe2`.
They are **observed review candidates, not independently security-approved
releases**. A changed source workflow must fail closed until the reviewed
policy is updated with the correct new blob and tests.

Wasm, Forge, and .NET have **no admitted guest-workflow source policy**
yet: the CLI refuses to correlate them as positive guest evidence. They
need their own reviewed actual guest workflows, content pins and tests.

## Boundaries

The fetch runs under a credential explicitly authorized to read the
private source repository, with fixed HTTPS GitHub API host, GET only,
redirects disabled, bounded JSON response and timeout. No source blobs,
workflows, CI artifacts or Git trees are copied to another GitHub
organization. Validation happens where the authorized process runs.

Even a valid pinned workflow hash proves **only which workflow bytes
GitHub reports for that exact commit**. A real release gate must separately
establish qualified independent review, protected main, exact compiler
source/toolchain provenance, JIT runtime/JUnit report or AOT binary hashes,
a non-null admitted runner, meaningful executed steps and genuine compiled
AttoLang guest output. The CLI's affirmative classification remains
`CORRELATED_NOT_GUEST_ATTESTED`.

Local, source-free tests:
`node --test tests/dop-workflow-source-v1.test.mjs`.
The conformance job includes this alongside all seven other DOP v1 suites.
A zero-step source-org CI failure is **NOT_EXECUTED**, not a test pass.
