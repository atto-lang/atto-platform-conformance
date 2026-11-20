#!/usr/bin/env node
// Carrier-only verification: no network, tokens, remote checkout, or code execution.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, readFile, readlink, open} from 'node:fs/promises';
import {resolve, join, sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const fail = message => { throw new Error('E_MIRROR_' + message); };
const SHA = /^[0-9a-f]{40}$/;
const MODES = new Set(['100644','100755','120000']);
const [manifestFile, checkoutDir, trustedSourceTreeSha] = process.argv.slice(2);
if (!manifestFile || !checkoutDir || !SHA.test(trustedSourceTreeSha || ''))
  fail('USAGE: manifest.json checkout-dir trusted-source-tree-sha');
const root = resolve(checkoutDir);
function git(...args) {
  const result = spawnSync('git', args, {cwd:root, encoding:'buffer', maxBuffer:32*1024*1024, timeout:60000});
  if (result.error || result.status !== 0) fail('GIT: ' + args.join(' '));
  return result.stdout;
}
function safePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096 ||
      path.includes('\\') || path.includes('\0') || path.startsWith('/') ||
      path.split('/').some(p=>p === '' || p === '.' || p === '..' || p === '.git'))
    fail('UNSAFE_PATH');
  return path;
}
const manifest = JSON.parse(await readFile(manifestFile,'utf8'));
if (manifest.schema !== 'atto.token-free-carrier-mirror.v1' ||
    !SHA.test(manifest.source_commit_sha || '') ||
    manifest.source_tree_sha !== trustedSourceTreeSha ||
    !Array.isArray(manifest.entries) || manifest.entries.length < 1 ||
    manifest.entries.length > 50000) fail('MANIFEST');
const tree = git('rev-parse','HEAD^{tree}').toString('utf8').trim();
if (tree !== trustedSourceTreeSha) fail('TREE_SHA');
if (git('status','--porcelain=v1','--untracked-files=all','--ignored=matching').length !== 0)
  fail('DIRTY_CHECKOUT');
const ls = git('ls-tree','-r','-z','HEAD');
const observed = new Map();
for (const entry of ls.toString('utf8').split('\0')) {
  if (!entry) continue;
  const match = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/s.exec(entry);
  if (!match) fail('TREE_ENTRY_FORMAT');
  const [,mode,type,sha,path] = match;
  safePath(path);
  if (type !== 'blob' || !MODES.has(mode) || observed.has(path)) fail('TREE_MODE_OR_DUPLICATE');
  observed.set(path,{path,mode,sha,type});
}
if (observed.size !== manifest.entries.length) fail('ENTRY_COUNT');
let count = 0;
for (const entry of manifest.entries) {
  const path = safePath(entry.path);
  if (!MODES.has(entry.mode) || entry.type !== 'blob' || !SHA.test(entry.sha || ''))
    fail('MANIFEST_ENTRY');
  const indexed = observed.get(path);
  if (!indexed || indexed.mode !== entry.mode || indexed.sha !== entry.sha)
    fail('TRACKED_BLOB_OR_MODE');
  observed.delete(path);
  // An attacker may not route a tracked path through a symlink directory.
  const pieces = path.split('/');
  for(let i=1;i<pieces.length;i++){
    const ancestor = await lstat(join(root,...pieces.slice(0,i)));
    if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) fail('SYMLINK_ANCESTOR');
  }
  const full = join(root,...pieces);
  if (!full.startsWith(root+sep)) fail('PATH_ESCAPE');
  const stat = await lstat(full);
  const sha = createHash('sha1');
  if (entry.mode === '120000') {
    if (!stat.isSymbolicLink()) fail('SYMLINK_MODE');
    const target = await readlink(full,{encoding:'buffer'});
    const spelled = target.toString('utf8');
    if (!Buffer.from(spelled,'utf8').equals(target) || spelled.includes('\\') || spelled.includes('\0'))
      fail('SYMLINK_TARGET_ENCODING');
    const destination = resolve(root,...pieces.slice(0,-1),spelled);
    if (destination !== root && !destination.startsWith(root+sep)) fail('SYMLINK_ESCAPE');
    sha.update(Buffer.from(`blob ${target.length}\0`));
    sha.update(target);
  } else {
    if (!stat.isFile() || stat.isSymbolicLink()) fail('FILE_MODE');
    if (Boolean(stat.mode & 0o111) !== (entry.mode === '100755')) fail('EXECUTABLE_MODE');
    // Do not follow a newly planted final-component symlink after lstat.
    const handle = await open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino ||
          current.size !== stat.size || current.mode !== stat.mode) fail('FILE_RACE');
      sha.update(Buffer.from(`blob ${current.size}\0`));
      for await (const chunk of handle.createReadStream({autoClose:false})) sha.update(chunk);
    } finally { await handle.close(); }
  }
  if (sha.digest('hex') !== entry.sha) fail('WORKTREE_BLOB');
  count++;
}
if (observed.size !== 0) fail('MISSING_MANIFEST_ENTRIES');
console.log(JSON.stringify({status:'verified',source_tree_sha:tree,source_commit_sha:manifest.source_commit_sha,verified_blobs:count}));
