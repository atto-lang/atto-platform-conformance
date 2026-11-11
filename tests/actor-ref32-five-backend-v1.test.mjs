import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  gitBlobSha1, validateActorRef32FiveBackendV1,
  verifyCurrentActorRef32FiveBackendV1
} from "../bin/verify-actor-ref32-five-backend-v1.mjs";

const manifest = JSON.parse(readFileSync(
  new URL("../contracts/actor-ref32-five-backend-v1.json", import.meta.url),
  "utf8"));
const source = readFileSync(
  new URL("../fixtures/actor-ref32-five-backend-v1/node_graph.atto",
    import.meta.url), "utf8");
const clone = () => structuredClone(manifest);

test("five requested compiler/toolchain backends only; source-free gate cannot certify", () => {
  const receipt = verifyCurrentActorRef32FiveBackendV1();
  assert.deepEqual(Object.keys(receipt).sort(), [
    "cases", "contract", "fiveBackends", "guestVerified",
    "nativeAotVerified", "sourceBlob", "zeroGcCertified"
  ].sort());
  assert.equal(receipt.fiveBackends, 5);
  assert.equal(receipt.cases, 15);
  assert.equal(receipt.sourceBlob, gitBlobSha1(source));
  assert.equal(receipt.guestVerified, false);
  assert.equal(receipt.nativeAotVerified, false);
  assert.equal(receipt.zeroGcCertified, false);
  assert.deepEqual(manifest.backends.map(b => b.id),
    ["java", "llvm", "wasm", "forge", "net"]);
});

test("private source and exact-head receipts must not be invented", () => {
  for (const mutate of [
    m => { m.backends[1].certified = true; },
    m => { m.backends[4].guestExecuted = true; },
    m => { m.backends[2].exactHeadReceipt = "stepful-but-unverified"; },
    m => { m.backends[0].observedMainHead = "0000"; },
    m => { m.backends[3].repository = "ores-truffle-oreslang/oreslang-source.js"; },
    m => { m.backends.reverse(); },
    m => { m.backends.pop(); },
    m => { m.zeroGcCertified = true; },
    m => { m.status = "CERTIFIED"; },
    m => { m.promotion.unapprovedMirroringAllowed = true; },
    m => { m.promotion.requiresIndependentSecurityReviewForPrivateExport = false; },
    m => { m.promotion.sourceFreeRunMayPromote = true; },
    m => { delete m.promotion.requiresNonzeroJobSteps; }
  ]) {
    const changed = clone(); mutate(changed);
    assert.throws(() => validateActorRef32FiveBackendV1(changed, source),
      /actor-ref32-five-backend-v1/);
  }
});

test("fixture bytes are pinned by git blob hash and source-language syntax", () => {
  for (const bad of [
    source.replace("42)", "43)"),
    source.replace("define actor", "define singleton"),
    source.replace("second.next?.value == 42", "second.value == 42"),
    source.replaceAll("\n", "\r\n"),
    source.slice(0, -1),
    source + " ".repeat(16 * 1024)
  ]) {
    assert.throws(() => validateActorRef32FiveBackendV1(clone(), bad),
      /actor-ref32-five-backend-v1/);
  }
  const changed = clone();
  changed.fixture.path = "../foreign-secret.atto";
  assert.throws(() => validateActorRef32FiveBackendV1(changed, source));
  changed.fixture.path = "fixtures/actor-ref32-five-backend-v1/node_graph.atto";
  changed.fixture.gitBlobSha1 = "f".repeat(40);
  assert.throws(() => validateActorRef32FiveBackendV1(changed, source));
});

test("every mandatory semantic case and evidence phase stays fail closed", () => {
  for (const mutate of [
    m => { m.cases.pop(); },
    m => { m.cases[1].id = m.cases[0].id; },
    m => { m.cases[7].sourceFixture = "fake-success.atto"; },
    m => { m.cases[0].kind = "measure"; },
    m => { m.cases[0].phase = "runtime"; },
    m => { m.cases[11].mandatory = false; },
    m => { m.cases[14].mandatory = true; },
    m => { m.cases[0].expected = ""; }
  ]) {
    const changed = clone(); mutate(changed);
    assert.throws(() => validateActorRef32FiveBackendV1(changed, source),
      /actor-ref32-five-backend-v1/);
  }
});
