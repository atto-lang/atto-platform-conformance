import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const cli = fileURLToPath(new URL("../bin/private-mirror-publish.mjs", import.meta.url));

test("incident hold prevents legacy CLI copy despite environment allowlist", () => {
  const result = spawnSync(process.execPath, [
    cli, "ores-truffle-oreslang/oreslang-source.java", "a".repeat(40),
    "akrion-sim/akrion-sim-e2e", "b".repeat(40), "snapshots/source",
    "ci/private-source-proof"
  ], {
    env: {
      ...process.env,
      GH_TOKEN: "offline-synthetic-token",
      ORES_APPROVED_PRIVATE_MIRRORS: "akrion-sim/akrion-sim-e2e",
    },
    timeout: 5000,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /PRIVATE_MIRROR_SUSPENDED/);
  assert.doesNotMatch(result.stdout, /PRIVATE_MIRROR_PUBLISHED/);
});
