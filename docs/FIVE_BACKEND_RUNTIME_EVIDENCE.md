# Five-backend runtime evidence gate v1 (candidate)

This is a strict structural gate, NOT independent provenance authentication or a claim of full runtime parity. It extends platform-conformance issues #37 and #8.

Canonical source: `pub fnc main(): int { return 40 + 2; }` followed by LF. Exact Git blob: `015f8b0f79aafa796a148d2adeff1574e8d6c491`.

Run `node --test tests/five-backend-runtime-evidence.test.mjs`. `node bin/check-five-backend-runtime-evidence.mjs /absolute/path/to/report.json` always exits 3 after structural success because independent parity attestation remains missing. To use it solely as a JSON consistency checker, explicitly pass `--structural-only` (exit 0 on structural success; this is NOT a parity certification).

The report must include exactly five distinct backend records with source SHA and tree, canonical fixture Git blob, binary SHA-256 digests, compile and guest process observations, typed int 42 result, and nonzero GitHub Actions run/job/runner/steps with head SHA matching source commit.

Admitted profiles are Java jvm/native-image/hybrid, LLVM native, Wasm core-wasm, .NET windows-native-aot, and Forge interpreter/native. Each profile requires its own actual executed proof; the first five-profile bundle does not automatically establish each backend's other modes.

Even a structurally consistent bundle always returns ci_provenance_authenticated:false, guest_execution_authenticated:false and five_backend_parity_certified:false. The caller must independently check GitHub numeric repository identity, exact runner-executed job logs, source/tree/artifact hashes, source-to-binary provenance and real guest observations (not mock results or compiler-only smoke checks).

Unit tests use synthetic evidence only; they are not native runtime tests. Full five-backend parity additionally needs real source compilation and executed guest observations on every target, plus unsupported-feature rejection.

Do not export private source to another GitHub organization without independent approved protected source-main authorization for the verified private destination. Runner minutes are not authorization. See security exposure issue #22 and no-runner CI issue #37.
