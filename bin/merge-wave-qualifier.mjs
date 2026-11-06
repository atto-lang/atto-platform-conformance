#!/usr/bin/env node
// Read-only advisory: no offline, caller-supplied evidence may produce exit 0.
import {openSync, closeSync, fstatSync, lstatSync, readSync, constants} from 'node:fs';
import {TextDecoder} from 'node:util';
import {qualifyWave} from '../tools/merge-wave-qualifier.mjs';

const MAX_SNAPSHOT_BYTES = 2_000_000;

// Read no more than MAX+1 raw bytes; reject pipes, links, nonfiles and invalid UTF-8.
// This is a local parser budget, NOT a trusted or authenticated GitHub receipt.
function read_bounded_snapshot(path) {
  if (!lstatSync(path).isFile()) throw Error('snapshot must be a regular file');
  const flags = constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const fd = openSync(path, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error('snapshot must be a regular file');
    if (stat.size > MAX_SNAPSHOT_BYTES) throw Error('snapshot exceeds 2MB');
    const buf = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
    let count = 0;
    while (count < buf.length) {
      const bytes_read = readSync(fd, buf, count, buf.length - count, null);
      if (bytes_read === 0) break;
      count += bytes_read;
    }
    if (count > MAX_SNAPSHOT_BYTES) throw Error('snapshot exceeds 2MB');
    return new TextDecoder('utf-8', {fatal: true}).decode(buf.subarray(0, count));
  } finally {
    closeSync(fd);
  }
}

if (process.argv.length !== 3) {
  console.error('Usage: node bin/merge-wave-qualifier.mjs snapshot.json');
  process.exitCode = 2;
} else {
  try {
    const output = qualifyWave(JSON.parse(read_bounded_snapshot(process.argv[2])));
    // A positive synthetic snapshot is still UNATTESTED and must not pass
    // shell/CI "command succeeded" gates or authorize a merge.
    const code = output.status === 'BLOCKED' ? 1 :
      output.status === 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK' ? 3 : 2;
    if (code === 2) throw Error('unexpected qualifier status');
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = code;
  } catch (error) {
    console.error(`FAIL_CLOSED: ${error.message}`);
    process.exitCode = 2;
  }
}
