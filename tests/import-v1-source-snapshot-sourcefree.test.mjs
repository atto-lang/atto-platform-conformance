import test from "node:test";
import assert from "node:assert/strict";
import {constants} from "node:fs";
import {mkdtemp,mkdir,writeFile,symlink,realpath,lstat,open,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,parse,relative,sep} from "node:path";

const MAX_BYTES=16*1024*1024;

async function requirePhysicalPath(path) {
  const absolute=await realpath(path);
  const {root}=parse(absolute);
  let current=root;
  for(const component of relative(root,absolute).split(sep).filter(Boolean)) {
    current=join(current,component);
    const info=await lstat(current);
    if(info.isSymbolicLink()) throw new Error("physical snapshot path contains symlink");
  }
  return absolute;
}

async function snapshotPhysical(physical,{afterStat}={}) {
  const {root}=parse(physical);
  let current=root;
  const parts=relative(root,physical).split(sep).filter(Boolean);
  for(let index=0;index<parts.length;index++) {
    current=join(current,parts[index]);
    const info=await lstat(current);
    if(info.isSymbolicLink()) throw new Error("physical snapshot path contains symlink");
    if(index+1<parts.length && !info.isDirectory())
      throw new Error("physical snapshot path contains non-directory");
  }

  const handle=await open(
    physical,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const before=await handle.stat();
    if(!before.isFile() || before.size<0 || before.size>MAX_BYTES)
      throw new Error("source must be a bounded regular file");
    if(afterStat) await afterStat(handle,before);

    const bytes=Buffer.alloc(before.size);
    let offset=0;
    while(offset<bytes.length) {
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
      if(bytesRead===0) throw new Error("source truncated during snapshot");
      offset+=bytesRead;
    }
    const {bytesRead:extra}=await handle.read(Buffer.alloc(1),0,1,bytes.length);
    if(extra!==0) throw new Error("source expanded during snapshot");

    const after=await handle.stat();
    if(!after.isFile() || before.size!==after.size ||
       before.dev!==after.dev || before.ino!==after.ino ||
       before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs)
      throw new Error("source changed during snapshot");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function withSandbox(t,fn) {
  const base=await mkdtemp(join(tmpdir(),"ores-source-snapshot-"));
  try { await fn(base); }
  catch(error) {
    if(["EPERM","EACCES","ENOSYS"].includes(error?.code)) {
      t.skip("symlink/no-follow facility unavailable on this host");
      return;
    }
    throw error;
  } finally {
    await rm(base,{recursive:true,force:true});
  }
}

test("caller alias may canonicalize once before physical snapshot",async t=>{
  await withSandbox(t,async base=>{
    const target=join(base,"real.ores");
    await writeFile(target,"pub fnc main(): int { return 42; }\n");
    const alias=join(base,"alias.ores");
    await symlink(target,alias);

    const physical=await requirePhysicalPath(alias);
    assert.equal(physical,await realpath(target));
    assert.equal(
      (await snapshotPhysical(physical)).toString("utf8"),
      "pub fnc main(): int { return 42; }\n"
    );
  });
});

test("physical snapshot rejects a symlink leaf",async t=>{
  await withSandbox(t,async base=>{
    const target=join(base,"target.ores");
    await writeFile(target,"pub fnc target(): int { return 1; }\n");
    const alias=join(base,"leaf.ores");
    await symlink(target,alias);
    await assert.rejects(snapshotPhysical(alias),/contains symlink/);
  });
});

test("physical snapshot rejects a symlink parent",async t=>{
  await withSandbox(t,async base=>{
    const realDir=join(base,"real");
    await mkdir(realDir);
    await writeFile(join(realDir,"main.ores"),"pub fnc main(): void { return; }\n");
    const aliasDir=join(base,"alias-dir");
    await symlink(realDir,aliasDir);
    await assert.rejects(
      snapshotPhysical(join(aliasDir,"main.ores")),
      /contains symlink/
    );
  });
});

test("bounded descriptor snapshot rejects growth after admission",async()=>{
  const base=await mkdtemp(join(tmpdir(),"ores-source-growth-"));
  try {
    const source=join(base,"growing.ores");
    await writeFile(source,"abc");
    await assert.rejects(
      snapshotPhysical(source,{
        afterStat: async (_handle,before)=>{
          await writeFile(source,"x".repeat(before.size+1));
        }
      }),
      /expanded|changed|truncated/
    );
  } finally {
    await rm(base,{recursive:true,force:true});
  }
});
