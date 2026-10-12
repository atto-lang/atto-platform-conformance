#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MARKER = 'SUPERVISOR_RESTART_TRACE_V1=';
export function extractOneTrace(log, backend) {
  const lines = log.split(/\r?\n/).filter(line => line.includes(MARKER));
  if (lines.length !== 1)
    throw new Error(backend + ': expected exactly one runtime trace, got ' + lines.length);
  const line = lines[0];
  const trace = line.slice(line.indexOf(MARKER) + MARKER.length).trim();
  if (!/^[A-Z]+(?:>[A-Z]+)*$/.test(trace))
    throw new Error(backend + ': malformed runtime transition trace');
  return trace;
}

export function compareRestartTraces(fixture, javaLog, nativeLog) {
  if (fixture?.schemaVersion !== 1 || fixture?.id !== 'verified-restart-transaction-v1'
      || !Array.isArray(fixture.actions) || !fixture.actions.length)
    throw new Error('missing or incompatible supervisor restart fixture');
  const java = extractOneTrace(javaLog, 'java');
  const native = extractOneTrace(nativeLog, 'native');
  const expected = fixture.expectedTrace;
  if (typeof expected !== 'string'
      || fixture.actions.map((a) =>
           a.replacement === 'SPAWNED' || a.replacement === 'ADMITTED'
             || a.replacement === 'CLEANED' ? a.replacement : a.expectedPhase
         ).join('>') !== expected)
    throw new Error('fixture expected trace is inconsistent with its actions');
  if (java !== expected || native !== expected)
    throw new Error('BACKEND_REFINEMENT_MISMATCH: expected=' + expected
      + ' java=' + java + ' native=' + native);
  return { status:'verified-transition-trace', steps:fixture.actions.length, trace:expected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if (args.length !== 3) {
    console.error('Usage: compare-supervisor-restart-traces.mjs fixture.json java-test.log native-test.log');
    process.exitCode = 2;
  } else {
    try {
      const fixture=JSON.parse(readFileSync(args[0], 'utf8'));
      const result=compareRestartTraces(
        fixture, readFileSync(args[1], 'utf8'), readFileSync(args[2], 'utf8'));
      console.log(JSON.stringify(result));
    } catch(error) {
      console.error(String(error));
      process.exitCode = 1;
    }
  }
}
