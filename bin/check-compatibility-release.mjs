#!/usr/bin/env node
import {
  loadCompatibilityCandidate,
  loadCandidateInventory,
  validateCompatibilityCandidate
} from "../src/compatibility-release.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--require-ready")) {
    throw Error("Usage: node bin/check-compatibility-release.mjs [--require-ready]");
  }
  const result = validateCompatibilityCandidate(
    loadCompatibilityCandidate(), loadCandidateInventory());
  console.log(JSON.stringify(result, null, 2));
  if (args[0] === "--require-ready" && !result.releaseReady) {
    console.error("RELEASE_BLOCKED: pinned revisions have no authenticated cross-repo compatibility evidence");
    process.exitCode = 3;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
