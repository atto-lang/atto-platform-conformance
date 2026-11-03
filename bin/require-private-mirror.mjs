#!/usr/bin/env node
/**
 * P0 INCIDENT HOLD: this legacy private-source mirror preflight is disabled.
 *
 * No arbitrary caller-provided source/destination pair, environment allowlist
 * or token can establish protected-main, independent, destination-specific
 * transfer authorization. A new reviewed implementation would need to live
 * behind a separate provenance-bound security policy and incident disposition.
 *
 * Do not restore the retired GitHub metadata lookup code here.
 */
import {pathToFileURL} from "node:url";

export async function requirePrivateMirror({
  source, destination, approvedDestinations, token, fetchImpl = fetch
} = {}) {
  // Incident containment LOCKDOWN. No API lookup or source Git object access.
  throw Error("PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw Error("usage: require-private-mirror.mjs <source-owner/repo> <destination-owner/repo>");
    await requirePrivateMirror({
      source: process.argv[2],
      destination: process.argv[3],
      approvedDestinations: (process.env.ORES_APPROVED_PRIVATE_MIRRORS || "").split(",").filter(Boolean),
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    });
  } catch {
    // A generic denial prevents accidental disclosure of tokens or metadata.
    console.error("MIRROR_PRIVACY_DENIED: PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL");
    process.exitCode = 1;
  }
}
