import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(new URL("../bin/verify-platform-capability-receipt.mjs", import.meta.url));
const contractPath = fileURLToPath(new URL("../contracts/platform-capabilities-v1.json", import.meta.url));
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const receipt = {
  schema: "oreslang.platform-capability/1",
  platform: "desktop",
  repository: "ores-truffle-oreslang/oreslang-platform.desktop",
  sourceCommit: "a".repeat(40),
  stage: "compiler-guest",
  evidence: {
    exactHead: true,
    executedSteps: 3,
    workflowConclusion: "success",
    targetArtifactSha256: "b".repeat(64),
    abiLinked: true,
    hostReferenceOnly: false,
    compilerProduced: true,
    compilerSourceCommit: "c".repeat(40),
    compilerBinarySha256: "d".repeat(64),
  },
};

const invoke = (...args) => {
  const result = spawnSync(process.execPath, [executable, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, "CLI process launch failed");
  assert.equal(result.signal, null, "CLI terminated by signal");
  return result;
};

function withFixture(callback) {
  const dir = mkdtempSync(join(tmpdir(), "atto-capability-cli-"));
  try {
    const receiptPath = join(dir, "receipt.json");
    const alternateContractPath = join(dir, "contract.json");
    writeFileSync(receiptPath, JSON.stringify(receipt));
    writeFileSync(alternateContractPath, JSON.stringify(contract));
    callback({ receiptPath, alternateContractPath, dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("successful receipt shape is clearly NOT authenticated guest evidence", () => {
  withFixture(({ receiptPath }) => {
    const result = invoke(receiptPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \(SCHEMA_ONLY; NOT_AUTHENTICATED;/u);
    assert.match(result.stdout, /independent CI\/artifact review required/u);
    assert.doesNotMatch(result.stdout, /\b(?:GUEST_VERIFIED|PARITY_CERTIFIED|PHYSICAL_VERIFIED)\b/u);
  });
});

test("zero-step receipts must fail even when workflow conclusion says success", () => {
  withFixture(({ receiptPath }) => {
    const forged = structuredClone(receipt);
    forged.evidence.executedSteps = 0;
    writeFileSync(receiptPath, JSON.stringify(forged));
    const result = invoke(receiptPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /executedSteps.*zero-step/u);
    assert.doesNotMatch(result.stdout, /PASS/u);
  });
});

test("substituted v1 promotion rules cannot be used as an alternate policy", () => {
  withFixture(({ receiptPath, alternateContractPath }) => {
    const changed = structuredClone(contract);
    changed.promotionRules["compiler-guest"] = [];
    writeFileSync(alternateContractPath, JSON.stringify(changed));
    const result = invoke(receiptPath, alternateContractPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /promotionRules mismatch for compiler-guest/u);
    assert.doesNotMatch(result.stdout, /PASS/u);
  });
});

test("malformed JSON and absent receipt fail closed", () => {
  withFixture(({ receiptPath, dir }) => {
    writeFileSync(receiptPath, '{"schema":');
    const malformed = invoke(receiptPath);
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /platform receipt:/u);
    assert.doesNotMatch(malformed.stdout, /PASS/u);

    const absent = invoke(join(dir, "absent.json"));
    assert.equal(absent.status, 1);
    assert.doesNotMatch(absent.stdout, /PASS/u);
  });
});

test("missing positional receipt argument rejects with usage code 64", () => {
  const result = invoke();
  assert.equal(result.status, 64);
  assert.match(result.stderr, /usage: verify-platform-capability-receipt/u);
  assert.doesNotMatch(result.stdout, /PASS/u);
});
