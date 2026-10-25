#!/usr/bin/env node
// Evidence-only Git tree verifier. Never fetches or modifies private source.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants as fsConstants, fstatSync, lstatSync, openSync,
  readFileSync, realpathSync
} from 'node:fs';
import { resolve, sep } from 'node:path';

const safeGitEnv = Object.freeze({
  PATH: process.platform === 'win32'
    ? (process.env.SystemRoot ? process.env.SystemRoot + '\\System32' : 'C:\\Windows\\System32')
    : '/usr/local/bin:/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C'
});

function git(repo, ...args) {
  const p = spawnSync('git', [
    '--no-optional-locks',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    '-c', 'core.filemode=true',
    '-C', repo,
    ...args
  ], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    shell: false, windowsHide: true, env: safeGitEnv
  });
  if (p.error || p.signal || p.status !== 0)
    throw Error('Git mirror inspection unavailable');
  if (p.stderr !== '')
    throw Error('Git mirror inspection emitted unexpected stderr');
  return p.stdout.trim();
}

function safePath(path) {
  return typeof path === 'string'
    && /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path)
    && path.split('/').every(p => p !== '.' && p !== '..');
}

function gitBlobSha1(bytes) {
  return createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
}

function readPinnedRegularFile(absolute, expectedMode) {
  // Resolve the pathname first, then bind the verification to one opened
  // descriptor with O_NOFOLLOW where supported. Re-stat both the descriptor
  // and pathname after the read so a rename/symlink race cannot silently
  // substitute different bytes between admission checks.
  if (realpathSync(absolute) !== absolute)
    throw Error('source subtree contains symlink or unsafe path');
  const beforeName = lstatSync(absolute, { bigint: true });
  if (!beforeName.isFile() || beforeName.isSymbolicLink() ||
      Boolean(beforeName.mode & 0o111n) !== (expectedMode === '100755'))
    throw Error('source subtree file type or mode differs from pinned Git tree');

  const fd = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.dev !== beforeName.dev || before.ino !== beforeName.ino ||
        before.size !== beforeName.size)
      throw Error('source subtree file changed before raw-byte verification');

    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const afterName = lstatSync(absolute, { bigint: true });
    if (BigInt(bytes.length) !== before.size ||
        before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        after.dev !== afterName.dev || after.ino !== afterName.ino ||
        after.size !== afterName.size ||
        realpathSync(absolute) !== absolute)
      throw Error('source subtree file changed during raw-byte verification');
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function privateMirrorSafeFailureCode(error) {
  // CLI diagnostics are public/loggable. Never copy a filesystem, Git, or
  // exception message into Actions logs: those messages can contain absolute
  // runner paths, credentials, or repository-local secrets.
  let message;
  try { message = typeof error?.message === 'string' ? error.message : null; }
  catch { return 'UNCLASSIFIED_GIT_OR_IO_ERROR'; }
  if (typeof message !== 'string') return 'UNCLASSIFIED_GIT_OR_IO_ERROR';
  if (message === 'Git mirror inspection unavailable' ||
      message === 'Git mirror inspection emitted unexpected stderr')
    return 'GIT_INSPECTION_UNAVAILABLE';
  if (message === 'source repository path is not Git worktree root')
    return 'WORKTREE_ROOT_MISMATCH';
  if (message === 'exact-tree verifier requires SHA-1 Git object format')
    return 'UNSUPPORTED_GIT_OBJECT_FORMAT';
  if (message === 'invalid source tree pin or subtree path') return 'INVALID_TREE_PIN';
  if (message === 'invalid blobs' || message === 'invalid blob pin') return 'INVALID_BLOB_PIN';
  if (message === 'exact Git subtree mismatch') return 'TREE_MISMATCH';
  if (message === 'source subtree worktree is dirty or contains untracked files')
    return 'WORKTREE_NOT_CLEAN';
  if (message === 'source subtree has hidden index entries') return 'HIDDEN_INDEX_STATE';
  if (message === 'source subtree index differs from pinned HEAD tree')
    return 'INDEX_TREE_MISMATCH';
  if (message === 'source subtree has unsafe, nonregular or duplicate HEAD entries' ||
      message === 'source subtree contains symlink, gitlink or unexpected index entry' ||
      message === 'source subtree contains symlink or unsafe path' ||
      message === 'source subtree file type or mode differs from pinned Git tree')
    return 'UNSAFE_SOURCE_ENTRY';
  if (message === 'source subtree file changed before raw-byte verification' ||
      message === 'source subtree file changed during raw-byte verification')
    return 'SOURCE_CHANGED_DURING_VERIFICATION';
  if (message.startsWith('raw source bytes differ from pinned Git blob at '))
    return 'RAW_BLOB_MISMATCH';
  if (message.startsWith('exact Git blob mismatch at ')) return 'BLOB_PIN_MISMATCH';
  return 'UNCLASSIFIED_GIT_OR_IO_ERROR';
}

