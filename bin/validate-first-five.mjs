#!/usr/bin/env node
import {readFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const manifestFile = resolve(here, '../contracts/first-five.json');
const BACKENDS = ['java', 'llvm', 'net', 'wasm', 'forge'];
const IDS = ['grammar', 'types', 'imports', 'ownership', 'shared-hir-mir'];
const STATES = new Set(['pending', 'unsupported', 'verified']);
const REQUIREMENTS = new Set([
  'real-parser', 'typed-admission', 'negative-diagnostic', 'real-typechecker',
  'positive-admission', 'real-frontend', 'filesystem-policy', 'multi-file-linking',
  'real-ownership-checker', 'runtime-when-supported', 'schema-validation',
  'semantic-verifier', 'exact-source-provenance', 'real-java-llvm-adapters'
]);
const exactKeys = (obj, expected, where) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
    Object.keys(obj).length !== expected.length ||
    expected.some(key => !Object.hasOwn(obj, key)))
    throw Error('invalid fields at ' + where);
};
const uniqueStrings = (xs) => Array.isArray(xs) && xs.length > 0 &&
  xs.every(x => typeof x === 'string' && /^[a-z][a-z0-9-]{1,80}$/.test(x)) &&
  new Set(xs).size === xs.length;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateBatch(data) {
  exactKeys(data, ['schema_version', 'batch', 'scope', 'backends', 'tasks'], 'root');
  if (data.schema_version !== 1 || data.batch !== 1 || data.scope !== 'source-parity-admission')
    throw Error('unknown contract version, batch or scope');
  if (JSON.stringify(data.backends) !== JSON.stringify(BACKENDS))
    throw Error('backend inventory drift');
  if (!Array.isArray(data.tasks) || data.tasks.length !== 5)
    throw Error('exactly five tasks required');
  for (let i = 0; i < data.tasks.length; i++) {
    const t = data.tasks[i];
    exactKeys(t, ['number', 'id', 'reference', 'checks', 'requires', 'statuses'], 'task ' + (i+1));
    if (t.number !== i+1 || t.id !== IDS[i]) throw Error('task identity drift at ' + (i+1));
    if (typeof t.reference !== 'string' ||
      !/^https:\/\/github\.com\/ores-truffle-oreslang\/[-.a-z0-9]+\/(?:pull|issues)\/[1-9][0-9]*$/.test(t.reference))
      throw Error('missing review reference for task ' + t.number);
    if (!uniqueStrings(t.checks) || t.checks.length < 4)
      throw Error('missing acceptance checks for task ' + t.number);
    if (!uniqueStrings(t.requires) || t.requires.some(x => !REQUIREMENTS.has(x)))
      throw Error('missing or unknown proof requirements for task ' + t.number);
    exactKeys(t.statuses, BACKENDS, 'task ' + t.number + ' statuses');
    for (const backend of BACKENDS) {
      if (!STATES.has(t.statuses[backend])) throw Error('invalid ' + backend + ' status');
      // A machine-readable contract is never execution evidence. No backend can
      // be marked verified in this unauthenticated planning inventory.
      if (t.statuses[backend] === 'verified')
        throw Error('unauthenticated verified status: ' + t.id + '/' + backend);
    }
  }
  return {
    schema_version: 1, batch: 1, tasks: data.tasks.length,
    coverage: Object.fromEntries(BACKENDS.map(b => [b, {
      pending: data.tasks.filter(t => t.statuses[b] === 'pending').length,
      unsupported: data.tasks.filter(t => t.statuses[b] === 'unsupported').length,
      verified: 0
    }])),
    status: 'CONTRACT_VALID_ONLY',
    compiler_executed: false, parity_verified: false
  };
}


/** JSON.parse loses repeated object keys. Reject ambiguous manifests first. */
export function rejectDuplicateObjectKeys(source) {
  if (typeof source !== 'string') throw Error('manifest must be JSON text');
  const frames = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      const start = i++;
      let escaped = false;
      for (; i < source.length; i++) {
        if (escaped) { escaped = false; continue; }
        if (source[i] === '\\') { escaped = true; continue; }
        if (source[i] === '"') break;
      }
      if (i >= source.length) throw Error('unterminated JSON string');
      const frame = frames[frames.length - 1];
      if (frame?.object && frame.awaitingKey) {
        const name = JSON.parse(source.slice(start, i + 1));
        if (frame.keys.has(name)) throw Error('duplicate JSON object key');
        frame.keys.add(name);
        frame.awaitingKey = false;
      }
    } else if (ch === '{') {
      frames.push({object: true, awaitingKey: true, keys: new Set()});
    } else if (ch === '[') {
      frames.push({object: false});
    } else if (ch === '}' || ch === ']') {
      frames.pop();
    } else if (ch === ',') {
      const frame = frames[frames.length - 1];
      if (frame?.object) frame.awaitingKey = true;
    }
  }
}

export async function loadBatch(path = manifestFile) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 64*1024) throw Error('invalid contract file');
  const bytes = await readFile(path);
  const content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  // Syntax validation happens before the lexical duplicate-key audit.
  JSON.parse(content);
  rejectDuplicateObjectKeys(content);
  const obj = JSON.parse(content, (k,v) => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype')
      throw Error('unsafe object key');
    return v;
  });
  return {...validateBatch(obj), manifest_sha256: sha256(bytes)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) { console.error('usage: node bin/validate-first-five.mjs'); process.exitCode = 2; }
  else loadBatch().then(v => console.log(JSON.stringify(v, null, 2))).catch(e => {
    console.error('BATCH_INVALID: ' + e.message); process.exitCode = 1;
  });
}
