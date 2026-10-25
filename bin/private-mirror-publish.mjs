#!/usr/bin/env node
/**
 * Private-source export quarantine.
 *
 * Cross-repository private-source publication is disabled until Oreslang has
 * destination-specific authorization sourced from protected main, independent
 * security signoff, immutable repository-ID binding, and verified destination
 * ownership/visibility/permissions/retention controls.
 *
 * IMPORTANT: caller-supplied environment variables, workflow inputs, repository
 * names, or review state are not transfer authorization.
 */
import {pathToFileURL} from "node:url";

export async function publishPrivateMirror() {
  // This must be the first executable operation. Do not perform repository
  // discovery, source reads, destination writes, artifact uploads, or ref
  // creation before this gate.
  throw Error("PRIVATE_SOURCE_EXPORT_DISABLED");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await publishPrivateMirror();
  } catch {
    console.error("PRIVATE_MIRROR_DENIED: private-source export is quarantined");
    process.exitCode = 1;
  }
}
