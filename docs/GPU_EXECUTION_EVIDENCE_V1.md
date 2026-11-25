# AttoLang GPU execution evidence — host-side admission v1

The source-free validator in `src/gpu-execution-evidence-v1.mjs` implements a **candidate evidence schema**, not GPU authentication. A passing return value is exactly `PHYSICAL_GPU_CANDIDATE_UNATTESTED` and must never be promoted to a released, compiled-guest or physical-device capability on its own.

## Input trust boundary

`expected` is an independently pinned policy envelope, never copied from `receipt`:

- GitHub PR source HEAD, source tree and exact `.atto` fixture **Git blob IDs** obtained from an authoritative immutable ref. Git SHAs and SHA-256 digests have different roles.
- GitHub Actions run ID, run attempt and job ID retrieved independently from the actual workflow run and job API, including *executed* steps and overall successful job conclusion. `steps=[]`/`null` means runner admission failure. A generic successful step cannot substitute for the ordered `source_checkout`, `guest_compile`, `guest_execute`, `device_event`, `numeric_oracle` phases.
- Actual compiler-emitted device artifact SHA-256, device kernel name, provider-attested tenant/vendor/device/queue/allocation generations and per-dispatch submission ID. These values must be verified at the compiler/provider boundaries, not chosen by the guest program.
- Independently generated CPU oracle artifact SHA-256 and exact expected output sample count, plus a trusted upper bound for absolute numerical tolerance. The reported tolerance cannot widen this policy.

The validator's `receipt` must have all six sections: `source`, `run`, `compiler`, `guest`, `device`, `numerics`. Every required field is mandatory, and unknown fields are rejected. No CI result or device result may be treated as authenticated solely because it has a matching string, numeric ID, Boolean or hash.

## Gate sequence

1. Run this repository's Node tests on the **exact PR head** and verify the source/test Git blob IDs. This demonstrates only execution of host-side admission tests.
2. Independently observe the AttoLang `.atto` source compiling into the backend's guest/device artifact and record its SHA-256. A C++/Java wrapper compilation is *not* guest evidence.
3. On actual GPU hardware, authenticate the device provider, allocations and queue; observe submission and a completed physical event, including cancellation/quiescence fencing.
4. Compare every expected output element against an independently computed CPU oracle, recording the exact sample count and bounded errors.
5. Authenticate the provenance of *all* records before making any physical-GPU support claim. Do not rely on this verifier's `PHYSICAL_GPU_CANDIDATE_UNATTESTED` return value as an authorization token.

## Limits / next work

- The validator does **not** query GitHub, establish artifact signatures, attest hardware, pin memory during execution, or perform the numeric comparison itself. It checks an untrusted structure against independently provided values.
- Input objects should be fresh parsed JSON; arbitrary JavaScript `Proxy` objects are not a supported trust boundary.
- The workflow `gpu-execution-evidence-v1.yml` explicitly emits **HOST_ONLY** results and cannot report physical GPU completion. Run/job `steps=null` must never be treated as a passing test.
- A dedicated trusted receipt collector must bind GitHub job steps, compiler and device events, with independent signatures or immutable API reads, before this becomes a release gate. Actual LLVM `.atto` SAXPY lowering and physical-device execution remain unimplemented by this PR.
