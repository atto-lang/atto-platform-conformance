# JavaScript backend evidence adapter

The "js" inventory entry indicates only that the Oreslang JavaScript compiler has been assigned positive and negative fixtures. It is not a general runtime parity or security attestation.

The initial compiler is in ores-truffle-oreslang/oreslang-source.js. Its experimental CLI accepts the two manifest fixtures:

- int-arithmetic.ores => --check returns success without compiler error severity.
- unresolved-identifier.ores => --check fails with a primary diagnostic containing "unresolved identifier nonexistent_symbol".

Both fixture Git blobs have been directly verified byte-identical between the JS repo and this conformance repository. No source-tree or artifact mirroring is necessary.

## Run with real executable evidence

Build/checkout the JS compiler through your ordinary approved private repository access workflow. Pin the exact compiler commit, validate artifact hashes, and use an absolute path to Node and the compiler JS script. For example:

    node bin/conformance.mjs --backend=js \
      --argv='["/absolute/path/to/node","/absolute/path/to/oreslang-source.js/bin/oreslang-jsc.mjs","--check","{file}"]' \
      --source-sha=ACTUAL_40_HEX_COMMIT --require

Replace the paths and SHA with verified values. A CLI smoke check only exercises the parser/admission surface, **not generated-JS execution**. The harness hashes the executable (Node) and fixtures; the declared compiler SHA is not cryptographically tied to the JS compiler script. Add independent pinned source/artifact provenance before promoting any claims.

Keep the suite UNCONFIGURED without a real compiler path. Do not infer browser execution, iso-lattes readiness, async/actor support or security isolation from a green manifest check.

## Real emitted-ESM runtime evidence

The existing `--check` harness only tests source acceptance/rejection. A
separate programmatic collector now runs **both** the real JS compiler and its
emitted ESM fixture on Node 22+:

```js
import {runJsRuntimeEvidence} from './src/js-runtime-evidence.mjs';

const result = await runJsRuntimeEvidence({
  compilerScript:'/approved/private/checkout/oreslang-source.js/bin/oreslang-jsc.mjs',
  declaredSourceSha:'YOUR_EXACT_40_HEX_JS_COMPILER_COMMIT',
  expectedCompilerScriptSha256:'INDEPENDENTLY_TRUSTED_64_HEX_SCRIPT_SHA256',
  timeoutMs:10000
});
console.log(result);
if(!result.ok)process.exitCode=1;
```

The collector requires an independently trusted compiler-script SHA-256, verifies the negative
unresolved-identifier fixture fails, checks the fixed shared arithmetic fixture returns `42n`,
records compiler-script, fixture and emitted-module SHA-256 hashes, and
reports compilation failures, missing generated modules, runtime failures
and timeouts explicitly. It never bundles or mirrors the private compiler.
Tests of the evidence collector itself **do not** imply real compiler execution.

The declared source SHA is not cryptographically bound to the compiler script:
independently review/attest the exact checkout before approving this evidence.
The source fixture executes in the Node process with normal host privileges;
it is trusted and fixed by the conformance repository. This is not a sandbox
for attacker-supplied source, nor proof of Java numeric semantics or actors.
