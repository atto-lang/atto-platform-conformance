import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifySourceTree} from '../bin/verify-source-tree.mjs';

const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],
  {encoding:'utf8',timeout:10000}).trim();

function actualGitTree(files){
  const repo=mkdtempSync(join(tmpdir(),'ores-mirror-tree-'));
  try{
    git(repo,'init','-q');
    git(repo,'config','user.name','Security Fixture');
    git(repo,'config','user.email','test@example.invalid');
    for(const [path,body,executable] of files){
      mkdirSync(dirname(join(repo,path)),{recursive:true});
      writeFileSync(join(repo,path),body);
      if(executable)chmodSync(join(repo,path),0o755);
    }
    git(repo,'add','.');git(repo,'commit','-qm','pin source tree');
    const sha=git(repo,'rev-parse','HEAD^{tree}');
    const tree=git(repo,'ls-tree','-r','-t','HEAD').split('\n').map(line=>{
      const match=/^(\d{6}) (tree|blob) ([0-9a-f]{40})\t(.+)$/.exec(line);
      assert.ok(match,'unexpected Git tree entry '+line);
      return {mode:match[1],type:match[2],sha:match[3],path:match[4],
        ...(match[2]==='blob'?{size:Number(git(repo,'cat-file','-s',match[3]))}:{})};
    });
    return {sha,truncated:false,tree};
  }finally{rmSync(repo,{recursive:true,force:true})}
}

const fixtures=[
  [['a','hi']],
  [['A','z'],['z','a'],['b','b']],
  [['src/main.ores','hello'],['docs/v1/readme.md','abc'],
   ['src/tools/start','#!/bin/sh',true]],
  [['z/a.txt','z'],['z-/foo','u'],['z.txt','v'],['z_/file','w']],
  [['.github/workflows/ci.yml','on: push\n'],['README.md','# hi\n'],
   ['src/sub/deep/foo','123']]
].map(actualGitTree);

fixtures.forEach((inventory,index)=>{
  test('real Git recursive tree round-trip '+index,()=>{
    const result=verifySourceTree(inventory.sha,structuredClone(inventory));
    assert.equal(result.sourceTree,inventory.sha);
    assert.equal(result.files,inventory.tree.filter(x=>x.type==='blob').length);
  });
});

const base=fixtures[2];
const mutations=[
 ['forged blob ID',r=>r.tree.find(x=>x.type==='blob').sha='f'.repeat(40)],
 ['forged mode',r=>r.tree.find(x=>x.type==='blob').mode='100755'],
 ['renamed path',r=>r.tree.find(x=>x.type==='blob').path='src/renamed.ores'],
 ['forged directory SHA',r=>r.tree.find(x=>x.type==='tree').sha='e'.repeat(40)],
 ['missing blob',r=>r.tree=r.tree.filter(x=>x.type!=='blob')],
 ['injected blob',r=>r.tree.push({...r.tree.find(x=>x.type==='blob'),path:'evil.ores'})],
 ['duplicate file entry',r=>r.tree.push({...r.tree.find(x=>x.type==='blob')})],
 ['traversal path',r=>r.tree[0].path='../secret'],
 ['internal Git path',r=>r.tree[0].path='.git/config'],
 ['removed parent trees',r=>r.tree=r.tree.filter(x=>x.type!=='tree')],
 ['truncated inventory',r=>r.truncated=true],
 ['changed claimed root SHA',r=>r.sha='a'.repeat(40)],
 ['symlink mode',r=>r.tree.find(x=>x.type==='blob').mode='120000'],
 ['gitlink type',r=>r.tree[0].type='commit'],
 ['invalid blob length',r=>r.tree.find(x=>x.type==='blob').size=2**30],
 ['case-folding collision',r=>r.tree.push({
    ...r.tree.find(x=>x.type==='blob'),path:'SRC/main.ores'
 })]
];
for(const [label,mutate] of mutations){
  test('reject '+label,()=>{
    const response=structuredClone(base);
    mutate(response);
    assert.throws(()=>verifySourceTree(base.sha,response));
  });
}
