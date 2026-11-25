import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verify } from '../bin/verify-private-mirror.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

test('exact-tree private CI evidence only passes pinned blobs and subtree', () => {
  const repo = mkdtempSync(join(tmpdir(), 'mirror-proof-'));
  try {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'CI Mirror Test');
    git(repo, 'config', 'user.email', 'ci@example.invalid');
    mkdirSync(join(repo, 'source'));
    writeFileSync(join(repo, 'source', 'main.ores'), 'fnc foo(): int { return 42; }\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'test private source mirror');
    const expectedTree = git(repo, 'rev-parse', 'HEAD:source');
    const sha = git(repo, 'rev-parse', 'HEAD:source/main.ores');
    const params = {
      repo, subtreePath: 'source', expectedTree,
      blobs: [{ path: 'main.ores', sha }]
    };
    assert.deepEqual(verify(params), {
      status: 'EXACT_TREE', sourceTree: expectedTree, verifiedBlobs: 1
    });
    assert.throws(() => verify({ ...params, expectedTree: '0'.repeat(40) }), /mismatch/);
    assert.throws(() => verify({ ...params, blobs: [{ path: 'main.ores', sha: '0'.repeat(40) }] }), /mismatch/);
    assert.throws(() => verify({ ...params, subtreePath: '../source' }), /invalid/);
    assert.throws(() => verify({ ...params, blobs: [{ path: '../secrets', sha }] }), /invalid/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('exact-tree verifier refuses dirty, staged, untracked and hidden-checkout files',()=>{
 const repo=mkdtempSync(join(tmpdir(),'mirror-dirty-'));
 try{
  git(repo,'init','-q');
  git(repo,'config','user.name','CI Mirror Test');
  git(repo,'config','user.email','ci@example.invalid');
  mkdirSync(join(repo,'source'));
  writeFileSync(join(repo,'source','main.ores'),'fnc foo(): int { return 42; }\n');
  git(repo,'add','.');
  git(repo,'commit','-qm','pin test tree');
  const params={repo,subtreePath:'source',
   expectedTree:git(repo,'rev-parse','HEAD:source'),
   blobs:[{path:'main.ores',sha:git(repo,'rev-parse','HEAD:source/main.ores')}]};
  assert.equal(verify(params).status,'EXACT_TREE');
  writeFileSync(join(repo,'source','main.ores'),'fnc foo(): int { return 666; }\n');
  assert.throws(()=>verify(params),/worktree is dirty/);
  git(repo,'add','source/main.ores');
  assert.throws(()=>verify(params),/worktree is dirty/);
  git(repo,'reset','-q','--hard','HEAD');
  writeFileSync(join(repo,'source','injected.ores'),'fnc injected(): int { return 666; }\n');
  assert.throws(()=>verify(params),/untracked files/);
  rmSync(join(repo,'source','injected.ores'));
  writeFileSync(join(repo,'.gitignore'),'source/*.ores.generated\n');
  writeFileSync(join(repo,'source','ignored.ores.generated'),'injected source\n');
  assert.throws(()=>verify(params),/worktree is dirty or contains untracked files/);
  rmSync(join(repo,'source','ignored.ores.generated'));

  git(repo,'update-index','--skip-worktree','source/main.ores');
  assert.throws(()=>verify(params),/hidden index entries/);
  git(repo,'update-index','--no-skip-worktree','source/main.ores');
  assert.equal(verify(params).status,'EXACT_TREE');
 }finally{rmSync(repo,{recursive:true,force:true})}
});

test('tracked symlinks must not certify mutable source outside the pinned subtree',()=>{
 const repo=mkdtempSync(join(tmpdir(),'mirror-symlink-'));
 try{
  git(repo,'init','-q');
  git(repo,'config','user.name','CI Mirror Test');
  git(repo,'config','user.email','ci@example.invalid');
  mkdirSync(join(repo,'source'));
  writeFileSync(join(repo,'outside.ores'),'fnc danger(): int { return 1; }\n');
  symlinkSync('../outside.ores',join(repo,'source','main.ores'));
  git(repo,'add','.');
  git(repo,'commit','-qm','tracked symlink outside source subtree');
  const params={repo,subtreePath:'source',
   expectedTree:git(repo,'rev-parse','HEAD:source'),
   blobs:[{path:'main.ores',sha:git(repo,'rev-parse','HEAD:source/main.ores')}]};
  assert.throws(()=>verify(params),/symlink, gitlink or unexpected index/);
  writeFileSync(join(repo,'outside.ores'),'fnc danger(): int { return 999; }\n');
  assert.throws(()=>verify(params),/symlink, gitlink or unexpected index/);
 }finally{rmSync(repo,{recursive:true,force:true})}
});

test('raw byte admission rejects a Git-clean custom filter transformation',()=>{
 const repo=mkdtempSync(join(tmpdir(),'mirror-filter-'));
 try{
  git(repo,'init','-q');
  git(repo,'config','user.name','CI Mirror Test');
  git(repo,'config','user.email','ci@example.invalid');
  git(repo,'config','filter.upper.clean','tr A-Z a-z');
  git(repo,'config','filter.upper.smudge','tr a-z A-Z');
  mkdirSync(join(repo,'source'));
  const LF=String.fromCharCode(10);
  writeFileSync(join(repo,'source','.gitattributes'),'*.ores filter=upper'+LF);
  writeFileSync(join(repo,'source','main.ores'),'hello'+LF);
  git(repo,'add','.');
  git(repo,'commit','-qm','pin lowercase canonical blob');
  // Git declares the uppercase executable checkout clean after its clean
  // filter transforms it back to the lowercase index blob.
  writeFileSync(join(repo,'source','main.ores'),'HELLO'+LF);
  assert.equal(git(repo,'status','--porcelain=v1','--','source'),'');
  const params={repo,subtreePath:'source',expectedTree:git(repo,'rev-parse','HEAD:source'),
   blobs:[{path:'main.ores',sha:git(repo,'rev-parse','HEAD:source/main.ores')}]};
  assert.throws(()=>verify(params),/raw source bytes differ from pinned Git blob/);
 }finally{rmSync(repo,{recursive:true,force:true})}
});
