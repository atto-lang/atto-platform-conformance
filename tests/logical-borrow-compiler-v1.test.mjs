import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const contract = JSON.parse(readFileSync(
    new URL("../contracts/logical-borrow-compiler-v1.json", import.meta.url), "utf8"));

function gitBlob(buffer) {
    const prefix = Buffer.from("blob " + buffer.length + "\0", "ascii");
    return createHash("sha1").update(prefix).update(buffer).digest("hex");
}

test("two canonical guest fixtures have immutable reviewed Git blobs", () => {
    assert.equal(contract.schemaVersion, 1);
    assert.equal(contract.status, "candidate-not-certified");
    assert.equal(contract.sourceExtension, ".atto");
    assert.deepEqual(contract.targets, ["java", "llvm", "wasm", "forge", "net"]);
    assert.deepEqual(contract.scenarios.map(x => x.id),
        ["owned-take-positive", "use-after-take-reject"]);
    for (const scenario of contract.scenarios) {
        const source = readFileSync(new URL(
            "../fixtures/logical-borrow-compiler-v1/" + scenario.fixture,
            import.meta.url));
        assert.equal(gitBlob(source), scenario.gitBlob, scenario.id);
        assert.match(source.toString("utf8"), /rt take owner/);
        assert.match(source.toString("utf8"), /pub fnc main\(\): void/);
    }
});

test("the positive and negative fixtures differ only in authorized post-move access", () => {
    const [positive, negative] = contract.scenarios;
    assert.equal(positive.expectation, "compile-and-run");
    assert.equal(positive.expectedStdout, "42");
    assert.equal(positive.requiredProof, "real-source-compiler-and-guest-execution");
    assert.equal(negative.expectation, "reject");
    assert.equal(negative.expectedDiagnostic, "moved");
    assert.deepEqual(negative.expectedDiagnostics, {
        java: "Oreslang ownership error: use of moved value 'owner'",
        llvm: "use of explicitly moved int 'owner'",
    });
    assert.equal(negative.requiredProof, "semantic-ownership-diagnostic-before-IR");
    const file = name => readFileSync(new URL(
        "../fixtures/logical-borrow-compiler-v1/" + name, import.meta.url), "utf8");
    assert.match(file(positive.fixture), /stdout\.write\(moved \+ 1\)/);
    assert.match(file(negative.fixture), /stdout\.write\(owner\)/);
});

test("source-free tests and zero-step jobs never promote backend parity", () => {
    assert.deepEqual(Object.keys(contract.evidence), contract.targets);
    for (const backend of contract.targets)
        assert.equal(contract.evidence[backend], "NOT_EXECUTED");
    const promotion = contract.promotion;
    assert.equal(promotion.exactHeadAndTree, true);
    assert.equal(promotion.compilerExecution, true);
    assert.equal(promotion.guestExecutionForAccept, true);
    assert.equal(promotion.semanticDiagnosticForReject, true);
    assert.equal(promotion.zeroStepCounts, false);
    assert.equal(promotion.sourceFreeCounts, false);
    assert.equal(promotion.parserUnsupportedCounts, false);
});
