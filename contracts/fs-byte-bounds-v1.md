# AttoLang filesystem byte-budget contract v1 (proposal)

This is a normative candidate, not a claim that any backend has executed the API.
See fs-byte-bounds-v1.json, lib/fs-byte-bounds-v1.mjs, and the associated Node
shape tests. The source APIs are:

- fs.write_text_atomic_async(String path, String value) -> Future<void>
- fs.file_size_async(String path) -> Future<int>, returning storage bytes
- fs.read_text_bounded_async(String path, int max_bytes) -> Future<String>

The synchronous-I/O naming rule requires _blocking, with optional _async on
asynchronous APIs. The older contracts/async-io-v1.json forbids both suffixes;
that is existing specification drift to reconcile separately, not something
this narrow contract silently overrides.

## Safety boundaries

Authorization checks lexical scope BEFORE filesystem metadata or existence
probes and separately checks the resolved path. Leaf symlinks and ANY symlinked
ancestor of a scoped path must be denied **before** the restricted target is
canonicalized: both an existing and a missing target must fail at the same
symlink boundary, never disclose existence through different resolve errors.
These rules extend the existing FS-07, FS-12 and FS-13 vectors without
renumbering or falsely asserting backend implementation. One opened NOFOLLOW
descriptor must limit reads both initially and
while bytes are arriving, reject malformed UTF-8 without exposing partial
text, and never exceed the caller's byte budget. The proposed Java API's
maximum is 16 MiB, and REST uses a 1 MiB persisted-resource budget.

One descriptor and a byte cap do NOT guarantee an immutable snapshot while
another process writes. Nor does a NOFOLLOW leaf check fully eliminate a
hostile parent-directory rename race. Stronger dirfd/openat2 or process
confinement is separate work.

## Proof and parity

Five target lanes: Java/GraalVM, LLVM, Wasm, Forge, and .NET NativeAOT.
All are marked unverified in the manifest; that does not assert absence of
code. Java candidate: oreslang-source.java PR #2531. REST candidate:
oreslang-demo-restful-server PR #29. Actual guest execution is not yet proven.

Promotion needs exact source commit/tree, compiler artifact digest,
source-local runner/run/job/attempt identity, executed steps greater than
zero, real compiled .atto guest assertions and negative cases, and independent
review. A structurally valid synthetic receipt is NOT authenticated evidence
and cannot certify five-backend parity. Neither this contract nor a
source-free probe authorizes private-source mirroring.
