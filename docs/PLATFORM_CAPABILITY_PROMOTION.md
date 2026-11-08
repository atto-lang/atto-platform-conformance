# Platform capability promotion contract v1

The `oreslang-platform.*` repositories intentionally contain different kinds
of evidence: host C references, ABI link smokes, compiler-produced guests,
emulator/device execution, RTL simulation/synthesis, and eventually physical
hardware measurements. These are not interchangeable.

`contracts/platform-capabilities-v1.json` defines a common ordered promotion
model:

1. `host-reference`
2. `abi-link`
3. `compiler-guest`
4. `target-execution`
5. `physical-hardware`

A repository may only claim a stage when a receipt passes
`bin/verify-platform-capability-receipt.mjs`.

## Mandatory rules

Every stage requires an exact source commit, at least one actually executed CI
step, and a SHA-256 digest for the tested target artifact. A queued workflow,
a job that fails before any steps, or documentation saying that a test exists
is not execution evidence.

`compiler-guest` and higher additionally require:

- the tested artifact was produced from Oreslang source by a real compiler;
- an exact compiler source revision;
- a digest of the compiler binary used;
- an ABI link proof;
- the evidence is not a handwritten host stub.

`target-execution` additionally requires the produced artifact to execute on
the claimed target or a clearly identified target emulator/simulator.
`physical-hardware` requires separate physical-device evidence. Emulator,
QEMU, synthesized-netlist simulation, or host execution cannot be relabeled as
physical hardware.

## Receipt example

~~~json
{
  "schema": "oreslang.platform-capability/1",
  "platform": "desktop",
  "repository": "ores-truffle-oreslang/oreslang-platform.desktop",
  "sourceCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "stage": "compiler-guest",
  "evidence": {
    "exactHead": true,
    "executedSteps": 12,
    "workflowConclusion": "success",
    "targetArtifactSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "abiLinked": true,
    "hostReferenceOnly": false,
    "compilerProduced": true,
    "compilerSourceCommit": "cccccccccccccccccccccccccccccccccccccccc",
    "compilerBinarySha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }
}
~~~

The receipt format records evidence shape and provenance identifiers. Passing
the verifier does not independently prove that a workflow log, binary, source
revision, emulator, or physical device is trustworthy; reviewers still inspect
the underlying evidence.

## Platform registry

v1 registers `mobile`, `desktop`, `embedded`, `iot`, `fpga`, and
`asic` and binds each identifier to its canonical private repository. This
prevents a receipt for one repository from being presented as evidence for a
different platform.

This contract should be referenced by each platform repo as its promotion gate.

## v1 contract integrity and independent attestation

The **v1 policy is a closed-world contract**: the verifier must reject altered stage
order, registered platform/repository/target-class identities, promotion-rule
keys and ordered requirements, or the list of examples that are expressly *not*
execution evidence. Changing one of these rules needs an explicit versioned
policy upgrade and independently reviewed producer/consumer tests; silently
editing a v1 JSON manifest must not weaken admission.

**Receipt validation is not authentication.** Even a passing synthetic receipt
with `exactHead=true`, `executedSteps>0` and a well-formed artifact digest
proves only that its *fields* match the versioned schema. The values are
self-attested until a trusted, read-only verifier independently fetches a
completed workflow and job from GitHub, verifies the exact PR head, examines
nonzero meaningful completed steps and trusted runner provenance, and
authenticates the produced artifact and the exact compiler/guest source
identities. Never promote a source-free Node test or host stub into a real
compiler/guest or target-hardware result.

A GitHub job that fails before any steps execute is **NOT_EXECUTED**, not an
executed failing guest test. Do not erase either distinction by counting a
synthetic positive fixture or by simply rerunning a zero-step job without
fixing the runner admission failure. Preserve raw evidence and independent
review before publication.
