import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateMirrorSafeFailureCode, verify } from '../bin/verify-private-mirror.mjs';

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
  assert.throws(()=>verify(params),/raw source bytes differ/);
  git(repo,'add','source/main.ores');
  assert.throws(()=>verify(params),/index differs/);
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
  assert.throws(()=>verify(params),/nonregular|symlink/);
  writeFileSync(join(repo,'outside.ores'),'fnc danger(): int { return 999; }\n');
  assert.throws(()=>verify(params),/nonregular|symlink/);
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


test('mirror CLI redacts absolute filesystem and Git exception details',()=>{
  const root=mkdtempSync(join(tmpdir(),'mirror-redaction-'));
  try{
    const secret='SECRET_LOCAL_PATH_COMPONENT_MUST_NOT_LEAK';
    const missing=join(root,secret,'not-a-repository');
    const manifest=join(root,'manifest.json');
    writeFileSync(manifest,JSON.stringify({
      repository:missing,subtreePath:'source',
      expectedTree:'a'.repeat(40),blobs:[]
    }));
    const cli=fileURLToPath(new URL('../bin/verify-private-mirror.mjs',import.meta.url));
    const proc=spawnSync(process.execPath,[cli,manifest],{
      encoding:'utf8',timeout:10000,
      env:{...process.env,GITHUB_TOKEN:'UNSAFE_TOKEN_MUST_NOT_PRINT'}
    });
    assert.equal(proc.status,1);
    assert.equal(proc.stdout,'');
    assert.match(proc.stderr,/^MIRROR_UNVERIFIED: UNCLASSIFIED_GIT_OR_IO_ERROR\n$/);
    assert.doesNotMatch(proc.stderr,/SECRET_LOCAL_PATH_COMPONENT|UNSAFE_TOKEN|not-a-repository/);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test('mirror safe failure classifier never echoes hostile exception messages',()=>{
  const secret='/home/runner/work/private/SECRET_PATH?token=unsafe';
  assert.equal(
    privateMirrorSafeFailureCode(new Error('ENOENT: '+secret)),
    'UNCLASSIFIED_GIT_OR_IO_ERROR'
  );
  assert.equal(
    privateMirrorSafeFailureCode(Object.defineProperty({},'message',{get(){throw Error(secret)}})),
    'UNCLASSIFIED_GIT_OR_IO_ERROR'
  );
  assert.equal(privateMirrorSafeFailureCode(new Error('exact Git subtree mismatch')),'TREE_MISMATCH');
});

test('raw verifier no longer delegates worktree-byte hashing to Git',()=>{
  const cli=fileURLToPath(new URL('../bin/verify-private-mirror.mjs',import.meta.url));
  const source=readFileSync(cli,'utf8');
  assert.doesNotMatch(source,/git\(repo,\s*['"]hash-object['"]/);
  assert.match(source,/O_NOFOLLOW/);
  assert.match(source,/gitBlobSha1FromHandle\(fd, before\.size\)/);
  assert.match(source,/readSync\(fd, buffer/);
  assert.doesNotMatch(source,/readFileSync\(fd\)/);
});


test('exact-tree verifier ignores hostile Git redirection environment',()=>{
  const repo=mkdtempSync(join(tmpdir(),'mirror-git-env-source-'));
  const decoy=mkdtempSync(join(tmpdir(),'mirror-git-env-decoy-'));
  const saved={GIT_DIR:process.env.GIT_DIR,GIT_WORK_TREE:process.env.GIT_WORK_TREE,
    GIT_INDEX_FILE:process.env.GIT_INDEX_FILE,GIT_CONFIG_COUNT:process.env.GIT_CONFIG_COUNT};
  try{
    for(const r of [repo,decoy]){
      git(r,'init','-q');
      git(r,'config','user.name','CI Mirror Test');
      git(r,'config','user.email','ci@example.invalid');
      mkdirSync(join(r,'source'));
    }
    writeFileSync(join(repo,'source','main.ores'),'fnc foo(): int { return 42; }\n');
    git(repo,'add','.');
    git(repo,'commit','-qm','real source tree');
    writeFileSync(join(decoy,'source','main.ores'),'fnc foo(): int { return 999; }\n');
    git(decoy,'add','.');
    git(decoy,'commit','-qm','decoy source tree');
    const params={repo,subtreePath:'source',
      expectedTree:git(repo,'rev-parse','HEAD:source'),
      blobs:[{path:'main.ores',sha:git(repo,'rev-parse','HEAD:source/main.ores')}]};
    process.env.GIT_DIR=join(decoy,'.git');
    process.env.GIT_WORK_TREE=decoy;
    process.env.GIT_INDEX_FILE=join(decoy,'.git','index');
    process.env.GIT_CONFIG_COUNT='1';
    process.env.GIT_CONFIG_KEY_0='core.filemode';
    process.env.GIT_CONFIG_VALUE_0='false';
    assert.equal(verify(params).status,'EXACT_TREE');
    assert.equal(privateMirrorSafeFailureCode(new Error('Git mirror inspection unavailable')),
      'GIT_INSPECTION_UNAVAILABLE');
  }finally{
    for(const [k,v] of Object.entries(saved)){
      if(v===undefined)delete process.env[k]; else process.env[k]=v;
    }
    delete process.env.GIT_CONFIG_KEY_0;
    delete process.env.GIT_CONFIG_VALUE_0;
    rmSync(repo,{recursive:true,force:true});
    rmSync(decoy,{recursive:true,force:true});
  }
});

test('pinned source blob spanning several 64-KiB reads hashes exact bytes',()=>{
  const repo=mkdtempSync(join(tmpdir(),'mirror-streamed-'));
  try{
    git(repo,'init','-q');
    git(repo,'config','user.name','CI Mirror Test');
    git(repo,'config','user.email','ci@example.invalid');
    mkdirSync(join(repo,'source'));
    // Include NUL and binary bytes, crossing 64-KiB stream boundaries.
    const source=Buffer.alloc(3*65536+19);
    for(let i=0;i<source.length;i++)source[i]=(i*173+7)&255;
    writeFileSync(join(repo,'source','large.ores'),source);
    git(repo,'add','.');
    git(repo,'commit','-qm','pin multi-chunk binary source');
    const expectedTree=git(repo,'rev-parse','HEAD:source');
    const sha=git(repo,'rev-parse','HEAD:source/large.ores');
    assert.equal(verify({repo,subtreePath:'source',expectedTree,
      blobs:[{path:'large.ores',sha}]}).status,'EXACT_TREE');
    source[65536]=source[65536]^1;
    writeFileSync(join(repo,'source','large.ores'),source);
    assert.throws(()=>verify({repo,subtreePath:'source',expectedTree,
      blobs:[{path:'large.ores',sha}]}),/raw source bytes differ/);
  }finally{rmSync(repo,{recursive:true,force:true})}
});

test('sparse tracked source over 128 MiB fails before unbounded raw-byte read',()=>{
  const repo=mkdtempSync(join(tmpdir(),'mirror-sparse-limit-'));
  try{
    git(repo,'init','-q');
    git(repo,'config','user.name','CI Mirror Test');
    git(repo,'config','user.email','ci@example.invalid');
    mkdirSync(join(repo,'source'));
    const source=join(repo,'source','large.ores');
    writeFileSync(source,'small pinned source\n');
    git(repo,'add','.');
    git(repo,'commit','-qm','pin source before sparse tampering');
    const expectedTree=git(repo,'rev-parse','HEAD:source');
    // Sparse expansion changes metadata but consumes no 128-MiB RAM.
    truncateSync(source,128*1024*1024+1);
    const request={repo,subtreePath:'source',expectedTree};
    assert.throws(()=>verify(request),/file exceeds raw-byte budget/);
    assert.equal(privateMirrorSafeFailureCode(
      new Error('source subtree file exceeds raw-byte budget')),
      'SOURCE_FILE_SIZE_LIMIT');
  }finally{rmSync(repo,{recursive:true,force:true})}
});
