import {test} from "node:test";
import assert from "node:assert/strict";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";
import {
  source, destination, A, T, fixture,
  incidentPath22, incidentPath77, incidentPath127, incidentPath212,
  incidentPath171, incidentPath172, incidentPath198, incidentPath200,
  incidentPath252, incident22, incident77, incident127, incident212,
  incident171, incident172, incident198, incident200, incident252
} from "./private-ci-authorization-fixture.mjs";

// Test fixtures are fictional completions, never transfer authorizations.
// Exercise the real publisher's public entrypoint, not just its guard module.
const incidents = [
  [incidentPath22, incident22], [incidentPath77, incident77],
  [incidentPath127, incident127], [incidentPath212, incident212],
  [incidentPath171, incident171], [incidentPath172, incident172],
  [incidentPath198, incident198], [incidentPath200, incident200],
  [incidentPath252, incident252]
];
const issuePrefix =
  "https://api.github.com/repos/ores-truffle-oreslang/oreslang-platform-conformance/issues/";
const opts = {
  source, destination, sourceCommit: A, sourceTree: T,
  destinationBaseCommit: "c".repeat(40),
  prefix: "snapshots/checked", newBranch: "ci/private-denial-test",
  approvedDestinations: [destination], token: "restricted-test-token"
};

for (const [index, [path, incident]] of incidents.entries()) {
  test(`private publisher denies unresolved carrier incident ${path.split("/").at(-1)} before ANY source read or destination write`, async () => {
    const rawCalls = [];
    const authorizedFixture = fixture({
      [path]: {...incident, state: "open", state_reason: null, closed_at: null}
    });
    const fetchImpl = async (url, options) => {
      // Record before calling the synthetic fetch, including attempted writes.
      rawCalls.push({url, method: options?.method});
      return authorizedFixture(url, options);
    };
    await assert.rejects(
      publishPrivateMirror({...opts, fetchImpl}),
      /P0 private-source incident is not completed with exact identity/
    );
    assert.equal(rawCalls.length, index + 1,
      "the failing incident must terminate admission without subsequent requests");
    for (const call of rawCalls) {
      assert.equal(call.method, "GET", "no destination mutation is permitted");
      assert.ok(call.url.startsWith(issuePrefix),
        "only incident disposition may be read, never source or destination metadata");
    }
    assert.equal(rawCalls.at(-1).url,
      "https://api.github.com/repos/" + path,
      "admission must reject at the exact unresolved incident");
  });
}
