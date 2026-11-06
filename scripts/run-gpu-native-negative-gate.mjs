#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runNegativeGpuCompilerGate} from '../src/gpu-native-compiler-negative-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function error(message) {throw new Error(`GPU_NEGATIVE_GATE: ${message}`);}
function commitObject(spec) {
  const r=spawnSync('git',['-C',root,'rev-parse',spec],{encoding:'utf8',timeout:5000});
  if (r.error || r.status!==0) error(`cannot resolve ${spec} in exact checkout`);
  const sha=r.stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) error(`invalid git object: ${spec}`);
  return sha;
}
function main() {
  const values = new Map();
  for (const arg of process.argv.slice(2)) {
    const match=/^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) error('expected unique --key=value flags');
    values.set(match[1],match[2]);
  }
  const allowed=new Set(['backend','compiler','compiler-args-json','head','tree','receipt']);
  if ([...values.keys()].some(k=>!allowed.has(k))) error('unexpected flag');
  const actualHead=commitObject('HEAD'), actualTree=commitObject('HEAD^{tree}');
  if (actualHead!==values.get('head') || actualTree!==values.get('tree'))
    error('exact checkout commit/tree mismatch');
  const status=spawnSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8',timeout:5000});
  if (status.error || status.status!==0 || status.stdout.trim()!=='')
    error('working checkout is dirty or has untracked files');
  const compiler=values.get('compiler');
  if (!compiler) error('required compiler not provided');
  const extra=values.has('compiler-args-json') ? JSON.parse(values.get('compiler-args-json')) : [];
  if (!Array.isArray(extra) || extra.some(x=>typeof x!=='string'))
    error('compiler argument vector must be JSON string array');
  const manifest=JSON.parse(readFileSync(path.join(root,'contracts/atto-gpu-explicit-launch-v1.json'),'utf8'));
  const control=Buffer.from('pub fnc launch(int x): int { return x; }\npub fnc main(): int { return launch(7); }\n');
  const receipt=runNegativeGpuCompilerGate({sourceRoot:root,manifest,controlSource:control,
    backend:values.get('backend'),compilerArgv:[compiler,...extra],
    sourceHead:actualHead,sourceTree:actualTree});
  const json=JSON.stringify(receipt,null,2)+'\n';
  if (values.has('receipt')) {
    const file=path.resolve(values.get('receipt'));
    if (file.startsWith(root+path.sep)) error('receipt must not modify checkout');
    writeFileSync(file,json,{flag:'wx',mode:0o600});
  }
  process.stdout.write(json);
}
try {main();} catch(e) {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exitCode=1;
}
