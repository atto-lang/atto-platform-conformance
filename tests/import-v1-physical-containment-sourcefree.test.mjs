import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,symlink,realpath,stat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,relative,isAbsolute} from "node:path";

const cases = Object.freeze([
  ["configured-root-symlink-internal-target","allow"],
  ["in-root-file-symlink-canonical-identity","allow"],
  ["child-file-symlink-escape","reject"],
  ["child-directory-symlink-escape","reject"]
]);

async function resolvePhysicallyConfined(configuredRoot,candidate) {
  const physicalRoot=await realpath(configuredRoot);
  assert.equal((await stat(physicalRoot)).isDirectory(),true);
  const target=await realpath(candidate);
  const rel=relative(physicalRoot,target);
  if(rel===".." || rel.startsWith(".." + (process.platform==="win32" ? "\\" : "/")) || isAbsolute(rel))
    throw new Error("physical configured-root escape");
  return target;
}

async function withSymlinkSandbox(t,fn) {
  const base=await mkdtemp(join(tmpdir(),"ores-import-physical-"));
  try { await fn(base); }
  catch(error) {
    if(["EPERM","EACCES","ENOSYS"].includes(error?.code)) {
      t.skip("symlink facility unavailable on this host");
      return;
    }
    throw error;
  } finally { await rm(base,{recursive:true,force:true}); }
}

test("import-v1 physical containment reference matrix is source-free policy only",()=>{
  assert.deepEqual(cases.map(([id])=>id),[
    "configured-root-symlink-internal-target",
    "in-root-file-symlink-canonical-identity",
    "child-file-symlink-escape",
    "child-directory-symlink-escape"
  ]);
  assert.deepEqual(cases.map(([,expect])=>expect),["allow","allow","reject","reject"]);
});

test("configured search root may itself be a symlink when target stays inside it",async t=>{
  await withSymlinkSandbox(t,async base=>{
    const physical=join(base,"physical-root");
    await mkdir(physical);
    const source=join(physical,"shared.ores");
    await writeFile(source,"pub fnc shared(): int { return 42; }\n");
    const alias=join(base,"root-alias");
    await symlink(physical,alias);
    assert.equal(await resolvePhysicallyConfined(alias,join(alias,"shared.ores")),await realpath(source));
  });
});

test("in-root alias canonicalizes to one physical source identity",async t=>{
  await withSymlinkSandbox(t,async base=>{
    const root=join(base,"root");
    await mkdir(root);
    const source=join(root,"real.ores");
    await writeFile(source,"pub fnc value(): int { return 42; }\n");
    const alias=join(root,"alias.ores");
    await symlink(source,alias);
    assert.equal(await resolvePhysicallyConfined(root,alias),await realpath(source));
  });
});

test("file and directory symlink escapes are rejected",async t=>{
  await withSymlinkSandbox(t,async base=>{
    const root=join(base,"root");
    const outside=join(base,"outside");
    await mkdir(root);await mkdir(outside);
    const external=join(outside,"secret.ores");
    await writeFile(external,"pub fnc secret(): int { return 7; }\n");

    const fileAlias=join(root,"file-alias.ores");
    await symlink(external,fileAlias);
    await assert.rejects(
      resolvePhysicallyConfined(root,fileAlias),
      /physical configured-root escape/
    );

    const dirAlias=join(root,"dir-alias");
    await symlink(outside,dirAlias);
    await assert.rejects(
      resolvePhysicallyConfined(root,join(dirAlias,"secret.ores")),
      /physical configured-root escape/
    );
  });
});
