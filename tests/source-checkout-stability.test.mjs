import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,open,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifySourceCheckout} from '../bin/verify-source-checkout.mjs';

function git(cwd,...args){
  const p=spawnSync('git',args,{cwd,encoding:'utf8',timeout:8000});
  assert.equal(p.status,0,p.stderr);
  return p.stdout.trim();
}
async function fixture(callback){
  const dir=await mkdtemp(join(tmpdir(),'ores-stable-checkout-'));
  try{
    git(dir,'init','-q');
    git(dir,'config','user.name','Audit');git(dir,'config','user.email','audit@example.invalid');
    await writeFile(join(dir,'source.ores'),'original\n');
    git(dir,'add','.');git(dir,'commit','-qm','source');
    const pins={sourceDir:dir,expectedCommit:git(dir,'rev-parse','HEAD'),
      expectedTree:git(dir,'rev-parse','HEAD^{tree}')};
    await callback(dir,pins);
  }finally{await rm(dir,{recursive:true,force:true})}
}
async function interceptRead(file,mutation,assertion){
  const handle=await open(file,'r');
  const proto=Object.getPrototypeOf(handle);
  await handle.close();
  const original=proto.readFile;
  let intercepted=0;
  proto.readFile=async function(...args){
    const bytes=await original.apply(this,args);
    intercepted++;
    await mutation();
    return bytes;
  };
  try{await assertion();assert.equal(intercepted,1)}
  finally{proto.readFile=original}
}
test('stable file metadata and exact source identity admit pristine checkout',async()=>{
  await fixture(async(_dir,pins)=>{
    const receipt=await verifySourceCheckout(pins);
    assert.equal(receipt.trackedRawBytesVerified,true);
    assert.equal(receipt.trackedFileCount,1);
    assert.equal(receipt.compilerBuildAttested,false);
  });
});
test('same-size tracked source rewrite during open-file read fails closed',async()=>{
  await fixture(async(dir,pins)=>{
    const file=join(dir,'source.ores');
    await interceptRead(file,()=>writeFile(file,'tampered\n'),async()=>{
      await assert.rejects(verifySourceCheckout(pins),/tracked source changed during verification/);
    });
  });
});
test('same-bytes pathname inode replacement during read fails closed',async()=>{
  await fixture(async(dir,pins)=>{
    const file=join(dir,'source.ores');
    await interceptRead(file,async()=>{
      await rename(file,join(dir,'moved.bak'));
      await writeFile(file,'original\n');
    },async()=>{
      await assert.rejects(verifySourceCheckout(pins),/tracked source changed during verification/);
    });
  });
});
test('HEAD change during scan fails final identity fence',async()=>{
  await fixture(async(dir,pins)=>{
    const file=join(dir,'source.ores');
    await interceptRead(file,async()=>{
      git(dir,'commit','-q','--allow-empty','-m','concurrent revision');
    },async()=>{
      await assert.rejects(verifySourceCheckout(pins),/final identity fence/);
    });
  });
});
test('index mutation during scan fails final identity fence',async()=>{
  await fixture(async(dir,pins)=>{
    const file=join(dir,'source.ores');
    await interceptRead(file,async()=>{
      await writeFile(join(dir,'another.ores'),'staged\n');
      git(dir,'add','another.ores');
    },async()=>{
      await assert.rejects(verifySourceCheckout(pins),/final identity fence/);
    });
  });
});
