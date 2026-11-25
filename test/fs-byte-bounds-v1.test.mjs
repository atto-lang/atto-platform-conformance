import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditFsByteBoundsContract } from "../lib/fs-byte-bounds-v1.mjs";

const fixture = new URL("../contracts/fs-byte-bounds-v1.json", import.meta.url);
const read = async () => JSON.parse(await readFile(fixture, "utf8"));
const modify = (v, fn) => { const copy = structuredClone(v); fn(copy); return copy; };

function shapedReceipt(repository) {
  return {
    repository,
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
    compilerArtifactSha256: "c".repeat(64),
    runId: 123,
    runAttempt: 1,
    jobId: 456,
    runUrl: "https://github.com/" + repository + "/actions/runs/123",
    executedSteps: 5,
    actualCompiledGuest: true,
    staticOnly: false
  };
}
test("all five target backends remain unverified, not secretly promoted", async () => {
  const x = await read();
  const v = auditFsByteBoundsContract(x);
  assert.equal(v.ok, true, v.errors.join(", "));
  assert.equal(v.evidenceClass, "shape-only");
  assert.equal(v.runtimeParityCertified, false);
  assert.deepEqual(x.backends.map(b => b.id).sort(), ["forge", "java", "llvm", "net", "wasm"]);
  assert.equal(x.vectors.length, 14);
  for (const b of x.backends) {
    assert.equal(b.status, "unverified");
    assert.equal(b.receipt, null);
  }
});
test("duplicate or missing backend and vectors fail closed", async () => {
  const x = await read();
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.backends[0].id = m.backends[1].id)).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.backends.pop())).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.vectors[0].id = m.vectors[1].id)).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.vectors.pop())).ok, false);
});
test("neither a status bit nor a zero-step CI receipt proves a guest run", async () => {
  const x = await read();
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.backends[0].status = "supported")).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    const b = m.backends[0]; b.status = "supported";
    b.receipt = shapedReceipt(b.repo);
    b.receipt.executedSteps = 0;
  })).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    const b = m.backends[0]; b.status = "supported";
    b.receipt = shapedReceipt(b.repo);
    b.receipt.actualCompiledGuest = false;
  })).ok, false);
});
test("external repository, missing compiler SHA, and unsupported without denial are invalid", async () => {
  const x = await read();
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    const b = m.backends[0]; b.status = "supported";
    b.receipt = shapedReceipt(b.repo); b.receipt.repository = "some-other-org/not-source";
  })).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    const b = m.backends[0]; b.status = "supported";
    b.receipt = shapedReceipt(b.repo); delete b.receipt.compilerArtifactSha256;
  })).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    const b = m.backends[0]; b.status = "unsupported-verified";
    b.receipt = shapedReceipt(b.repo);
  })).ok, false);
});
test("receipt-shaped synthetic data is still not authenticated or certified", async () => {
  const x = await read();
  const futureCandidate = modify(x, m => {
    const b = m.backends[0]; b.status = "supported"; b.receipt = shapedReceipt(b.repo);
  });
  const checked = auditFsByteBoundsContract(futureCandidate);
  assert.equal(checked.ok, true, checked.errors.join(", "));
  assert.equal(checked.runtimeParityCertified, false);
  assert.equal(checked.evidenceClass, "shape-only");
});
test("unsafe policy relaxation and invented five-backend certification fail", async () => {
  const x = await read();
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.evidencePolicy.privateSourceTransferAllowedByThisContract = true)).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.certification.fiveBackendRuntimeParity = true)).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.authority.snapshotConsistencyClaimed = true)).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => m.api.canonicalBlockingSuffix = "")).ok, false);
});

test("parent-symlink existing and missing targets must deny before path resolution", async () => {
  const x = await read();
  assert.equal(auditFsByteBoundsContract(x).ok, true);
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    m.authority.rejectAncestorSymlinkBeforeCanonicalResolution = false;
  })).ok, false);
  assert.equal(auditFsByteBoundsContract(modify(x, m => {
    m.authority.parentSymlinkExistingMissingDenyEqually = false;
  })).ok, false);
  for (const id of ["FS-07", "FS-12", "FS-13"]) {
    assert.equal(auditFsByteBoundsContract(modify(x, m => {
      m.vectors.find(v => v.id === id).ancestorSymlinkCases = ["existing"];
    })).ok, false);
    assert.equal(auditFsByteBoundsContract(modify(x, m => {
      m.vectors.find(v => v.id === id).denialPhase = "after-resolution";
    })).ok, false);
  }
});

test("each FS case preserves the bound kind, case, expected outcome and field shape", async () => {
  const x = await read();
  for (const v of x.vectors) {
    for (const [key, replacement] of [
      ["case", "changed-case"],
      ["kind", v.kind === "read" ? "write" : "read"],
      ["expected", v.expected === "deny" ? "accept" : "deny"]
    ]) {
      const changed = modify(x, m => { m.vectors.find(t => t.id === v.id)[key] = replacement; });
      assert.equal(auditFsByteBoundsContract(changed).ok, false,
        `${v.id} accepted a modified ${key}`);
    }
    assert.equal(auditFsByteBoundsContract(modify(x, m => {
      m.vectors.find(t => t.id === v.id).certified = true;
    })).ok, false, `${v.id} accepted an unreviewed field`);
  }
});
