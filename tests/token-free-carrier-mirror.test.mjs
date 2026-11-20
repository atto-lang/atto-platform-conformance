import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const verifier=resolve(fileURLToPath(new URL('../tools/verify-token-free-carrier-mirror.mjs',import.meta.url)));
function command(cwd,bin,args) {
  const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,`${bin} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

test('token-free carrier verification preserves full Git modes, symlink, binary and worktree',async t=>{
  const base=await mkdtemp(join(tmpdir(),'atto-tokenfree-proof-'));
  const repo=join(base,'mirror');
  await mkdir(repo);
  try {
    command(repo,'git',['init','-q']);
    command(repo,'git',['config','user.name','CI Source Auditor']);
    command(repo,'git',['config','user.email','ci-audit@example.invalid']);
    const source=join(repo,'main.atto'),exe=join(repo,'run.sh'),binary=join(repo,'binary.bin');
    const link=join(repo,'source.link');
    await writeFile(source,'pub fnc main(): int -> 42;\n');
    await writeFile(exe,'#!/bin/sh\necho OK\n');
    await chmod(exe,0o755);
    await writeFile(binary,Buffer.from([0,255,4,0,66,13,10]));
    await symlink('main.atto',link);
    command(repo,'git',['add','-A']);
    command(repo,'git',['commit','-qm','test four distinct Git blob/mode entries']);
    const tree=command(repo,'git',['rev-parse','HEAD^{tree}']);
    const sha=command(repo,'git',['rev-parse','HEAD']);
    const rows=spawnSync('git',['ls-tree','-r','-z','HEAD'],{cwd:repo,encoding:'buffer'});
    assert.equal(rows.status,0);
    const entries=rows.stdout.toString('utf8').split('\0').filter(Boolean).map(line=>{
      const m=/^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line);
      assert.ok(m,line);
      return {path:m[4],mode:m[1],type:m[2],sha:m[3]};
    });
    const manifest={schema:'atto.token-free-carrier-mirror.v1',
      source_commit_sha:sha,source_tree_sha:tree,entries};
    const mpath=join(base,'manifest.json');
    const run=(obj=manifest,wantTree=tree,wantCommit=sha)=>{
      // The manifest is independent of the carrier's Git worktree.
      return writeFile(mpath,JSON.stringify(obj)).then(()=>spawnSync(process.execPath,
        [verifier,mpath,repo,wantTree,wantCommit],{encoding:'utf8',timeout:15000}));
    };
    await t.test('exact four-entry text/executable/binary/symlink mirror accepted',async()=>{
      const r=await run();assert.equal(r.status,0,r.stderr);
      const observed=JSON.parse(r.stdout);
      assert.equal(observed.source_tree_sha,tree);
      assert.equal(observed.verified_blobs,4);
    });
    const mutate=fn=>{const value=structuredClone(manifest);fn(value);return value;};
    for(const [name,bad] of [
      ['blob digest mismatch',mutate(x=>x.entries[1].sha='a'.repeat(40))],
      ['file mode mismatch',mutate(x=>x.entries[0].mode='100755')],
      ['duplicate entry',mutate(x=>x.entries.push(x.entries[0]))],
      ['parent traversal',mutate(x=>x.entries[0].path='../escape')],
      ['stale source tree',mutate(x=>x.source_tree_sha='b'.repeat(40))],
      ['spurious source commit',mutate(x=>x.source_commit_sha='b'.repeat(40))]
    ]) await t.test(name,async()=>{
      const r=await run(bad);assert.notEqual(r.status,0,name);
      assert.match(r.stderr,/E_MIRROR_/);
    });
    await t.test('externally pinned source commit mismatches manifest',async()=>{
      const r=await run(manifest,tree,'b'.repeat(40));
      assert.notEqual(r.status,0);
      assert.match(r.stderr,/E_MIRROR_MANIFEST/);
    });
    await t.test('tampered tracked source cannot be certified',async()=>{
      const orig=await readFile(source);
      try{await writeFile(source,'pub fnc main(): int -> 99;\n');
        const r=await run();assert.notEqual(r.status,0);assert.match(r.stderr,/E_MIRROR_DIRTY_CHECKOUT/);
      }finally{await writeFile(source,orig);}
    });
    await t.test('extra untracked content cannot be certified',async()=>{
      const path=join(repo,'untracked.bin');await writeFile(path,'x');
      try{const r=await run();assert.notEqual(r.status,0);assert.match(r.stderr,/E_MIRROR_DIRTY_CHECKOUT/);}
      finally{await rm(path);}
    });
    await t.test('lost executable bit cannot be certified',async()=>{
      await chmod(exe,0o644);
      try{const r=await run();assert.notEqual(r.status,0);assert.match(r.stderr,/E_MIRROR_DIRTY_CHECKOUT/);}
      finally{await chmod(exe,0o755);}
    });
    await t.test('symlink replacement cannot be certified',async()=>{
      await rm(link);await writeFile(link,'main.atto');
      try{const r=await run();assert.notEqual(r.status,0);assert.match(r.stderr,/E_MIRROR_DIRTY_CHECKOUT/);}
      finally{await rm(link);await symlink('main.atto',link);}
    });
    await t.test('binary bytes cannot be silently changed',async()=>{
      const bytes=await readFile(binary);await writeFile(binary,Buffer.concat([bytes,Buffer.from([255])]));
      try{const r=await run();assert.notEqual(r.status,0);assert.match(r.stderr,/E_MIRROR_DIRTY_CHECKOUT/);}
      finally{await writeFile(binary,bytes);}
    });
    await t.test('tracked symlink escaping checkout is rejected even with a matching tree',async()=>{
      const escape=join(repo,'escape.link');
      await symlink('../../../etc/passwd',escape);
      command(repo,'git',['add','escape.link']);
      command(repo,'git',['commit','-qm','tracked external symlink is not admissible']);
      const nextTree=command(repo,'git',['rev-parse','HEAD^{tree}']);
      const nextCommit=command(repo,'git',['rev-parse','HEAD']);
      const output=spawnSync('git',['ls-tree','-r','-z','HEAD'],{cwd:repo,encoding:'buffer'});
      assert.equal(output.status,0);
      const nextEntries=output.stdout.toString('utf8').split('\0').filter(Boolean).map(line=>{
        const m=/^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line);
        assert.ok(m,line);
        return {path:m[4],mode:m[1],type:m[2],sha:m[3]};
      });
      const next={schema:manifest.schema,source_commit_sha:nextCommit,
        source_tree_sha:nextTree,entries:nextEntries};
      const r=await run(next,nextTree,nextCommit);
      assert.notEqual(r.status,0);
      assert.match(r.stderr,/E_MIRROR_SYMLINK_ESCAPE/);
    });
  } finally {await rm(base,{recursive:true,force:true});}
});
