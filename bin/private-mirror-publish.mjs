#!/usr/bin/env node
/**
 * DISABLED private source publisher. Legacy Git object/blob/ref copy logic
 * was deliberately removed after historical private-source exposure.
 *
 * Neither GITHUB_TOKEN, a private carrier, a source SHA, matching Git blobs,
 * nor an environment allowlist constitutes independent protected-main
 * transfer authorization. No network access, Git objects, or writes are
 * performed by this module. Keep this gate fail-closed.
 */
import {pathToFileURL} from "node:url";

export async function publishPrivateMirror({
  source, destination, sourceCommit, destinationBaseCommit, prefix, newBranch,
  approvedDestinations, token, fetchImpl = fetch
}) {
  // Defense in depth: unconditionally deny even a direct module import.
  throw Error("PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    // Arguments are accepted only for backward-compatible failure semantics.
    // They never become credentials for GitHub requests or source operations.
    if (process.argv.length !== 8) throw Error("private mirror CLI requires six arguments");
    await publishPrivateMirror({
      source: process.argv[2], sourceCommit: process.argv[3],
      destination: process.argv[4], destinationBaseCommit: process.argv[5],
      prefix: process.argv[6], newBranch: process.argv[7],
      approvedDestinations: (process.env.ORES_APPROVED_PRIVATE_MIRRORS || "").split(",").filter(Boolean),
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    });
  } catch {
    console.error("PRIVATE_MIRROR_DENIED: confidential source copy rejected");
    process.exitCode = 1;
  }
}