export function verify({ repo, subtreePath, expectedTree, blobs = [] }) {
  if (!/^[0-9a-f]{40}$/.test(expectedTree) || !safePath(subtreePath)) {
    throw Error('invalid source tree pin or subtree path');
  }
  if (!Array.isArray(blobs)) throw Error('invalid blobs');
  const fullRoot = realpathSync(repo);
  if (git(repo, 'rev-parse', '--show-toplevel') !== fullRoot)
    throw Error('source repository path is not Git worktree root');
  if (git(repo, 'rev-parse', '--show-object-format') !== 'sha1')
    throw Error('exact-tree verifier requires SHA-1 Git object format');
  const actual = git(repo, 'rev-parse', 'HEAD:' + subtreePath);
  if (actual !== expectedTree || git(repo, 'cat-file', '-t', actual) !== 'tree') {
    throw Error('exact Git subtree mismatch');
  }
  // `git status` is forbidden here: custom clean filters can execute
  // arbitrary commands when status inspects a dirty working tree.
  // Inspect only immutable HEAD trees, index metadata, and raw bytes.
  const untracked = git(repo, 'ls-files', '--others', '--exclude-standard', '-z', '--', subtreePath);
  const ignored = git(repo, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', subtreePath);
  if (untracked || ignored) throw Error('source subtree worktree is dirty or contains untracked files');
  const indexEntries = git(repo, 'ls-files', '-v', '-z', '--', subtreePath);
  if (indexEntries.split('\0').filter(Boolean).some(line => !line.startsWith('H ')))
    throw Error('source subtree has hidden index entries');
  const headEntries = git(repo, 'ls-tree', '-r', '--full-tree', '-z', 'HEAD', '--', subtreePath)
    .split('\0').filter(Boolean);
  const stages = git(repo, 'ls-files', '--stage', '-z', '--', subtreePath)
    .split('\0').filter(Boolean);
  if (!stages.length || stages.length !== headEntries.length)
    throw Error('source subtree index differs from pinned HEAD tree');
  const head = new Map();
  for (const entry of headEntries) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    if (!match || !safePath(match[3]) || !match[3].startsWith(subtreePath + '/') ||
        head.has(match[3]))
      throw Error('source subtree has unsafe, nonregular or duplicate HEAD entries');
    head.set(match[3], {mode: match[1], sha: match[2]});
  }
  for (const record of stages) {
    const match = /^(100644|100755) ([0-9a-f]{40}) 0\t(.+)$/.exec(record);
    if (!match || !safePath(match[3]) ||
        !match[3].startsWith(subtreePath + '/'))
      throw Error('source subtree contains symlink, gitlink or unexpected index entry');
    const [, mode, pinnedBlob, file] = match;
    const expected = head.get(file);
    if (!expected || expected.mode !== mode || expected.sha !== pinnedBlob)
      throw Error('source subtree index differs from pinned HEAD tree');
    const absolute = resolve(fullRoot, file);
    if (!absolute.startsWith(fullRoot + sep))
      throw Error('source subtree contains symlink or unsafe path');
    const bytes = readPinnedRegularFile(absolute, mode);
    if (gitBlobSha1(bytes) !== pinnedBlob)
      throw Error('raw source bytes differ from pinned Git blob at ' + file);
  }
  for (const entry of blobs) {
    if (!entry || !safePath(entry.path) || !/^[0-9a-f]{40}$/.test(entry.sha)) {
      throw Error('invalid blob pin');
    }
    const oid = git(repo, 'rev-parse', 'HEAD:' + subtreePath + '/' + entry.path);
    if (oid !== entry.sha || git(repo, 'cat-file', '-t', oid) !== 'blob') {
      throw Error('exact Git blob mismatch at ' + entry.path);
    }
  }
  return { status: 'EXACT_TREE', sourceTree: actual, verifiedBlobs: blobs.length };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    if (process.argv.length !== 3) throw Error('pass one manifest JSON file');
    const input = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
    console.log(JSON.stringify(verify({ ...input, repo: resolve(input.repository) })));
  } catch (error) {
    console.error('MIRROR_UNVERIFIED: ' + privateMirrorSafeFailureCode(error));
    process.exitCode = 1;
  }
}
