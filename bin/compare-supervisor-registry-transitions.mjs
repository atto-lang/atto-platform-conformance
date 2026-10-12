#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MARKER = 'SUPERVISOR_REGISTRY_TRANSITIONS_V1=';
export const EXPECTED_REGISTRY_RESTART = Object.freeze([
  'register','finalize-asserted','restart.reserve',
  'restart.spawn-asserted','restart.admit-verified','restart.commit',
  'finalize-asserted','restart.reserve','restart.spawn-asserted',
  'restart.cleanup-verified','restart.abort'
]);

/**
 * Only parses ACTUALLY emitted host-registry journal output. Does not
 * synthesize missing transitions, substitute fixture values, or claim
 * scheduler CONTROL / host STOP invocation occurred.
 */
export function extractRegistryTransitions(log, backend) {
  if (typeof log !== 'string') throw new Error(backend+': missing runtime log');
  const matching = log.split(/\r?\n/).filter(l => l.includes(MARKER));
  if (matching.length !== 1)
    throw new Error(backend+': expected exactly one registry transition line, got '+matching.length);
  const line = matching[0];
  const payload = line.slice(line.indexOf(MARKER)+MARKER.length).trim();
  if (!/^[a-z]+(?:[.-][a-z]+)*(?:>[a-z]+(?:[.-][a-z]+)*)+$/.test(payload))
    throw new Error(backend+': malformed registry transitions');
  return payload.split('>');
}

export function compareRegistryTransitions(javaLog, nativeLog) {
  const java = extractRegistryTransitions(javaLog, 'java');
  const native = extractRegistryTransitions(nativeLog, 'native');
  const expected = EXPECTED_REGISTRY_RESTART;
  for (const [backend, actual] of [['java',java],['native',native]]) {
    if (actual.length !== expected.length
        || actual.some((action,i)=>action!==expected[i]))
      throw new Error('REGISTRY_TRANSITION_MISMATCH: '+backend
        +' expected='+expected.join('>')+' actual='+actual.join('>'));
  }
  return Object.freeze({ok:true,scope:'trusted-host-registry-only',steps:expected.length});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4)
      throw new Error('usage: node compare-supervisor-registry-transitions.mjs java.log native.log');
    console.log('SUPERVISOR_REGISTRY_PARITY_PASS '+JSON.stringify(compareRegistryTransitions(
      readFileSync(process.argv[2],'utf8'),readFileSync(process.argv[3],'utf8'))));
  } catch (e) {
    console.error(String(e.message));
    process.exitCode=1;
  }
}
