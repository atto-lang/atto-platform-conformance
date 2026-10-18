#!/usr/bin/env node
/**
 * P0 incident hold: the legacy visibility/allowlist preflight is NOT a source
 * export authorization. #22 and #77 require incident owner review and the
 * independently reviewed, protected-branch dispatcher policy (#1217).
 *
 * This deprecated entrypoint is intentionally non-operational. Old code is
 * preserved in Git history as incident evidence. Do not restore this function
 * as an alternate source-export admission path.
 */
import {pathToFileURL} from "node:url";

const SUSPENDED = "PRIVATE_MIRROR_SUSPENDED: legacy metadata/allowlist checks cannot authorize confidential source transfers";

export async function requirePrivateMirror(_request) {
  throw new Error(SUSPENDED);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.error(SUSPENDED);
  process.exitCode = 1;
}
