// Reference-only root-import path gate for cross-backend conformance.
// This is NOT a language parser, a module linker, or private source access authority.
import { realpathSync, statSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute, join } from 'node:path';

export const MANIFEST_NAME = '.ores.pkg.toml';
export function resolveRootedSource(projectRoot, specifier) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0 ||
      typeof specifier !== 'string' || !specifier.startsWith('+/')) {
    throw new Error('ROOT_IMPORT_REQUIRED');
  }
  const suffix = specifier.slice(2);
  // Deny lexical tricks independently of the host's separator convention.
  // Rooted imports must use a canonical, explicit source filename.
  if (!suffix || suffix.length > 4096 || suffix.includes('\\') ||
      suffix.includes('\0') || suffix.includes('%') || suffix.includes(':') ||
      suffix.startsWith('/') || suffix.endsWith('/') ||
      suffix.split('/').some(s => !s || s === '.' || s === '..')) {
    throw new Error('ROOT_IMPORT_PATH_INVALID');
  }
  if (!suffix.endsWith('.atto') && !suffix.endsWith('.ores')) {
    throw new Error('ROOT_IMPORT_SOURCE_EXTENSION_REQUIRED');
  }
  const root = realpathSync(projectRoot);
  if (!statSync(root).isDirectory() || !existsSync(join(root, MANIFEST_NAME)) ||
      !lstatSync(join(root, MANIFEST_NAME)).isFile() ||
      lstatSync(join(root, MANIFEST_NAME)).isSymbolicLink()) {
    throw new Error('ROOT_IMPORT_MANIFEST_MISSING');
  }
  const absolute = resolve(root, suffix);
  if (!isAbsolute(absolute)) throw new Error('ROOT_IMPORT_PATH_INVALID');
  // realpath resolves both intermediate and final symlinks; a lexical
  // startsWith test alone would permit a symlink escaping the project root.
  let canonical;
  try { canonical = realpathSync(absolute); }
  catch { throw new Error('ROOT_IMPORT_SOURCE_MISSING'); }
  const within = relative(root, canonical);
  if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) {
    throw new Error('ROOT_IMPORT_ESCAPE');
  }
  if (!statSync(canonical).isFile()) throw new Error('ROOT_IMPORT_NOT_FILE');
  return { root, canonical_source: canonical, logical_specifier: specifier };
}
