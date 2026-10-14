# Real compiler smoke evidence — non-promoting adapter

The shared platform-conformance harness currently tests its own runner with a fake checker; this is not backend parity evidence. Independently, the **private** Java/GraalVM and LLVM source repositories now have proposed CI changes that invoke actual Oreslang compiler builds and produce compatible JSON reports.

## Producer workflows

- Java/GraalVM: `oreslang-source.java/.github/workflows/graal-conformance.yml` executes `scripts/ai-conformance-smoke.py` using the built Java launcher through the reviewed Python probe.
- LLVM: `oreslang-source.llvm/.github/workflows/llvm-conformance.yml` executes `scripts/ai-conformance-smoke.py` using `build/oreslang-llvmc`, then asks clang to link the generated IR and runs the resulting executable.
- Each producer tests `main()` returning 42 and a rejected reference to `nonexistent_symbol`. Positive source acceptance plus runtime result, and a real negative compiler diagnostic, are separately required.
- Producers record exact argv, process outputs and exit status, selected backend, source fixture SHA-256, compiler/launcher digest, source checkout SHA and CI run identity. Timeouts and truncated results fail closed.

## Ingesting an approved, sanitized artifact

The report inspection command checks **schema consistency only**, not provenance or truthfulness of self-reported process results:

```sh
node bin/inspect-real-evidence.mjs path/to/approved-ci-report.json
```

A report passes consistency validation only if the expected fixture digests, positive runtime outcome, diagnostic rejection and build fingerprints are present. The command returns `authenticity_attested: false` and `publicly_promotable: false` **even for an internally consistent report**. A forged JSON document can satisfy format checks.

Before publicly promoting an example, independently verify the exact GitHub Actions run and artifact provenance; establish that the compiler build came from the claimed commit (not just a declared SHA), validate fixture bytes and toolchain configuration, review stderr/logs for secrets, and obtain a human-reviewed publication decision. A mock runner, a successful node test, or a report lacking a successful real compiler build is never proof of language support.

## Access / security

Private source repositories must remain private. Do not clone, mirror or publish them into public repos merely to obtain GitHub Actions minutes. Artifacts can contain filesystem paths and captured process output; treat them as private until reviewed and sanitized.

## Current status

No backend has yet been admitted into the public supported-feature matrix by this adapter. Even a successful two-case smoke only proves **that narrow fixture subset under one configuration**, not ownership, actors, portable runtime behavior, or Java/LLVM semantic parity.
