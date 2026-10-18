#!/usr/bin/env node
/**
 * P0 incident hold (#22 and #77).
 *
 * This legacy entrypoint must not read private source, create Git objects,
 * create branches, or claim publication approval. Retired implementation is
 * preserved in Git history for forensics, not executable in this module.
 *
 * Any future publisher requires its own independently reviewed and merged
 * protected-branch policy; do not restore this function as an export path.
 */
import {pathToFileURL} from "node:url";

const SUSPENDED = "PRIVATE_MIRROR_SUSPENDED: legacy source transfer is disabled pending independent incident clearance and reviewed authorization";

// Deliberately do not inspect arguments, credentials, or injected fetchImpl.
// An imported caller must be denied before its first network operation.
export async function publishPrivateMirror(_request) {
  throw new Error(SUSPENDED);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.error(SUSPENDED);
  process.exitCode = 1;
}
