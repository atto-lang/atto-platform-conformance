import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp, mkdir, writeFile, symlink, lstat, stat, realpath, rm
} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";

const PACKAGE_MANIFEST=".ores.pkg.toml";
const LEGACY_MANIFEST=".oreslangc.cfg.toml";

async function nodeInfo(path) {
  try { return await lstat(path); }
  catch(error) {
    // Match Java Files.exists(..., NOFOLLOW_LINKS): a missing child or a
    // child beneath a non-directory ancestor is not itself an existing node.
    // The caller then walks to the parent and can reject that ancestor.
    if(error?.code==="ENOENT" || error?.code==="ENOTDIR") return null;
    throw error;
  }
}

async function markerIn(directory) {
  const modern=join(directory,PACKAGE_MANIFEST);
  if(await nodeInfo(modern)!==null) return modern;
  const legacy=join(directory,LEGACY_MANIFEST);
  return await nodeInfo(legacy)!==null ? legacy : null;
}

async function discoverManifest(start) {
  let cursor=resolve(start);
  for(;;) {
    const marker=await markerIn(cursor);
    if(marker!==null) return marker;
    const parent=dirname(cursor);
    if(parent===cursor) return null;
    cursor=parent;
  }
}

async function loadModernRoot(manifest) {
  const info=await nodeInfo(manifest);
  if(info===null || info.isSymbolicLink() || !info.isFile())
    throw new Error("project manifest must be a regular non-symlink file");
  if(manifest.endsWith(PACKAGE_MANIFEST)) return realpath(dirname(manifest));
  return resolve(dirname(manifest));
}

function projectRootRelativePath(specifier) {
  if(!specifier.startsWith("+")) throw new Error("not project-root");
  if(specifier.includes("\\")) throw new Error("forward slashes required");
  if(specifier.startsWith("+/")) throw new Error("retired +/ spelling");
  const local=specifier.slice(1);
  if(local.length===0 || local.includes(":") || /[\u0000-\u001f\u007f]/u.test(local))
    throw new Error("invalid project-root import");
  for(const component of local.split("/")) {
    if(component==="" || component==="." || component==="..")
      throw new Error("invalid project-root import");
  }
  return local;
}

function requireContained(root,target) {
  const rel=relative(root,target);
  if(rel===".." || rel.startsWith(".."+sep) || isAbsolute(rel))
    throw new Error("physical package-root escape");
}

async function hasMarker(directory) {
  return await nodeInfo(join(directory,PACKAGE_MANIFEST))!==null ||
    await nodeInfo(join(directory,LEGACY_MANIFEST))!==null;
}

async function rejectNested(root,target) {
  let cursor=(await stat(target)).isDirectory() ? target : dirname(target);
  while(cursor!==root) {
    if(await hasMarker(cursor)) throw new Error("nested package boundary");
    const parent=dirname(cursor);
    if(parent===cursor) throw new Error("invalid boundary walk");
    cursor=parent;
  }
}

async function canonicalSource(candidate) {
  for(const suffix of ["",".ores",".java"]) {
    const path=candidate+suffix;
    const info=await nodeInfo(path);
    if(info===null || info.isDirectory()) continue;
    if(!info.isFile()&&!info.isSymbolicLink())
      throw new Error("non-regular source node");
    const physical=await realpath(path);
    if(!(await stat(physical)).isFile())
      throw new Error("source is not regular");
    return physical;
  }
  return null;
}

async function resolveProjectRootImport(manifest,specifier) {
  if(!manifest.endsWith(PACKAGE_MANIFEST))
    throw new Error("project-root import requires .ores.pkg.toml");
  const root=await loadModernRoot(manifest);
  const local=projectRootRelativePath(specifier);
  const source=await canonicalSource(join(root,local));
  if(source===null) return null;
  requireContained(root,source);
  await rejectNested(root,source);
  return source;
}

async function nearestPackageAuthority(importer) {
  const physicalImporter=await realpath(importer);
  let cursor=dirname(physicalImporter);
  for(;;) {
    const modern=join(cursor,PACKAGE_MANIFEST);
    if(await nodeInfo(modern)!==null) {
      return {manifest:modern,root:await loadModernRoot(modern)};
    }

    const legacy=join(cursor,LEGACY_MANIFEST);
    const legacyInfo=await nodeInfo(legacy);
    if(legacyInfo!==null) {
      throw new Error("nearest package authority is legacy");
    }

    const parent=dirname(cursor);
    if(parent===cursor) break;
    cursor=parent;
  }
  throw new Error("project-root import requires .ores.pkg.toml");
}

async function resolveProjectRootFromImporter(importer,specifier) {
  const authority=await nearestPackageAuthority(importer);
  return resolveProjectRootImport(authority.manifest,specifier);
}

