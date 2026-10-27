import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,symlink,realpath,stat,lstat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,relative,isAbsolute,sep} from "node:path";

const cases = Object.freeze([
  ["configured-root-symlink-internal-target","allow"],
  ["in-root-file-symlink-canonical-identity","allow"],
  ["child-file-symlink-escape","reject"],
  ["child-directory-symlink-escape","reject"],
  ["higher-priority-dangling-leaf","reject-no-fallback"],
  ["higher-priority-broken-intermediate-alias","reject-no-fallback"],
  ["higher-priority-nondirectory-prefix","reject-no-fallback"],
  ["configured-root-is-not-directory","reject-no-fallback"]
]);

function requireContained(root,target) {
  const rel=relative(root,target);
  if(rel===".." || rel.startsWith(".."+sep) || isAbsolute(rel))
    throw new Error("physical configured-root escape");
}

async function safeRealpath(path) {
  try { return await realpath(path); }
  catch(error) { throw new Error("ambiguous higher-priority source node: "+error.code); }
}

async function nodeInfo(path) {
  try { return await lstat(path); }
  catch(error) {
    if(error?.code==="ENOENT") return null;
    throw error;
  }
}

async function probeRoot(root,relativeName) {
  const physicalRoot=await safeRealpath(root);
  if(!(await stat(physicalRoot)).isDirectory())
    throw new Error("configured search root does not resolve to a directory");

  const parts=relativeName.split("/");
  let current=root;
  for(let index=0;index+1<parts.length;index++) {
    current=join(current,parts[index]);
    const info=await nodeInfo(current);
    if(info===null) return null;
    if(info.isSymbolicLink()) {
      const physical=await safeRealpath(current);
      requireContained(physicalRoot,physical);
      if(!(await stat(physical)).isDirectory())
        throw new Error("blocked by non-directory search-root component");
    } else if(!info.isDirectory()) {
      throw new Error("blocked by non-directory search-root component");
    }
  }

  for(const suffix of ["",".ores",".java"]) {
    const candidate=join(root,relativeName+suffix);
    const info=await nodeInfo(candidate);
    if(info===null) continue;
    if(info.isDirectory()) continue;
    if(!info.isFile()&&!info.isSymbolicLink())
      throw new Error("non-regular source node");

    const physical=await safeRealpath(candidate);
    requireContained(physicalRoot,physical);
    if((await stat(physical)).isFile()) return physical;
  }
  return null;
}

async function resolveRoots(roots,name) {
  for(const root of roots) {
    const found=await probeRoot(root,name);
    if(found!==null) return found;
  }
  return null;
}

async function withSandbox(t,fn) {
  const base=await mkdtemp(join(tmpdir(),"ores-import-physical-"));
  try { await fn(base); }
  catch(error) {
    if(["EPERM","EACCES","ENOSYS"].includes(error?.code)) {
      t.skip("symlink facility unavailable on this host");
      return;
    }
    throw error;
  } finally {
    await rm(base,{recursive:true,force:true});
  }
}

test("import-v1 physical containment matrix is source-free policy only",()=>{
  assert.deepEqual(cases.map(([id])=>id),[
    "configured-root-symlink-internal-target",
    "in-root-file-symlink-canonical-identity",
    "child-file-symlink-escape",
    "child-directory-symlink-escape",
    "higher-priority-dangling-leaf",
    "higher-priority-broken-intermediate-alias",
    "higher-priority-nondirectory-prefix",
    "configured-root-is-not-directory"
  ]);
  assert.deepEqual(cases.map(([,expect])=>expect),[
    "allow","allow","reject","reject",
    "reject-no-fallback","reject-no-fallback","reject-no-fallback","reject-no-fallback"
  ]);
});

test("configured search root may itself be a symlink when target stays inside it",async t=>{
  await withSandbox(t,async base=>{
    const physical=join(base,"physical-root");
    await mkdir(physical);
    const source=join(physical,"shared.ores");
    await writeFile(source,"pub fnc shared(): int { return 42; }\n");
    const alias=join(base,"root-alias");
    await symlink(physical,alias);
    assert.equal(await resolveRoots([alias],"shared"),await realpath(source));
  });
});

