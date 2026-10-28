import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

// SOURCE-FREE contract validation. These tests NEVER claim Oreslang compiler,
// guest runtime, physical quiescence, or five-backend parity.
const dir = fileURLToPath(new URL("../fixtures/future-chaining/v2/", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const caseMap = new Map(manifest.cases.map((entry) => [entry.id, entry]));

function fixture(id) {
    const record = caseMap.get(id);
    assert.ok(record, `missing case: ${id}`);
    const filename = record.source;
    assert.match(filename, /^[a-z0-9-]+\.ores$/);
    const full = path.join(dir, filename);
    const stat = lstatSync(full);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `not an ordinary fixture: ${filename}`);
    assert.ok(stat.size > 0 && stat.size < 4096, `fixture size outside cap: ${filename}`);
    const code = readFileSync(full, "utf8");
    assert.ok(code.endsWith("\n"), `missing terminal newline: ${filename}`);
    assert.equal(code.includes("\r"), false, `non-LF line endings: ${filename}`);
    assert.match(code, /pub (?:suspends )?fnc main\(\): void/);
    return code;
}

test("v2 conformance manifest never promotes unexecuted source", () => {
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.contract, "future-chaining-explicit-layers-v2");
    assert.equal(manifest.sourceExecutionVerified, false);
    assert.equal(manifest.runtimeVerified, false);
    assert.equal(manifest.caseStatusDefault, "pending");
    assert.deepEqual(Object.keys(manifest.backendStatus).sort(),
        ["forge", "java-graalvm", "llvm", "net", "wasm"]);
    for (const value of Object.values(manifest.backendStatus)) {
        assert.equal(value, "pending");
    }
    assert.deepEqual(manifest.evidence, []);
    assert.equal(manifest.cases.length, 6);
    assert.equal(caseMap.size, 6, "duplicate case identifiers are forbidden");

    const files = readdirSync(dir).filter((entry) => entry.endsWith(".ores")).sort();
    assert.deepEqual(
        files, manifest.cases.map((entry) => entry.source).sort(),
        "orphaned and missing fixtures must fail");
    for (const entry of manifest.cases) {
        assert.equal(entry.status, "pending");
        assert.equal(entry.verified, false);
        assert.ok(["positive", "compile_reject"].includes(entry.kind));
        assert.ok(entry.assert?.length > 0);
        if (entry.kind === "positive") {
            assert.equal(entry.expected.stdout, "42");
            assert.equal(entry.expected.diagnosticCategory, undefined);
        } else {
            assert.match(entry.expected.diagnosticCategory, /^[A-Z_]+$/);
            assert.equal(entry.expected.stdout, undefined);
        }
        const code = fixture(entry.id);
        assert.equal(createHash("sha256").update(code).digest("hex").length, 64);
    }
});

test("map does not accidentally become a flattening combinator", () => {
    const code = fixture("map-preserves-nested");
    assert.match(code, /Future<Future<int>> nested\s*=\s*seed\(\)\.map\(/);
    assert.match(code, /Future<int> inner\s*=\s*await nested/);
    assert.match(code, /await inner/);
    const invalid = fixture("reject-implicit-map-flatten");
    assert.match(invalid, /Future<int> invalid\s*=\s*seed\(\)\.map\(/);
});

test("flat_map is explicit and requires a Future-returning callback", () => {
    const code = fixture("flat-map-one-layer");
    assert.match(code, /Future<int> result\s*=\s*seed\(\)\.flat_map\(/);
    assert.match(code, /return double_it\(number\)/);
    const invalid = fixture("reject-flat-map-scalar");
    assert.match(invalid, /\.flat_map\(/);
    assert.match(invalid, /return number \* 2/);
    assert.doesNotMatch(invalid, /return double_it\(/);
});

test("explicit flatten and await each remove only one layer", () => {
    const code = fixture("flatten-one-layer");
    assert.match(code, /Future<Future<int>> nested/);
    assert.match(code, /Future<int> inner\s*=\s*nested\.flatten\(\)/);
    const invalid = fixture("reject-one-await-flatten");
    assert.match(invalid, /Future<Future<int>> nested/);
    assert.match(invalid, /val int invalid\s*=\s*await nested/);
});
