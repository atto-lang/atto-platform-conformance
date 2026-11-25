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

// JSON.parse alone accepts duplicate object keys (including escaped aliases).
// Parse the raw structure first and reject conflicting authority at any depth.
function parse_snapshot_json(raw) {
  const parsed = JSON.parse(raw); // validates all JSON syntax first
  let i = 0;
  const whitespace = () => { while (i < raw.length && /\s/.test(raw[i])) i++; };
  const string = () => {
    const start = i++;
    while (i < raw.length) {
      if (raw[i] === '\\') { i += 2; continue; }
      if (raw[i++] === '"') return JSON.parse(raw.slice(start, i));
    }
    throw Error('unterminated JSON string');
  };
  const value = depth => {
    if (depth > 64) throw Error('JSON nesting exceeds 64 levels');
    whitespace();
    if (raw[i] === '"') { string(); return; }
    if (raw[i] === '{') {
      i++; whitespace();
      const seen = new Set();
      if (raw[i] !== '}') while (true) {
        whitespace();
        if (raw[i] !== '"') throw Error('invalid JSON object key');
        const key = string();
        if (seen.has(key)) throw Error('duplicate JSON authority key');
        seen.add(key);
        whitespace(); i++; // colon, syntax verified by JSON.parse above
        value(depth + 1);
        whitespace();
        if (raw[i] !== ',') break;
        i++;
      }
      i++; // closing brace
      return;
    }
    if (raw[i] === '[') {
      i++; whitespace();
      if (raw[i] !== ']') while (true) {
        value(depth + 1);
        whitespace();
        if (raw[i] !== ',') break;
        i++;
      }
      i++; // closing bracket
      return;
    }
    // Validated primitive token (number / true / false / null).
    while (i < raw.length && !/[\s,}\]]/.test(raw[i])) i++;
  };
  value(0);
  whitespace();
  if (i !== raw.length) throw Error('unparsed JSON trailing material');
  return parsed;
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
  if (!Number.isFinite(seen_at)) throw Error('invalid snapshot timestamp');
  if (seen_at - now > MAX_ADVISORY_AGE_MS) {
    throw Error('future snapshot: outside five-minute admission window');
  }
  if (now - seen_at > MAX_ADVISORY_AGE_MS) {
    throw Error('stale snapshot: source-free evidence older than five minutes');
  }
  return snapshot;
}


if (process.argv.length !== 3) {
  console.error('Usage: node bin/merge-wave-qualifier.mjs snapshot.json');
  process.exitCode = 2;
} else {
  try {
    const output = qualifyWave(require_recent_snapshot(parse_snapshot_json(read_snapshot(process.argv[2]))));
    // Caller-provided offline evidence can never result in process success.
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
