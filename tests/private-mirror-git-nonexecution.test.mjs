import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verify} from '../bin/verify-private-mirror.mjs';
function git(repo,...args){return execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim()}
function fixture(cb){
 const repo=mkdtempSync(join(tmpdir(),'ores-mirror-audit-'));
 try{
  git(repo,'init','-q');git(repo,'config','user.email','test@example.invalid');git(repo,'config','user.name','Test');
  mkdirSync(join(repo,'source'));
  writeFileSync(join(repo,'source','main.ores'),'Oreslang source\n');
  git(repo,'add','.');git(repo,'commit','-qm','pinned');
  const pins=()=>({repo,subtreePath:'source',expectedTree:git(repo,'rev-parse','HEAD:source'),blobs:[{path:'main.ores',sha:git(repo,'rev-parse','HEAD:source/main.ores')}]});
  return cb(repo,pins);
 }finally{rmSync(repo,{recursive:true,force:true})}
}
test('exact pinned clean source is admitted',()=>fixture((repo,pins)=>{
 assert.equal(verify(pins()).status,'EXACT_TREE');
}));
test('configured Git clean filter is never executed by verifier',()=>fixture((repo,pins)=>{
 const marker=join(repo,'FILTER_WAS_EXECUTED');
 git(repo,'config','filter.auditor.clean',`sh -c 'touch ${marker}; cat'`);
 writeFileSync(join(repo,'source','.gitattributes'),'*.ores filter=auditor\n');
 git(repo,'add','source/.gitattributes');git(repo,'commit','-qm','register filter');
 rmSync(marker,{force:true});
 // Git itself *would* execute this repository-configured filter on status.
 git(repo,'status','--porcelain=v1','--','source');
 assert.equal(existsSync(marker),true,'adversarial Git filter setup must be live');
 rmSync(marker,{force:true});
 assert.equal(verify(pins()).status,'EXACT_TREE');
 assert.equal(existsSync(marker),false,'verifier must not run configured filter');
}));
test('raw changed source rejects despite clean filter normalization',()=>fixture((repo,pins)=>{
 git(repo,'config','filter.auditor.clean',"sed 's/ATTACKED/ORIGINAL/g'");
 writeFileSync(join(repo,'source','.gitattributes'),'*.ores filter=auditor\n');
 writeFileSync(join(repo,'source','main.ores'),'ORIGINAL\n');
 git(repo,'add','.');git(repo,'commit','-qm','baseline');
 const params=pins();
 writeFileSync(join(repo,'source','main.ores'),'ATTACKED\n');
 assert.equal(git(repo,'status','--porcelain=v1','--','source'),'');
 assert.throws(()=>verify(params),/raw source bytes differ/);
}));
test('staged index drift is denied independent of raw working bytes',()=>fixture((repo,pins)=>{
 const params=pins();
 writeFileSync(join(repo,'source','main.ores'),'REPLACED\n');git(repo,'add','source/main.ores');
 assert.throws(()=>verify(params),/index differs/);
}));
test('untracked and ignored source files are denied',()=>fixture((repo,pins)=>{
 const params=pins();
 writeFileSync(join(repo,'source','injected.ores'),'injected');
 assert.throws(()=>verify(params),/untracked files/);
 rmSync(join(repo,'source','injected.ores'));
 writeFileSync(join(repo,'.gitignore'),'source/ignored.ores\n');
 writeFileSync(join(repo,'source','ignored.ores'),'ignored');
 assert.throws(()=>verify(params),/untracked files/);
}));
test('tracked symlink source is denied even when index equals HEAD',()=>fixture((repo,pins)=>{
 symlinkSync('main.ores',join(repo,'source','alias.ores'));
 git(repo,'add','source/alias.ores');git(repo,'commit','-qm','symlink');
 assert.throws(()=>verify(pins()),/nonregular|symlink/);
}));
test('file mode change hidden by core.filemode=false is denied',()=>fixture((repo,pins)=>{
 const params=pins();
 git(repo,'config','core.filemode','false');
 chmodSync(join(repo,'source','main.ores'),0o755);
 assert.equal(git(repo,'status','--porcelain=v1','--','source'),'');
 assert.throws(()=>verify(params),/file type or mode/);
}));
test('pinned executable regular file is admitted',()=>fixture((repo,pins)=>{
 chmodSync(join(repo,'source','main.ores'),0o755);
 git(repo,'add','source/main.ores');git(repo,'commit','-qm','executable');
 assert.equal(verify(pins()).status,'EXACT_TREE');
}));
test('skip-worktree index concealment is denied',()=>fixture((repo,pins)=>{
 const params=pins();
 git(repo,'update-index','--skip-worktree','source/main.ores');
 assert.throws(()=>verify(params),/hidden index entries/);
}));
test('incorrect pinned HEAD tree denies verification',()=>fixture((repo,pins)=>{
 assert.throws(()=>verify({...pins(),expectedTree:'f'.repeat(40)}),/mismatch/);
}));