test("in-root alias canonicalizes to one physical source identity",async t=>{
  await withSandbox(t,async base=>{
    const root=join(base,"root");
    await mkdir(root);
    const source=join(root,"real.ores");
    await writeFile(source,"pub fnc value(): int { return 42; }\n");
    const alias=join(root,"alias.ores");
    await symlink(source,alias);
    assert.equal(await resolveRoots([root],"alias"),await realpath(source));
  });
});

test("file and directory symlink escapes are rejected",async t=>{
  await withSandbox(t,async base=>{
    const root=join(base,"root");
    const outside=join(base,"outside");
    await mkdir(root); await mkdir(outside);
    const external=join(outside,"secret.ores");
    await writeFile(external,"pub fnc secret(): int { return 7; }\n");

    const fileAlias=join(root,"file-alias.ores");
    await symlink(external,fileAlias);
    await assert.rejects(resolveRoots([root],"file-alias"),/physical configured-root escape/);

    const dirAlias=join(root,"dir-alias");
    await symlink(outside,dirAlias);
    await assert.rejects(
      resolveRoots([root],"dir-alias/secret"),
      /physical configured-root escape/
    );
  });
});

test("dangling higher-priority leaf cannot fall through to lower root",async t=>{
  await withSandbox(t,async base=>{
    const upper=join(base,"upper"),lower=join(base,"lower");
    await mkdir(upper);await mkdir(lower);
    await writeFile(join(lower,"priority.ores"),"lower\n");
    await symlink(join(upper,"missing"),join(upper,"priority.ores"));
    await assert.rejects(
      resolveRoots([upper,lower],"priority"),
      /ambiguous higher-priority source node/
    );
  });
});

test("broken higher-priority directory alias cannot fall through",async t=>{
  await withSandbox(t,async base=>{
    const upper=join(base,"upper"),lower=join(base,"lower");
    await mkdir(upper);await mkdir(lower);await mkdir(join(lower,"alias"));
    await writeFile(join(lower,"alias","priority.ores"),"lower\n");
    await symlink(join(upper,"missing-dir"),join(upper,"alias"));
    await assert.rejects(
      resolveRoots([upper,lower],"alias/priority"),
      /ambiguous higher-priority source node/
    );
  });
});

test("non-directory higher-priority prefix cannot fall through",async()=>{
  const base=await mkdtemp(join(tmpdir(),"ores-import-prefix-"));
  try {
    const upper=join(base,"upper"),lower=join(base,"lower");
    await mkdir(upper);await mkdir(lower);await mkdir(join(lower,"alias"));
    await writeFile(join(upper,"alias"),"not a directory\n");
    await writeFile(join(lower,"alias","priority.ores"),"lower\n");
    await assert.rejects(
      resolveRoots([upper,lower],"alias/priority"),
      /blocked by non-directory/
    );
  } finally {
    await rm(base,{recursive:true,force:true});
  }
});

test("existing configured root that is not a directory rejects",async()=>{
  const base=await mkdtemp(join(tmpdir(),"ores-import-root-file-"));
  try {
    const invalidRoot=join(base,"configured-root-file");
    const lower=join(base,"lower");
    await writeFile(invalidRoot,"not a directory\n");
    await mkdir(lower);
    await assert.rejects(
      resolveRoots([invalidRoot,lower],"missing"),
      /configured search root does not resolve to a directory/
    );
  } finally {
    await rm(base,{recursive:true,force:true});
  }
});


test("dot-prefixed bare names resolve through configured roots",async()=>{
  const base=await mkdtemp(join(tmpdir(),"ores-import-dot-bare-"));
  try {
    const root=join(base,"root");
    await mkdir(join(root,".hidden"),{recursive:true});
    await mkdir(join(root,"..backup"),{recursive:true});
    const hidden=join(root,".hidden","util.ores");
    const backup=join(root,"..backup","util.ores");
    await writeFile(hidden,"pub fnc hidden(): int { return 1; }\n");
    await writeFile(backup,"pub fnc backup(): int { return 2; }\n");
    assert.equal(await resolveRoots([root],".hidden/util"),await realpath(hidden));
    assert.equal(await resolveRoots([root],"..backup/util"),await realpath(backup));
  } finally {
    await rm(base,{recursive:true,force:true});
  }
});
