import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, openSync, fstatSync, readSync, closeSync, readdirSync, constants, symlinkSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

// SOURCE-FREE contract validation. These tests NEVER claim Oreslang compiler,
// guest runtime, physical quiescence, or five-backend parity.
const dir = fileURLToPath(new URL("../fixtures/future-chaining/v2/", import.meta.url));
function readPinnedRegularFile(full, filename, maxSize) {
    // O_NOFOLLOW closes the lstat/open symlink-swap window; O_NONBLOCK
    // prevents a substituted FIFO from hanging the conformance runner.
    assert.ok(Number.isInteger(constants.O_NOFOLLOW)
        && Number.isInteger(constants.O_NONBLOCK),
        "safe no-follow fixture admission is unsupported on this platform");
    const fd = openSync(full,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = fstatSync(fd);
        assert.ok(stat.isFile(), `not an ordinary fixture: ${filename}`);
        assert.ok(stat.size > 0 && stat.size < maxSize, `size outside cap: ${filename}`);
        const raw = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < raw.length) {
            const count = readSync(fd, raw, offset, raw.length - offset, offset);
            assert.ok(count > 0, `shortened during read: ${filename}`);
            offset += count;
        }
        const extra = Buffer.alloc(1);
        assert.equal(readSync(fd, extra, 0, 1, raw.length), 0,
            `grew during read: ${filename}`);
        return raw;
    } finally {
        closeSync(fd);
    }
}

const manifest = JSON.parse(readPinnedRegularFile(
    path.join(dir, "manifest.json"), "manifest.json", 65536).toString("utf8"));
const caseMap = new Map(manifest.cases.map((entry) => [entry.id, entry]));
const expectedCaseContracts = new Map([
    ["flat-map-one-layer", { kind: "positive", stdout: "42", type: "Future<int>" }],
    ["flat-map-preserves-deeper-nesting", { kind: "positive", stdout: "84", type: "Future<Future<int>>" }],
    ["map-preserves-nested", { kind: "positive", stdout: "42", type: "Future<Future<int>>" }],
    ["flatten-one-layer", { kind: "positive", stdout: "42", type: "Future<int>" }],
    ["reject-flat-map-scalar", { kind: "compile_reject", diagnosticCategory: "FUTURE_CALLBACK_NOT_FUTURE" }],
    ["reject-flat-map-deeper-nesting", { kind: "compile_reject", diagnosticCategory: "WRAPPER_LAYER_MISMATCH" }],
    ["reject-implicit-map-flatten", { kind: "compile_reject", diagnosticCategory: "WRAPPER_LAYER_MISMATCH" }],
    ["reject-one-await-flatten", { kind: "compile_reject", diagnosticCategory: "WRAPPER_LAYER_MISMATCH" }],
]);

function gitBlobSha1(bytes) {
    return createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
}

function fixture(id) {
    const record = caseMap.get(id);
    assert.ok(record, `missing case: ${id}`);
    const filename = record.source;
    assert.match(filename, /^[a-z0-9-]+\.ores$/);
    const full = path.join(dir, filename);
    const raw = readPinnedRegularFile(full, filename, 4096);
    assert.match(record.sourceGitBlobSha1, /^[a-f0-9]{40}$/, `missing source blob pin: ${filename}`);
    assert.equal(gitBlobSha1(raw), record.sourceGitBlobSha1, `fixture content drift: ${filename}`);
    const code = raw.toString("utf8");
    assert.deepEqual(Buffer.from(code, "utf8"), raw, `invalid UTF-8: ${filename}`);
    assert.ok(code.endsWith("\n"), `missing terminal newline: ${filename}`);
    assert.equal(code.includes("\r"), false, `non-LF line endings: ${filename}`);
    assert.match(code, /pub (?:suspends )?fnc main\(\): void/);
    return code;
}

