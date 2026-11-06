#!/usr/bin/env node
// Read-only offline qualifier. No GitHub tokens, network calls, or mutation actions.
import {openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {qualifyWave} from '../tools/merge-wave-qualifier.mjs';

const MAX_BYTES = 2_000_000;
function read_snapshot(path) {
  // Reject symlinked inputs, nonregular files, and oversized content *before* reading.
  // O_NOFOLLOW is required to close the final-path symlink race.
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw Error('no symlink-safe file open available');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size > MAX_BYTES) {
      throw Error('snapshot must be a regular file of at most 2MB');
    }
    // Read at most one extra byte; reject a size change during the read.
    const bytes = Buffer.alloc(Math.min(MAX_BYTES + 1, stat.size + 1));
    const n = readSync(fd, bytes, 0, bytes.length, 0);
    if (n !== stat.size) throw Error('snapshot changed size while reading');
    // Fatal decoding prevents replacement-character authority ambiguity.
    return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}


const MAX_ADVISORY_AGE_MS = 5 * 60_000;
function require_recent_snapshot(snapshot) {
  // A CLI read from disk is only a *claim* about GitHub state. Never let an
  // old favorable claim be replayed as a fresh intake diagnostic.
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      typeof snapshot.as_of !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(snapshot.as_of)) {
    throw Error('invalid snapshot timestamp');
  }
  const seen_at = Date.parse(snapshot.as_of);
  const now = Date.now();
  if (!Number.isFinite(seen_at) || now - seen_at > MAX_ADVISORY_AGE_MS) {
    throw Error('stale snapshot: source-free evidence older than five minutes');
  }
  return snapshot;
}

if (process.argv.length !== 3) {
  console.error('Usage: node bin/merge-wave-qualifier.mjs snapshot.json');
  process.exitCode = 2;
} else {
  try {
    const output = qualifyWave(require_recent_snapshot(JSON.parse(read_snapshot(process.argv[2]))));
    // Caller-supplied offline receipts must never yield a shell/CI success.
    const code = output.status === 'BLOCKED' ? 1 :
      output.status === 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK' ? 3 : 2;
    if (code === 2) throw Error('unexpected qualifier status');
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = code;
  } catch (e) {
    console.error(`FAIL_CLOSED: ${e.message}`);
    process.exitCode = 2;
  }
}
