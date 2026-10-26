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