test("v2 conformance manifest never promotes unexecuted source", () => {
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.contract, "future-chaining-explicit-layers-v2");
    assert.equal(manifest.status, "proposal-not-executable");
    assert.equal(manifest.sourceExecutionVerified, false);
    assert.equal(manifest.runtimeVerified, false);
    assert.equal(manifest.caseStatusDefault, "pending");
    assert.deepEqual(Object.keys(manifest.backendStatus).sort(),
        ["forge", "java-graalvm", "llvm", "net", "wasm"]);
    for (const value of Object.values(manifest.backendStatus)) {
        assert.equal(value, "pending");
    }
    assert.deepEqual(manifest.evidence, []);
    assert.equal(manifest.cases.length, expectedCaseContracts.size);
    assert.equal(caseMap.size, expectedCaseContracts.size, "duplicate case identifiers are forbidden");
    assert.deepEqual([...caseMap.keys()].sort(), [...expectedCaseContracts.keys()].sort(),
        "case identifiers must match the v2 acceptance contract exactly");
    assert.equal(new Set(manifest.cases.map((entry) => entry.source)).size, expectedCaseContracts.size,
        "multiple cases must not silently reuse one fixture");

    const files = readdirSync(dir).filter((entry) => entry.endsWith(".ores")).sort();
    assert.deepEqual(
        files, manifest.cases.map((entry) => entry.source).sort(),
        "orphaned and missing fixtures must fail");
    for (const entry of manifest.cases) {
        const expected = expectedCaseContracts.get(entry.id);
        assert.ok(expected, `unexpected case: ${entry.id}`);
        assert.equal(entry.status, "pending");
        assert.equal(entry.verified, false);
        assert.equal(entry.kind, expected.kind);
        assert.ok(entry.assert?.length > 0);
        if (entry.kind === "positive") {
            assert.deepEqual(entry.expected, { stdout: expected.stdout, type: expected.type },
                `positive expectation drift: ${entry.id}`);
        } else {
            assert.deepEqual(entry.expected, { diagnosticCategory: expected.diagnosticCategory },
                `negative expectation drift: ${entry.id}`);
        }
        fixture(entry.id);
    }
});

test("source blob identity changes when a fixture is modified", () => {
    const record = caseMap.get("flat-map-one-layer");
    const original = readFileSync(path.join(dir, record.source));
    const mutated = Buffer.from(original);
    mutated[0] ^= 1;
    assert.equal(gitBlobSha1(original), record.sourceGitBlobSha1);
    assert.notEqual(gitBlobSha1(mutated), record.sourceGitBlobSha1);
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

test("flat_map flattens one layer but preserves a deeper Future", () => {
    const positive = fixture("flat-map-preserves-deeper-nesting");
    assert.match(positive, /Future<Future<int>> nested\s*=\s*seed\(\)\.flat_map\(/);
    assert.match(positive, /return double_it\(number\)\.map\(/);
    assert.match(positive, /Future<int> inner\s*=\s*await nested/);
    assert.match(positive, /await inner/);
    const negative = fixture("reject-flat-map-deeper-nesting");
    assert.match(negative, /Future<int> invalid\s*=\s*seed\(\)\.flat_map\(/);
    assert.match(negative, /return double_it\(number\)\.map\(/);
});

test("no-follow reader rejects symlinks and directories without following them", () => {
    const temp = mkdtempSync(path.join(tmpdir(), "ores-future-fixtures-"));
    try {
        const original = path.join(temp, "real.ores");
        const link = path.join(temp, "linked.ores");
        writeFileSync(original, "safe\n");
        symlinkSync(original, link);
        assert.equal(readPinnedRegularFile(original, "real.ores", 4096).toString(), "safe\n");
        assert.throws(() => readPinnedRegularFile(link, "linked.ores", 4096),
            { code: "ELOOP" }, "a symlink must not be followed even if it targets a regular file");
        assert.throws(() => readPinnedRegularFile(temp, "directory", 4096),
            /not an ordinary fixture/, "directories must be rejected after fd admission");
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
});
