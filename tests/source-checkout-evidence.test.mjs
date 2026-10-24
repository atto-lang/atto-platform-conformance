import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,appendFile,symlink,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySourceCheckout} from '../bin/verify-source-checkout.mjs';

const script=fileURLToPath(new URL('../bin/verify-source-checkout.mjs',import.meta.url));
function git(cwd,...args){
 const p=spawnSync('git',args,{cwd,encoding:'utf8',timeout:8000,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
 assert.equal(p.status,0,p.stderr);return p.stdout.trim();
}
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'ores-source-receipt-'));
 git(root,'init','-q');git(root,'config','user.email','test@example.invalid');git(root,'config','user.name','Test');
 await writeFile(join(root,'source.txt'),'one\n');git(root,'add','source.txt');git(root,'commit','-qm','first');
 const commit=git(root,'rev-parse','HEAD'), tree=git(root,'rev-parse','HEAD^{tree}');
 return {root,commit,tree,opts:{sourceDir:root,expectedCommit:commit,expectedTree:tree}};
}
test('clean exact checkout produces explicitly limited evidence',async()=>{
 const f=await setup();try{
  const x=await verifySourceCheckout(f.opts);
  assert.equal(x.worktreeClean,true);assert.equal(x.sourceCommit,f.commit);
  assert.equal(x.sourceRootTree,f.tree);assert.equal(x.compilerBuildAttested,false);
  assert.equal(x.privateSourceTransferAuthorized,false);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
test('wrong head fails closed',async()=>{
 const f=await setup();try{await assert.rejects(verifySourceCheckout({...f.opts,expectedCommit:'a'.repeat(40)}),/mismatch/)}finally{await rm(f.root,{recursive:true,force:true})}
});
test('wrong root tree fails closed',async()=>{
 const f=await setup();try{await assert.rejects(verifySourceCheckout({...f.opts,expectedTree:'b'.repeat(40)}),/mismatch/)}finally{await rm(f.root,{recursive:true,force:true})}
});
test('tracked mutation fails closed',async()=>{
 const f=await setup();try{await appendFile(join(f.root,'source.txt'),'two\n');await assert.rejects(verifySourceCheckout(f.opts),/changes/)}finally{await rm(f.root,{recursive:true,force:true})}
});
test('untracked file fails closed',async()=>{
 const f=await setup();try{await writeFile(join(f.root,'new-file'),'untracked');await assert.rejects(verifySourceCheckout(f.opts),/changes/)}finally{await rm(f.root,{recursive:true,force:true})}
});
test('nested path fails closed',async()=>{
 const f=await setup();try{const nested=join(f.root,'sub');await mkdir(nested);await assert.rejects(verifySourceCheckout({...f.opts,sourceDir:nested}),/root/)}finally{await rm(f.root,{recursive:true,force:true})}
});
test('symlinked source path fails closed',async()=>{
 const f=await setup();const link=f.root+'-link';try{await symlink(f.root,link);await assert.rejects(verifySourceCheckout({...f.opts,sourceDir:link}),/nonsymlink/)}finally{await rm(link,{force:true});await rm(f.root,{recursive:true,force:true})}
});
test('malformed SHA fails before Git inspection',async()=>{
 const f=await setup();try{await assert.rejects(verifySourceCheckout({...f.opts,expectedCommit:'INVALID'}),/40-character/)}finally{await rm(f.root,{recursive:true,force:true})}
});
test('ignored extra files fail closed even when git status is clean',async()=>{
 const f=await setup();try{
  await writeFile(join(f.root,'.gitignore'),'ignored.bin\n');
  git(f.root,'add','.gitignore');git(f.root,'commit','-qm','ignore pattern');
  const opts={sourceDir:f.root,expectedCommit:git(f.root,'rev-parse','HEAD'),expectedTree:git(f.root,'rev-parse','HEAD^{tree}')};
  await writeFile(join(f.root,'ignored.bin'),'host override');
  assert.equal(git(f.root,'status','--porcelain=v1'),'');
  await assert.rejects(verifySourceCheckout(opts),/ignored local files/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
test('assume-unchanged and skip-worktree flags fail closed',async()=>{
 const f=await setup();try{
  git(f.root,'update-index','--assume-unchanged','source.txt');
  await assert.rejects(verifySourceCheckout(f.opts),/sparse\/assume-unchanged/);
  git(f.root,'update-index','--no-assume-unchanged','source.txt');
  git(f.root,'update-index','--skip-worktree','source.txt');
  await assert.rejects(verifySourceCheckout(f.opts),/sparse\/assume-unchanged/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
test('core.filemode=false cannot conceal an executable-bit mutation',async()=>{
 const f=await setup();try{
  git(f.root,'config','core.filemode','false');
  await chmod(join(f.root,'source.txt'),0o755);
  assert.equal(git(f.root,'status','--porcelain=v1'),'');
  await assert.rejects(verifySourceCheckout(f.opts),/tracked or untracked changes/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
test('a clean committed symlink is not an allowed source input',async()=>{
 const f=await setup();try{
  await symlink('source.txt',join(f.root,'linked.src'));
  git(f.root,'add','linked.src');
  git(f.root,'commit','-qm','track symbolic link');
  const opts={sourceDir:f.root,
    expectedCommit:git(f.root,'rev-parse','HEAD'),
    expectedTree:git(f.root,'rev-parse','HEAD^{tree}')};
  assert.equal(git(f.root,'status','--porcelain=v1'),'');
  await assert.rejects(verifySourceCheckout(opts),/nonregular tracked files/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
test('CLI fail-closed contract and successful JSON receipt',async()=>{
 const f=await setup();try{
  const ok=spawnSync(process.execPath,[script,'--source-dir='+f.root,'--commit='+f.commit,'--tree='+f.tree],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).compilerBuildAttested,false);
  const bad=spawnSync(process.execPath,[script,'--source-dir='+f.root,'--commit='+f.commit,'--tree='+f.tree,'--unknown=x'],{encoding:'utf8'});
  assert.equal(bad.status,2);assert.match(bad.stderr,/SOURCE_CHECKOUT_UNVERIFIED/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
