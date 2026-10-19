#!/usr/bin/env node
/**
 * P0 containment hold: the legacy source publisher is permanently inert.
 *
 * The previous entrypoint accepted caller-controlled destination approvals,
 * but did not independently attest protected-main policy, the exact source
 * snapshot, both incident resume decisions, or reviewed workflow identity.
 * A repository being PRIVATE or an Actions run passing is NOT authorization.
 *
 * This file deliberately contains no GitHub API calls, source-file reads,
 * destination writes, or opt-in environment bypass. Do not reinstate it;
 * implement any later approved publication only through a separately reviewed
 * canonical dispatcher with its own complete fail-closed authorization checks.
 */
import { pathToFileURL } from 'node:url';

export const LEGACY_PUBLISHER_HOLD =
  'legacy source publisher quarantined: independent protected-main, incident, destination, snapshot and workflow authorization is required';

// Preserve the public import name so existing callers fail loudly, not silently.
// No options (including forged receipts or environment variables) can enable it.
export async function publishPrivateMirror(_options = {}) {
  throw new Error(LEGACY_PUBLISHER_HOLD);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.error('PRIVATE_MIRROR_DENIED: ' + LEGACY_PUBLISHER_HOLD);
  process.exitCode = 1;
}
