#!/usr/bin/env node
// Read-only offline qualifier. No GitHub tokens, network calls, or mutation actions.
import {readFileSync} from 'node:fs';
import {qualifyWave} from '../tools/merge-wave-qualifier.mjs';
if (process.argv.length !== 3) {
  console.error('Usage: node bin/merge-wave-qualifier.mjs snapshot.json');
  process.exitCode = 2;
} else {
  try {
    const content = readFileSync(process.argv[2], 'utf8');
    if (Buffer.byteLength(content, 'utf8') > 2_000_000) throw Error('snapshot exceeds 2MB');
    const output = qualifyWave(JSON.parse(content));
    console.log(JSON.stringify(output, null, 2));
    if (output.status === 'BLOCKED') process.exitCode = 1;
  } catch (e) {
    console.error(`FAIL_CLOSED: ${e.message}`);
    process.exitCode = 2;
  }
}
