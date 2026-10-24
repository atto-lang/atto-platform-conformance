#!/usr/bin/env node
// Exact Git checkout admission before a local/authorized source compilation.
// This observes a checkout, NOT source->compiler-binary build provenance.
import {spawnSync} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
const safeEnv={
  PATH:process.platform==='win32' ? (process.env.SystemRoot ? process.env.SystemRoot+'\\System32' : 'C:\\Windows\\System32') : '/usr/local/bin:/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',
  GIT_OPTIONAL_LOCKS:'0', GIT_TERMINAL_PROMPT:'0', LC_ALL:'C'
};
function git(sourceDir,args){
  const p=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false',
    '-c','core.untrackedCache=false','-c','core.filemode=true',
    '-C',sourceDir,...args],{
    encoding:'utf8',timeout:15000,maxBuffer:1024*1024,shell:false,
    windowsHide:true,env:safeEnv
  });
  if(p.error||p.signal||p.status!==0)
    throw Error('Git checkout inspection unavailable: '+(p.error?.code||p.signal||p.status));
  if(p.stderr!=='')throw Error('Git checkout inspection emitted unexpected stderr');
  return p.stdout;
}
export async function verifySourceCheckout({sourceDir,expectedCommit,expectedTree}={}){
  if(!SHA.test(expectedCommit)||!SHA.test(expectedTree))
    throw Error('exact 40-character commit and root-tree SHAs required');
  if(typeof sourceDir!=='string'||!isAbsolute(sourceDir))
    throw Error('source checkout must have an absolute path');
  const stat=await lstat(sourceDir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(sourceDir)!==sourceDir)
    throw Error('source checkout must be a canonical nonsymlink directory');
  const top=git(sourceDir,['rev-parse','--show-toplevel']).trimEnd();
  if(top!==sourceDir)throw Error('source checkout path must equal Git worktree root');
  const observedCommit=git(sourceDir,['rev-parse','--verify','HEAD^{commit}']).trim();
  const observedTree=git(sourceDir,['rev-parse','--verify','HEAD^{tree}']).trim();
  if(observedCommit!==expectedCommit||observedTree!==expectedTree)
    throw Error('source checkout commit/tree identity mismatch');
  if(git(sourceDir,['status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none'])!=='')
    throw Error('source checkout contains tracked or untracked changes');
  // Git's clean status omits ignored files and index flags can intentionally
  // hide dirty worktree bytes. Exact-source admission must deny both.
  if(git(sourceDir,['ls-files','--others','--ignored','--exclude-standard','-z'])!=='')
    throw Error('source checkout contains ignored local files');
  const indexFlags=git(sourceDir,['ls-files','-v','-z']);
  if(indexFlags.split('\0').some(entry=>entry!==''&&entry.slice(0,2)!=='H '))
    throw Error('source checkout has sparse/assume-unchanged index entries');
  // HEAD may legitimately contain executable regular files, but symbolic
  // links (120000), Git submodules (160000), and unresolved index stages
  // cannot be used as inputs to a sealed private compiler build.
  // A clean status alone does not reject any of these tracked object kinds.
  const tracked=git(sourceDir,['ls-files','--stage','-z']).split('\0').filter(Boolean);
  if(!tracked.length||tracked.some(entry=>
     !/^100(?:644|755) [a-f0-9]{40} 0\t[^\0]+$/.test(entry)))
    throw Error('source checkout has nonregular tracked files or unresolved stages');
  return Object.freeze({schemaVersion:1,contract:'oreslang.ci/exact-source-checkout-v1',
    sourceCommit:observedCommit,sourceRootTree:observedTree,worktreeClean:true,
    commitAndTreeVerified:true,compilerBuildAttested:false,privateSourceTransferAuthorized:false});
}
function parseArgs(argv){
  const allowed=new Set(['source-dir','commit','tree']), args={};
  for(const value of argv){
    const m=/^--([a-z][a-z-]*)=(.+)$/.exec(value);
    if(!m||!allowed.has(m[1])||Object.hasOwn(args,m[1]))
      throw Error('unexpected or duplicate argument');
    args[m[1]]=m[2];
  }
  for(const key of allowed)if(!args[key])throw Error('missing --'+key);
  return {sourceDir:args['source-dir'],expectedCommit:args.commit,expectedTree:args.tree};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const receipt=await verifySourceCheckout(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
  }catch(e){
    process.stderr.write('SOURCE_CHECKOUT_UNVERIFIED: '+String(e.message).slice(0,260)+'\n');
    process.exitCode=2;
  }
}
