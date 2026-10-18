#!/usr/bin/env node
import {loadCandidateInventory, loadCompatibilityCandidate} from "../src/compatibility-release.mjs";
import {auditPinnedProvenance, createGitHubReadonlyRequester} from "../src/pin-provenance.mjs";

// Purposefully opt-in: conformance's ordinary GITHUB_TOKEN cannot read
// 44 private peer repositories; use only an explicitly authorized read-only
// organization-wide GitHub App installation token (or equivalent).
// Never log the token, fetch any repository source, or export raw evidence.
async function main() {
  if (process.argv.length !== 2) throw Error("Usage: node bin/audit-compatibility-pins.mjs");
  const requestJson = createGitHubReadonlyRequester(process.env.ORESLANG_REPOSITORY_READ_TOKEN);
  const result = await auditPinnedProvenance(
    loadCompatibilityCandidate(), loadCandidateInventory(), requestJson);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
