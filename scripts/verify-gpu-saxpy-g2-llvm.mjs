#!/usr/bin/env node
// Explicit cross-repository test requiring *both* locally accessible repos.
// Never treats SPIR64 IR, OpenCL C, or a host test as device execution.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const llvm = resolve(process.argv[2] || '');
if (process.argv.length !== 3) throw Error('usage: node scripts/verify-gpu-saxpy-g2-llvm.mjs PATH_TO_LLVM_CHECKOUT');
const manifest = JSON.parse(readFileSync(join(root, 'contracts/atto-gpu-saxpy-g2.json'), 'utf8'));
const sha1blob = b => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const sha256 = b => createHash('sha256').update(b).digest('hex');
function command(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:30000});
  if (r.error || r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed: ${r.error || r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function pinned(path, expected) {
  const bytes = readFileSync(path);
  assert.equal(sha1blob(bytes), expected, `Git object mismatch ${path}`);
  return bytes;
}
function repoIdentity(path, label) {
  const head = command('git',['rev-parse','HEAD'],path);
  const tree = command('git',['rev-parse','HEAD^{tree}'],path);
  assert.match(head,/^[0-9a-f]{40}$/);
  assert.match(tree,/^[0-9a-f]{40}$/);
  console.log(`${label}_head ${head}\n${label}_tree ${tree}`);
}
repoIdentity(root, 'conformance');
repoIdentity(llvm, 'llvm');
const tool = join(llvm,manifest.llvmTool.path);
const source = join(root,manifest.fixture.path);
const golden = pinned(join(root,manifest.openclGolden.path), manifest.openclGolden.gitBlobSha);
pinned(tool,manifest.llvmTool.gitBlobSha);
pinned(source,manifest.fixture.gitBlobSha);
assert.equal(sha256(golden),manifest.openclGolden.sha256);
const work = mkdtempSync(join(tmpdir(),'atto-gpu-g2-integration-'));
try {
  const exe = join(work,'atto-gpu-saxpy-kernelc');
  const output = join(work,'device.cl');
  const ir = join(work,'device.spir64.ll');
  command('clang++',['-std=c++17','-Wall','-Wextra','-Wpedantic','-Werror',tool,'-o',exe],root);
  console.log(command('node',['--test',join(llvm,'tests/gpu-saxpy-g2/atto-gpu-saxpy-kernelc.test.mjs')],llvm,{
    ...process.env, ATTO_GPU_KERNELC:exe, ATTO_GPU_CLANG:'clang',
  }).split('\n').slice(-10).join('\n'));
  command(exe,[source,output],root);
  const actual=readFileSync(output);
  assert.equal(sha256(actual),manifest.openclGolden.sha256,'device artifact does not match independently pinned golden');
  command('clang',['-target','spir64-unknown-unknown','-x','cl','-cl-std=CL1.2','-S','-emit-llvm','-o',ir,output],root);
  const llvmIr=readFileSync(ir,'utf8');
  assert.match(llvmIr,/target triple = "spir64-unknown-unknown"/);
  assert.match(llvmIr,/spir_kernel void @attolang_saxpy_v1/);
  assert.match(llvmIr,/_Z13get_global_idj/);
  assert.ok(existsSync(ir));
  console.log(`evidence_class G2_RESTRICTED_DEVICE_SOURCE_ONLY\nartifact_sha256 ${sha256(actual)}\nphysical_gpu_executed false\nhost_launch_compiled false\nG2_INTEGRATION_PASS`);
} finally { rmSync(work,{recursive:true,force:true}); }
