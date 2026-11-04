#!/usr/bin/env node
/**
 * P0 INCIDENT HOLD. Even metadata-only private CI canary proposals must not
 * fetch private GitHub source commit/tree data before independent approval.
 * This retired API does not read credentials, call fetch or write Git objects.
 */
import {pathToFileURL} from "node:url";

export async function proposeCanary(_untrustedOptions) {
  // No caller-controlled option access, metadata reads or network operations.
  throw Error("PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await proposeCanary(undefined);
  } catch {
    console.error("PRIVATE_CI_CANARY_DENIED: PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL");
    process.exitCode = 1;
  }
}
