# Device build provenance v1 — proposed, NON-PROMOTING reference

**Status: reference verifier and negative-test contract only.** There is no
production API, hardware attestation, compiler integration, trusted device
runner, release certification, or live Oreslang guest execution in this PR.

The purpose of src/device-build-provenance.mjs is to authenticate an upload
and attribute a signed self-report to a registered device key. It deliberately
returns QUARANTINE_UNTRUSTED_BUILD rather than trusted, compiled, passed,
SLSA Build L2, or SLSA Build L3. Tests use arbitrary fixture bytes,
**not a compiler**. Run them with the existing npm test.

## Threat model and guarantees

The user device may be malicious, compromised, or incorrectly configured.
It can sign fabricated claims. The user may control the compiler,
dependencies, source checkout, build script, and local filesystem.
A signature authenticates who signed bytes and prevents changes to those
bytes after signing; it does **not** prove that compilation occurred or that
the uploaded binary corresponds to the requested source. A TPM-attested
device signing key alone does not prove that arbitrary compiler code ran.

The reference enforces:

1. A server-created, expiring, tenant-scoped, nonce-bound build challenge
   binding one pinned Git commit, toolchain SHA-256 and backend target.
2. A separate 256-bit random upload capability. Store only its SHA-256
   server-side. **Never derive an attestation signature key from this
   bearer token.** Never embed it in logs, source, artifact or attestations.
3. An Ed25519 DSSE envelope over an in-toto v1 Statement with subject
   SHA-256 covering the *exact uploaded bytes* and a custom Oreslang
   predicate carrying the challenge and the untrusted device builder ID.
4. Verification against a server-authorized tenant and registered public
   key, not a public key or tenant ID supplied by the uploading device.
   Unexpected fields, wrong signer, substituted source/toolchain/target,
   changed digest, expired challenge, malformed proof and invalid bearer
   tokens fail closed.
5. Admission into **quarantine only**, not release or execution.
   The single-process memory store demonstrates single-use challenge
   consumption. The production API MUST replace it with a durable atomic
   transaction/compare-and-swap; multiple API workers cannot share the
   in-memory replay state.

The predicate URI is a proposed local namespace, not a standardized
SLSA predicate or published certified builder. No signed client claims
may independently elevate the trusted evidence tier.

## Proposed API — NOT IMPLEMENTED

- POST /v1/build-challenges: after authenticated tenant authorization,
  mint an upload capability, nonce and immutable challenge scoped to
  source commit + toolchain hash + backend, with an absolute expiry.
- POST /v1/device-build-uploads: accept the challenge ID, upload capability,
  bounded artifact and DSSE envelope. Resolve authorized tenant and enrolled
  public key from server data; verify all fields and atomically consume the
  challenge before storing the uploaded bytes in quarantine.
- GET /v1/builds/{id}/verification: expose separate verification states
  rejected, quarantined, attested, rebuild-verified, release-approved.
  Only the trusted release authority can promote a build.

Server implementation additionally requires TLS, tenant RBAC, API limits,
device enrollment and revocation, upload streaming/bounds, durable
challenge leases, immutable quarantine, audit events, and anti-abuse controls.

## Trusted release gates (future)

**Pinned inputs:** independently identify the source by exact Git commit
and canonical archive/source-tree digest, locked dependencies, toolchain
binary digest, hermetic environment, build flags, target ABI and policy.
Git's conventional 40-character SHA-1 object ID is not a substitute for a
complete independent SHA-256 source manifest.

**Independent execution evidence:** preferably perform a clean,
independently trusted reproducible rebuild and byte-compare digest, or
run on a reviewed hardened build service with trustworthy provenance.
Nondeterministic builds need explicitly specified normalization and
comparison policies; absence of matching evidence cannot be a pass.

**Optional attestation:** independently verify manufacturer/TPM/TEE
endorsement chains, nonce freshness, measured boot and the specific
isolated builder image and key binding. Device integrity alone cannot
prove a particular userspace compilation. Bind each trusted builder
identity to its actual security boundary and platform-specific policy.

**Artifact admission:** never execute arbitrary uploaded native code in
the API process. Apply sandboxed scanning, dependency/SBOM and
license policies, decompression/size limits and separate release signing.

**Privacy:** sending a tenant's private source, training data or secrets
to volunteer devices requires explicit permission and a suitable
confidentiality model. Do not assume an untrusted worker provides privacy.

## Integration sequence

1. Land this shared reference and rejection test suite without claiming
   live device builds.
2. Implement API challenge issuance, durable one-use state, device key
   registration and revocation, and quarantined object storage.
3. Add a real compiled LLVM or Java/Graal artifact producing adapter:
   pinned source, compiler hash, full logs and execution evidence.
   Current oreslang-stack build produces a checked source bundle,
   **not a compiled native executable**.
4. Add independent rebuild/attested builder gates and a separate release
   authority. Apply the same conformance policy to Wasm, .NET and Forge.
5. Reuse signed artifact/input provenance for AI/ML model weights,
   datasets and inference images, while auditing evaluation quality,
   prompt injection and data poisoning separately.

References:
- https://slsa.dev/spec/v1.2/build-track-basics
- https://slsa.dev/spec/v1.2/build-provenance
- https://github.com/in-toto/attestation/tree/main/spec/v1
- https://docs.sigstore.dev/cosign/signing/overview/
