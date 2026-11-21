import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const run=(cwd,args,env={})=>execFileSync('git',args,{cwd,encoding:'utf8',env:{...process.env,...env}}).trim();

test('the checkout attestation rejects a forged Git replacement tree',()=>{
  const dir=mkdtempSync(join(tmpdir(),'atto-source-'));
  try{
    run(dir,['init','-q']);
    run(dir,['config','user.name','CI']);
    run(dir,['config','user.email','ci@example.invalid']);
    writeFileSync(join(dir,'guest.atto'),'original\n');
    run(dir,['add','.']);run(dir,['commit','-qm','original']);
    const a=run(dir,['rev-parse','HEAD']), originalTree=run(dir,['rev-parse','HEAD^{tree}']);
    writeFileSync(join(dir,'guest.atto'),'forged\n');
    run(dir,['add','.']);run(dir,['commit','-qm','forged']);
    const b=run(dir,['rev-parse','HEAD']), forgedTree=run(dir,['rev-parse','HEAD^{tree}']);
    run(dir,['checkout','-q',a]);run(dir,['replace',a,b]);run(dir,['reset','-q','--hard',a]);
    assert.equal(run(dir,['rev-parse','HEAD']),a);
    assert.equal(run(dir,['rev-parse','HEAD^{tree}']),forgedTree);
    const noReplace={GIT_NO_REPLACE_OBJECTS:'1'};
    assert.notEqual(originalTree,forgedTree);
    assert.equal(run(dir,['--no-replace-objects','rev-parse','HEAD^{tree}'],noReplace),originalTree);
    assert.equal(run(dir,['--no-replace-objects','cat-file','-t',a],noReplace),'commit');
    assert.match(run(dir,['status','--porcelain','--untracked-files=all'],noReplace),/^M\s+guest\.atto$/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the parity workflow always performs replacement-free tree and dirty-worktree validation',()=>{
  const wf=readFileSync(new URL('../.github/workflows/atto-source-repository-parity-audit-v1.yml',import.meta.url),'utf8');
  for(const required of [
    'export GIT_NO_REPLACE_OBJECTS=1',
    'git --no-replace-objects rev-parse --verify HEAD',
    "git --no-replace-objects rev-parse --verify 'HEAD^{tree}'",
    'git status --porcelain --untracked-files=all'
  ])assert.ok(wf.includes(required),required);
});
