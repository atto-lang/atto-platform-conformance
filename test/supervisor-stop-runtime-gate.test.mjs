import test from "node:test";
import assert from "node:assert/strict";
import {
  readSupervisorStopRuntimeGate,
  validateSupervisorStopRuntimeGate
} from "../bin/validate-supervisor-stop-runtime-gate.mjs";

test("runtime gate reports host STOP only, never five-backend guest STOP parity", () => {
  assert.deepEqual(validateSupervisorStopRuntimeGate(readSupervisorStopRuntimeGate()), {
    backends: 5, focusedHostStop: 2, hostStopLedger: 5, sourceStopPlan: 1, guestSourceParity: 0, currentHeadCertified: 0, releaseStatus: "HOLD"
  });
});

test("unreviewed edits cannot promote a parser or host test to guest CONTROL parity", () => {
  for (const backend of ["java", "llvm", "wasm", "cranelift", "net"]) {
    const changed = structuredClone(readSupervisorStopRuntimeGate());
    changed.backendGate[backend].guestSourceParity = true;
    assert.throws(() => validateSupervisorStopRuntimeGate(changed), /fabricated or stale/);
  }
  for (const backend of ["llvm", "wasm", "cranelift", "net"]) {
    const changed = structuredClone(readSupervisorStopRuntimeGate());
    changed.backendGate[backend].sourceStopPlan = true;
    assert.throws(() => validateSupervisorStopRuntimeGate(changed), /fabricated or stale/);
  }
});

test("host STOP ledger test evidence cannot silently grant guest execution", () => {
  const original = readSupervisorStopRuntimeGate();
  for (const backend of original.backends) {
    const altered = structuredClone(original);
    altered.backendGate[backend].hostStopLedger = false;
    assert.throws(() => validateSupervisorStopRuntimeGate(altered),
      /fabricated or stale/, backend);
  }
  for (const backend of ["wasm","cranelift","net"]) {
    const altered = structuredClone(original);
    altered.backendGate[backend].focusedHostStop = true;
    assert.throws(() => validateSupervisorStopRuntimeGate(altered),
      /fabricated or stale/, backend);
  }
});

test("historical host ledgers cannot certify changed current-head CI", () => {
  const original = readSupervisorStopRuntimeGate();
  for (const backend of original.backends) {
    const mutant = structuredClone(original);
    mutant.currentHeadGate.executedSourceOrgCurrentHeadCI[backend] = true;
    assert.throws(() => validateSupervisorStopRuntimeGate(mutant),
      /current-head certification/, backend);
  }
  assert.equal(original.currentHeadGate.privateMirrorAuthorized, false);
  assert.equal(original.currentHeadGate.status, "HOLD");
  assert.deepEqual(original.currentHeadGate.unresolvedSecurityIncidents,
    [22, 77, 127, 171, 172]);
});

test("STOP receipt ABI and identity-fence obligations cannot silently drift", () => {
  const mutations = [
    g => g.logicalFailureFields.splice(4, 1),
    g => g.stopTurnFields.splice(2, 1),
    g => g.lifecycleOrder.reverse(),
    g => g.enforce.splice(6, 1),
    g => g.enforce.push("retry-ambiguous-host-stop"),
    g => g.backends.pop(),
    g => g.backendGate.net.hostStopLedger = false,
    g => g.backendGate.wasm.hostStopLedger = false,
    g => g.backendGate.cranelift.hostStopLedger = false,
    g => g.backendGate.java.hostStopLedger = false,
    g => g.currentHeadGate.status = "MERGEABLE",
    g => g.currentHeadGate.privateMirrorAuthorized = true,
    g => g.currentHeadGate.executedSourceOrgCurrentHeadCI.java = true,
    g => g.currentHeadGate.executedSourceOrgCurrentHeadCI.wasm = true,
    g => g.currentHeadGate.unresolvedSecurityIncidents.pop(),
    g => g.currentHeadGate.sourceHeads.cranelift = "0".repeat(40),
    g => delete g.currentHeadGate,
    g => g.evidence.netLedger = g.evidence.llvmControl,
    g => delete g.evidence.wasmLedger,
    g => g.backendGate.net.focusedHostStop = true,
    g => g.backendGate.java.focusedHostStop = false,
    g => g.backendGate.llvm.sourceStopPlan = true,
    g => g.backendGate.forge = {guestSourceParity: true},
    g => g.evidence.llvmControl = g.evidence.javaControl,
    g => delete g.evidence.javaCompiler,
    g => g.evidenceClass = "guest-runtime-verified",
    g => g.scope = "full-supervisor-control",
    g => g.extra = true,
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(readSupervisorStopRuntimeGate());
    mutate(changed);
    assert.throws(() => validateSupervisorStopRuntimeGate(changed),
      /STOP runtime gate/, String(mutate));
  }
});
