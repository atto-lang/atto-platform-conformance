import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync, lstatSync, realpathSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

// Source-only acceptance targets, not execution receipts.
// Tuple: file, exact Git blob, expected exit, expected stdout.
// null exit means compiler rejection without IR/artifact.
const pins = [
  [
    "trap-sync-task-defer.atto",
    "bcd5e2692aaaaf4c4c070a5746cd6c3ab9e5082a",
    42,
    "D"
  ],
  [
    "trap-sync-task-defer-process.atto",
    "c511c17818f725c9fc5d52a129ca257790276477",
    42,
    "D"
  ],
  [
    "truth-table.atto",
    "bdd0bef8ed41125819515d2ebb08362c524febb4",
    42,
    ""
  ],
  [
    "keyword-short-circuit.atto",
    "f3442ff5286983278cbecc01255d0184869580cf",
    42,
    ""
  ],
  [
    "reject-non-bool.atto",
    "b746291a1611302773e7c3fc57aa2b02ed44c82b",
    null,
    null
  ],
  [
    "reject-fallthrough.atto",
    "11949e9065098f4e994d49afd48decde01cf969c",
    null,
    null
  ]
];
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = join(root, "fixtures/guard-condition-list-v1");
const blob = bytes => createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
test("guard condition list: pinned source inventory only; guest status NOT_EXECUTED", () => {
    assert.equal(realpathSync(dir), dir);
    assert.deepEqual(readdirSync(dir).sort(), pins.map(p => p[0]).sort());
    for (const [name, sha, exit, stdout] of pins) {
        const path = join(dir, name);
        assert.ok(lstatSync(path).isFile());
        assert.equal(realpathSync(path), path);
        assert.equal(blob(readFileSync(path)), sha, name);
        if (exit === null) assert.equal(stdout, null);
        else assert.equal(exit, 42);
    }
});
