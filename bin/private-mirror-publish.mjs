#!/usr/bin/env node
/**
 * Confidentiality incident #22: PRIVATE CROSS-ORG SOURCE EXPORT IS DISABLED.
 *
 * Source-repo names, GITHUB_TOKEN, a private destination, an Actions budget,
 * environment allowlists, and source Git hashes do not establish export
 * authorization. Re-enable only in a separately security-reviewed change
 * with protected source-main policy bound to immutable source commit/tree
 * and numeric destination repository ID, independent incident clearance,
 * retention/cleanup controls, and fail-closed regression tests.
 *
 * The previous publisher implementation remains in Git history for review.
 * There is intentionally NO runnable GitHub blob/tree/ref mutation path here.
 */
import {pathToFileURL} from 'node:url';

export async function publishPrivateMirror() {
  throw Error('PRIVATE_SOURCE_EXPORT_DISABLED: protected policy and incident clearance required');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.error('PRIVATE_SOURCE_EXPORT_DISABLED: protected policy and incident clearance required');
  process.exitCode = 1;
}