async function verifyConfiguredPath(root,value,{directory=false}={}) {
  if(value==null || value.trim()==="")
    throw new Error("blank package path");
  if(value.includes("\\") || value.includes(":") || /[\u0000-\u001f\u007f]/u.test(value))
    throw new Error("invalid package path");
  if(value!=="." && value.split("/").some(x=>x===""||x==="."||x===".."))
    throw new Error("invalid package path");
  if(isAbsolute(value)) throw new Error("absolute package path");

  const candidate=resolve(root,value);
  requireContained(root,candidate);

  let existing=candidate;
  while(await nodeInfo(existing)===null) {
    const parent=dirname(existing);
    if(parent===existing) throw new Error("cannot establish package authority");
    existing=parent;
  }
  const physical=await realpath(existing);
  requireContained(root,physical);
  const existingDirectory=(await stat(physical)).isDirectory();
  if(existing===candidate && directory && !existingDirectory)
    throw new Error("configured package root is not directory");
  if(existing!==candidate && !existingDirectory)
    throw new Error("configured package path has non-directory ancestor");

  let cursor=existingDirectory?physical:dirname(physical);
  while(cursor!==root) {
    if(await hasMarker(cursor)) throw new Error("nested package boundary");
    const parent=dirname(cursor);
    if(parent===cursor) throw new Error("invalid boundary walk");
    cursor=parent;
  }
  return candidate;
}

async function withSandbox(fn) {
  const base=await mkdtemp(join(tmpdir(),"ores-package-root-"));
  try { await fn(base); }
  finally { await rm(base,{recursive:true,force:true}); }
}

async function symlinkOrSkip(t,target,path) {
  try { await symlink(target,path); }
  catch(error) {
    if(["EPERM","EACCES","ENOSYS"].includes(error?.code)) {
      t.skip("symlink facility unavailable");
      return false;
    }
    throw error;
  }
  return true;
}

test("modern marker wins over legacy marker in the same directory",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"); await mkdir(root);
    await writeFile(join(root,LEGACY_MANIFEST),"legacy");
    await writeFile(join(root,PACKAGE_MANIFEST),"modern");
    assert.equal(await discoverManifest(root),join(root,PACKAGE_MANIFEST));
    assert.equal(await loadModernRoot(join(root,PACKAGE_MANIFEST)),await realpath(root));
  });
});

test("malformed modern marker shape blocks legacy fallback",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"); await mkdir(root);
    await writeFile(join(root,LEGACY_MANIFEST),"legacy");
    await mkdir(join(root,PACKAGE_MANIFEST));
    const selected=await discoverManifest(root);
    assert.equal(selected,join(root,PACKAGE_MANIFEST));
    await assert.rejects(loadModernRoot(selected),/regular non-symlink/);
  });
});

test("canonical +path resolves and retired +/ spelling rejects",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"); await mkdir(join(root,"lib"),{recursive:true});
    const manifest=join(root,PACKAGE_MANIFEST);
    const target=join(root,"lib","telemetry.ores");
    await writeFile(manifest,"modern");
    await writeFile(target,"x");
    assert.equal(await resolveProjectRootImport(manifest,"+lib/telemetry"),await realpath(target));
    for(const bad of ["+","+/lib/telemetry","+../x","+lib/../x","+lib//x","+lib/./x","+lib\\x","+C:/x"]) {
      await assert.rejects(resolveProjectRootImport(manifest,bad));
    }
  });
});

test("legacy marker cannot authorize +path",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"legacy"); await mkdir(root);
    const manifest=join(root,LEGACY_MANIFEST); await writeFile(manifest,"legacy");
    await assert.rejects(
      resolveProjectRootImport(manifest,"+lib/value"),
      /requires .ores.pkg.toml/
    );
  });
});

test("project-root import rejects file and directory symlink escape",async t=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"),outside=join(base,"outside");
    await mkdir(join(root,"lib"),{recursive:true}); await mkdir(outside);
    const manifest=join(root,PACKAGE_MANIFEST); await writeFile(manifest,"modern");
    const secret=join(outside,"secret.ores"); await writeFile(secret,"x");
    if(!await symlinkOrSkip(t,secret,join(root,"lib","file.ores"))) return;
    if(!await symlinkOrSkip(t,outside,join(root,"lib","dir"))) return;
    await assert.rejects(resolveProjectRootImport(manifest,"+lib/file"),/escape/);
    await assert.rejects(resolveProjectRootImport(manifest,"+lib/dir/secret"),/escape/);
  });
});

test("project-root import rejects nested modern and legacy packages",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"); await mkdir(root);
    const manifest=join(root,PACKAGE_MANIFEST); await writeFile(manifest,"modern");
    for(const [name,marker] of [["modern",PACKAGE_MANIFEST],["legacy",LEGACY_MANIFEST]]) {
      const child=join(root,name); await mkdir(child);
      await writeFile(join(child,marker),"marker");
      await writeFile(join(child,"secret.ores"),"x");
      await assert.rejects(
        resolveProjectRootImport(manifest,"+"+name+"/secret"),
        /nested package boundary/
      );
    }
  });
});

