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

Every stage requires an exact source commit, a **positive safe-integer**
count of executed CI steps, an explicit `workflowConclusion: "success"`, and
a SHA-256 digest for the tested target artifact. Omitted, queued, cancelled or
failed workflow conclusions are not admitted, nor are fractional or imprecisely
large step counts. A job that fails before any steps, or documentation saying
that a test exists, is not execution evidence.

These fields are *receipt assertions*, not independently authenticated CI data.
Passing this shape validator alone must never be described as a real compiler
test, verified binary provenance, or authorization to publish private source.
Reviewers must compare claims with the actual source-org workflow, runner-backed
steps and artifacts before promoting any capability.

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

The verifier treats `platform-capabilities-v1.json` as a **strict v1 policy**,
not an editable suggestion. Alongside the exact stage order and registered
repository names, it checks each platform's `targetClass`, the complete
`promotionRules` stage-key set and ordered requirements, the complete
`nonEvidence` exclusions, and the allowed top-level/platform fields.
Altered, omitted or injected policy fields fail closed even when an otherwise
valid receipt satisfies the verifier's hardcoded stage checks. Future policy
changes must explicitly version the schema and update implementation/tests;
editing a supplied JSON contract cannot weaken or silently redefine v1.

The contract and receipt contain **self-reported evidence metadata**, not
trusted attestation. Never accept the schema validator alone as authorization
to export private Git objects or as proof of a real source-compiler run.

## Platform registry

v1 registers `mobile`, `desktop`, `embedded`, `iot`, `fpga`, and
`asic` and binds each identifier to its canonical private repository. This
prevents a receipt for one repository from being presented as evidence for a
different platform. The verifier performs an **own-key registry check**:
inherited JavaScript property names such as `__proto__`, `constructor` and
`toString`, and non-string platform identifiers, are not registered platforms.
An omitted receipt repository never counts as a match for an inherited key.

The CLI emits a fixed `INVALID_OR_UNREADABLE_JSON_INPUT` code for malformed
or inaccessible receipt/contract JSON, rather than copying filesystem errors,
private checkout paths or hostile input fragments into CI logs. Only the
structured validation errors in an accessible receipt are reported verbatim.
A passing schema validation remains an assertion about evidence shape, not
independent workflow authentication or private-source publication approval.

This contract should be referenced by each platform repo as its promotion gate.
