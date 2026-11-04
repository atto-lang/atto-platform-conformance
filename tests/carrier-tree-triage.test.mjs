import test from 'node:test';
import assert from 'node:assert/strict';
import {triageCarrierTree} from '../src/carrier-tree-triage.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const entry=(path,sha=B)=>({path,sha,type:'blob',mode:'100644'});
const base={repository_id:1323598260,commit_sha:A,tree_sha:C,truncated:false,tree:[entry('fixtures/synthetic.json')]};
const triage=(update={},pin=null)=>triageCarrierTree({...base,...update},pin);

test('no name or successful CI claim can certify source-free content',()=>{
  const v=triage({...base,title:'source-free',workflow_conclusion:'success'});
  assert.equal(v.classification,'SOURCE_FREE_UNPROVEN');
  assert.equal(v.authorizes_source_transfer,false);
  assert.equal(v.certifies_source_free,false);
});
test('historically misclassified Java and Oreslang source must be flagged',()=>{
  for (const path of ['audit/Parser.java','zorde.ores','src/runtime/compiler.txt','validation-reference/java1355/a.txt',
    'mirror/oreslang-quota/README.md','compiler/renamed.cfg','native/core.cpp','lib/code.ll']) {
    assert.equal(triage({tree:[entry(path)]}).classification,'POTENTIAL_SOURCE_BEARING',path);
  }
});
test('unknown renamed code is NOT positively certified by a benign extension',()=>{
  const v=triage({tree:[entry('logs/benign.json')]});
  assert.equal(v.classification,'SOURCE_FREE_UNPROVEN');
});
test('fully pinned synthetic tree only matches metadata; still not authorizing',()=>{
  const v=triage({},base);
  assert.equal(v.classification,'MATCHES_SUPPLIED_PIN');
  assert.equal(v.authorizes_source_transfer,false);
  assert.equal(v.certifies_source_free,false);
});
test('pin must bind exact repository, commit, tree and ALL entries',()=>{
  for (const change of [{repository_id:42},{commit_sha:B},{tree_sha:B},{tree:[entry('different.json')]},
    {tree:[entry('fixtures/synthetic.json'),entry('other/readme.md')]}]) {
    const v=triage({}, {...base,...change});
    assert.equal(v.classification,'PIN_MISMATCH');
  }
});
test('unexpected added file or changed blob denies matching pin',()=>{
  for (const tree of [[entry('fixtures/synthetic.json'),entry('other/file.txt')],
    [entry('fixtures/synthetic.json',C)]]) {
    assert.equal(triage({tree},base).classification,'PIN_MISMATCH');
  }
});
test('truncated, absent, empty and over-limit listings are unverifiable',()=>{
  for (const change of [{truncated:true},{truncated:undefined},{tree:null},{tree:[]},{tree:Array(10001).fill(entry('a.txt'))}]) {
    assert.equal(triage(change).classification,'UNVERIFIABLE_TREE');
  }
});
test('symlinks, gitlinks, duplicate paths and casefold collisions deny triage',()=>{
  for (const tree of [[{...entry('link'),mode:'120000'}],
    [{...entry('module'),type:'commit',mode:'160000'}],
    [entry('A.txt'),entry('a.txt')],[entry('x.txt'),entry('x.txt')],
    [entry('.git/config')],[entry('../bad')]]) {
    assert.equal(triage({tree}).classification,'UNVERIFIABLE_TREE');
  }
});
test('invalid source identities cannot be coerced into proof',()=>{
  for (const change of [{repository_id:0},{repository_id:'1323598260'},{commit_sha:'main'},
    {tree_sha:'f'.repeat(39)}]) {
    assert.equal(triage(change).classification,'UNVERIFIABLE_TREE');
  }
});
test('suspicious source paths override an exact matching supplied pin',()=>{
  const bad={...base,tree:[entry('audit/Parser.java')]};
  assert.equal(triageCarrierTree(bad,bad).classification,'POTENTIAL_SOURCE_BEARING');
});
test('directory tree objects have to carry safe Git mode',()=>{
  const good={path:'fixtures',sha:B,type:'tree',mode:'040000'};
  assert.equal(triage({tree:[good,entry('fixtures/synthetic.json')]}).classification,'SOURCE_FREE_UNPROVEN');
  assert.equal(triage({tree:[{...good,mode:'100644'},entry('fixtures/synthetic.json')]}).classification,'UNVERIFIABLE_TREE');
});

