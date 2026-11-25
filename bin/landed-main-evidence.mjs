#!/usr/bin/env node
// Offline audit CLI. No GitHub access, tokens, or state changes; input is untrusted.
import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {auditLedger} from '../tools/landed-main-evidence.mjs';
let fd;
try {
  if (process.argv.length !== 3)
    throw Error('usage: node bin/landed-main-evidence.mjs <ledger.json>');
  // Check the opened descriptor, not a prior lstat(path): prevent symlink swap.
  fd=openSync(process.argv[2],constants.O_RDONLY | constants.O_NOFOLLOW);
  const st=fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1 || st.size < 1 || st.size > 262144)
    throw Error('invalid or oversized ledger file');
  const content=readFileSync(fd,'utf8');
  if (Buffer.byteLength(content,'utf8') !== st.size)
    throw Error('ledger changed during read');
  const parsed=JSON.parse(content);
  // Canonical input denies duplicate/escaped authority keys and last-wins parsing.
  if (content !== JSON.stringify(parsed,null,2) + '\n')
    throw Error('noncanonical or duplicate-key ledger JSON');
  const report=auditLedger(parsed);
  process.stdout.write(JSON.stringify(report,null,2) + '\n');
  // Advisory snapshots must never exit zero: shell/CI callers must recheck live authority.
  process.exitCode = report.status === 'BLOCKED' ? 1 : 3;
} catch (e) {
  console.error('FAIL_CLOSED: '+e.message);
  process.exitCode=2;
} finally {
  if (fd !== undefined) closeSync(fd);
}