test("modern configured paths reject lexical escape and platform-specific spellings",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"); await mkdir(root);
    for(const bad of ["../outside","child/../outside","child//x","child/./x","child\\x","C:/outside"]) {
      await assert.rejects(verifyConfiguredPath(root,bad,{directory:true}));
    }
  });
});

test("modern configured path rejects symlinked ancestor escape",async t=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"),outside=join(base,"outside");
    await mkdir(root); await mkdir(outside);
    if(!await symlinkOrSkip(t,outside,join(root,"alias"))) return;
    await assert.rejects(
      verifyConfiguredPath(root,"alias/generated",{directory:true}),
      /escape/
    );
  });
});

test("modern configured path rejects nested package authority",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"),child=join(root,"child");
    await mkdir(child,{recursive:true});
    await writeFile(join(child,PACKAGE_MANIFEST),"marker");
    await assert.rejects(
      verifyConfiguredPath(root,"child",{directory:true}),
      /nested package boundary/
    );
  });
});

test("ORES_PATHS order precedes legacy ambient path and empty entries add nothing",async()=>{
  await withSandbox(async base=>{
    const modern=join(base,"modern"),legacy=join(base,"legacy");
    await mkdir(modern); await mkdir(legacy);
    const modernTarget=join(modern,"shared.ores"),legacyTarget=join(legacy,"shared.ores");
    await writeFile(modernTarget,"modern"); await writeFile(legacyTarget,"legacy");
    const modernParts=(":"+modern+"::").split(":").filter(Boolean);
    const roots=[...modernParts,legacy];
    assert.equal(await canonicalSource(join(roots[0],"shared")),await realpath(modernTarget));
    assert.equal(roots.length,2);
  });
});


test("project-root authority follows the importer's nearest modern package",async()=>{
  await withSandbox(async base=>{
    const entry=join(base,"entry");
    const dependency=join(base,"dependency");
    await mkdir(entry); await mkdir(join(dependency,"src"),{recursive:true});
    await mkdir(join(dependency,"lib"),{recursive:true});
    await writeFile(join(entry,PACKAGE_MANIFEST),"modern");
    await writeFile(join(dependency,PACKAGE_MANIFEST),"modern");
    const importer=join(dependency,"src","worker.ores");
    const target=join(dependency,"lib","helper.ores");
    await writeFile(importer,"x"); await writeFile(target,"x");
    assert.equal(
      await resolveProjectRootFromImporter(importer,"+lib/helper"),
      await realpath(target)
    );
  });
});

test("nested legacy package blocks parent modern + authority",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"parent"),nested=join(root,"nested");
    await mkdir(nested,{recursive:true});
    await writeFile(join(root,PACKAGE_MANIFEST),"modern");
    await writeFile(join(nested,LEGACY_MANIFEST),"legacy");
    const importer=join(nested,"main.ores"); await writeFile(importer,"x");
    await assert.rejects(
      resolveProjectRootFromImporter(importer,"+lib/helper"),
      /nearest package authority is legacy/
    );
  });
});

test("malformed nearest modern marker blocks parent + authority",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"parent"),nested=join(root,"nested");
    await mkdir(nested,{recursive:true});
    await writeFile(join(root,PACKAGE_MANIFEST),"modern");
    await mkdir(join(nested,PACKAGE_MANIFEST));
    const importer=join(nested,"main.ores"); await writeFile(importer,"x");
    await assert.rejects(
      resolveProjectRootFromImporter(importer,"+lib/helper"),
      /regular non-symlink/
    );
  });
});


test("dangling nested legacy marker blocks parent + authority",async t=>{
  await withSandbox(async base=>{
    const root=join(base,"parent"),nested=join(root,"nested");
    await mkdir(nested,{recursive:true});
    await writeFile(join(root,PACKAGE_MANIFEST),"modern");
    if(!await symlinkOrSkip(
      t,
      join(nested,"missing-legacy.toml"),
      join(nested,LEGACY_MANIFEST)
    )) return;
    const importer=join(nested,"main.ores"); await writeFile(importer,"x");
    await assert.rejects(
      resolveProjectRootFromImporter(importer,"+lib/helper"),
      /nearest package authority is legacy/
    );
  });
});

test("modern configured missing path rejects non-directory ancestor",async()=>{
  await withSandbox(async base=>{
    const root=join(base,"pkg"); await mkdir(root);
    await writeFile(join(root,"blocked"),"not a directory");
    await assert.rejects(
      verifyConfiguredPath(root,"blocked/generated",{directory:true}),
      /non-directory ancestor/
    );
  });
});