test('known private blob fingerprint flags renamed content despite benign path',()=>{
  const observed={...base,tree:[entry('logs/harmless.json',B)]};
  const v=triageCarrierTree(observed,null,[B]);
  assert.equal(v.classification,'MATCHES_REPORTED_PRIVATE_BLOB');
  assert.equal(v.authorizes_source_transfer,false);
  assert.equal(v.certifies_source_free,false);
});
test('unknown and malformed fingerprint inventories do not become approvals',()=>{
  assert.equal(triageCarrierTree(base,null,['not-a-sha']).classification,'UNVERIFIABLE_FINGERPRINTS');
  assert.equal(triageCarrierTree(base,null,[]).classification,'SOURCE_FREE_UNPROVEN');
});

test('source-like scripting and extension-language blobs remain suspicious even with a matching pin',()=>{
  for (const path of [
    'payload/index.js', 'payload/runtime.mjs', 'payload/launch.cjs',
    'scripts/runner.ts', 'scripts/frontend.tsx', 'scripts/widget.jsx',
    'deps/worker.py', 'deps/compiler.pyw', 'audit/patch.rb',
    'tools/inspect.sh', 'tools/boot.bash', 'tools/restart.zsh',
    'scripts/admin.ps1', 'plugins/init.lua', 'service/router.php',
  ]) {
    const payload={...base,tree:[entry(path)]};
    const result=triageCarrierTree(payload,payload);
    assert.equal(result.classification,'POTENTIAL_SOURCE_BEARING',path);
    assert.equal(result.authorizes_source_transfer,false,path);
  }
  const benign={...base,tree:[entry('fixtures/expected.json')]};
  assert.equal(triageCarrierTree(benign,benign).classification,'MATCHES_SUPPLIED_PIN');
});

test('extensionless executables are conservatively source-bearing even with a matching pin',()=>{
  for (const path of ['bin/runner','tools/bootstrap','hooks/pre-commit','payload/worker']) {
    const executable={...base,tree:[{...entry(path),mode:'100755'}]};
    const result=triageCarrierTree(executable,executable);
    assert.equal(result.classification,'POTENTIAL_SOURCE_BEARING',path);
    assert.equal(result.authorizes_source_transfer,false,path);
    assert.equal(result.certifies_source_free,false,path);
  }
  const nonExecutable={...base,tree:[entry('fixtures/extensionless-data')]};
  assert.equal(triageCarrierTree(nonExecutable,nonExecutable).classification,'MATCHES_SUPPLIED_PIN');
});

test('additional compiled VM and schema source families remain suspicious',()=>{
  for (const path of [
    'native/bridge.mm','vm/boot.wat','vm/text.wast','js/module.mts','js/module.cts',
    'jvm/plugin.scala','jvm/build.gradle','mobile/client.dart','beam/app.ex',
    'beam/worker.erl','dotnet/module.fs','analysis/model.jl','fp/core.hs',
    'fp/core.ml','native/kernel.nim','hdl/top.sv','native/startup.S',
    'schema/messages.proto','schema/api.thrift','schema/model.capnp',
  ]) {
    const payload={...base,tree:[entry(path)]};
    assert.equal(triageCarrierTree(payload,payload).classification,'POTENTIAL_SOURCE_BEARING',path);
  }
});

test('executable build and workflow configuration is conservatively source-bearing',()=>{
  for (const path of [
    '.github/workflows/ci.yml','.github/workflows/release.yaml','Dockerfile','build/Dockerfile',
    'Makefile','native/CMakeLists.txt','pom.xml','web/package.json','Cargo.toml','go.mod',
    'android/build.gradle','android/settings.gradle','BUILD','pkg/WORKSPACE','rules/defs.bzl',
    'rules/toolchain.bazel','scripts/config.json','tools/manifest.txt',
  ]) {
    const payload={...base,tree:[entry(path)]};
    const result=triageCarrierTree(payload,payload);
    assert.equal(result.classification,'POTENTIAL_SOURCE_BEARING',path);
    assert.equal(result.authorizes_source_transfer,false,path);
  }
});

test('platform path aliases that can collapse or target devices are unverifiable',()=>{
  for (const path of [
    '.git./config','foo./bar.txt','CON','con.txt','NUL.json','aux.cfg','COM1.log','lpt9.dat',
    'dir/PRN.md','dir/CLOCK$.txt',
  ]) {
    assert.equal(triage({tree:[entry(path)]}).classification,'UNVERIFIABLE_TREE',path);
  }
});
