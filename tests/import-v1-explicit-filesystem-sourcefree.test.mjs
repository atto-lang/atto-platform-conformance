import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,symlink,realpath,lstat,stat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,isAbsolute} from "node:path";

const LEGACY_PACKAGE_MARKER=".oreslangc.cfg.toml";

async function info(path) {
  try { return await lstat(path); }
  catch(error) {
    if(error?.code==="ENOENT") return null;
    throw error;
  }
}

async function canonicalCandidate(candidate) {
  const node=await info(candidate);
  if(node===null) return null;
  if(node.isDirectory()) return null;
  if(!node.isFile()&&!node.isSymbolicLink()) throw new Error("non-regular source node");
  const physical=await realpath(candidate);
  if(!(await stat(physical)).isFile()) return null;
  return physical;
}

async function resolveSource(candidate) {
  const normalized=resolve(candidate);
  const exact=await canonicalCandidate(normalized);
  if(exact!==null) return exact;
  if(/\.(?:ores|java)$/i.test(normalized)) return null;
  return await canonicalCandidate(normalized+".ores") ??
    await canonicalCandidate(normalized+".java");
}

function requireContained(root,source) {
  const normalized=root.endsWith("/")?root:root+"/";
  if(source!==root&&!source.startsWith(normalized))
    throw new Error("relative import escapes physical project root");
}

function rejectNested(root,source) {
  let cursor=resolve(source,"..");
  while(cursor!==root) {
    if(isAbsolute(cursor)===false || cursor===resolve(cursor,".."))
      throw new Error("invalid package walk");
    // Marker existence is authoritative; it need not be a valid manifest for
    // this source-free boundary model.
    // eslint-disable-next-line no-await-in-loop
    throwIfMarker(cursor);
    cursor=resolve(cursor,"..");
  }
}

function throwIfMarker(cursor) {
  // synchronous shape intentionally avoided; caller handles asynchronously.
}

async function rejectNestedAsync(root,source) {
  let cursor=resolve(source,"..");
  while(cursor!==root) {
    const marker=await info(join(cursor,LEGACY_PACKAGE_MARKER));
    if(marker!==null) throw new Error("relative import crosses nested package boundary");
    const parent=resolve(cursor,"..");
    if(parent===cursor) throw new Error("invalid package walk");
    cursor=parent;
  }
}

async function resolveExplicit({importer,specifier,projectRoot=null}) {
  const raw=specifier.replaceAll("\\","/");
  if(isAbsolute(raw)) return resolveSource(raw);

  const explicitRelative = raw==="." || raw===".." ||
    raw.startsWith("./") || raw.startsWith("../");
  if(explicitRelative) {
    const physicalImporter=await realpath(importer);
    if(!(await stat(physicalImporter)).isFile())
      throw new Error("importer is not a regular source file");
    const candidate=resolve(physicalImporter,"..",raw);
    const source=await resolveSource(candidate);
    if(source===null) return null;
    if(projectRoot!==null) {
      const physicalRoot=await realpath(projectRoot);
      if(!(await stat(physicalRoot)).isDirectory())
        throw new Error("project root is not a directory");
      requireContained(physicalRoot,source);
      await rejectNestedAsync(physicalRoot,source);
    }
    return source;
  }
  return null;
}

async function withSandbox(fn) {
  const base=await mkdtemp(join(tmpdir(),"ores-explicit-import-"));
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

test("manifest-backed relative parent escape rejects",async()=>{
  await withSandbox(async base=>{
    const project=await mkdir(join(base,"project"),{recursive:true}).then(()=>join(base,"project"));
    const src=join(project,"src"); await mkdir(src);
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    const outside=join(base,"outside.ores"); await writeFile(outside,"x");
    await assert.rejects(
      resolveExplicit({importer,specifier:"../../outside",projectRoot:project}),
      /escapes physical project root/
    );
  });
});

test("manifest-backed relative file symlink escape rejects",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project"); const src=join(project,"src");
    await mkdir(src,{recursive:true});
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    const outside=join(base,"outside.ores"); await writeFile(outside,"x");
    if(!await symlinkOrSkip(t,outside,join(src,"secret.ores"))) return;
    await assert.rejects(
      resolveExplicit({importer,specifier:"./secret",projectRoot:project}),
      /escapes physical project root/
    );
  });
});

test("manifest-backed relative directory symlink escape rejects",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project"); const src=join(project,"src");
    await mkdir(src,{recursive:true});
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    const outside=join(base,"outside"); await mkdir(outside);
    await writeFile(join(outside,"secret.ores"),"x");
    if(!await symlinkOrSkip(t,outside,join(src,"external"))) return;
    await assert.rejects(
      resolveExplicit({importer,specifier:"./external/secret",projectRoot:project}),
      /escapes physical project root/
    );
  });
});

test("manifest-backed relative import rejects nested package marker",async()=>{
  await withSandbox(async base=>{
    const project=join(base,"project"); const src=join(project,"src"); const child=join(src,"child");
    await mkdir(child,{recursive:true});
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    await writeFile(join(child,LEGACY_PACKAGE_MARKER),"schema_version = \"1\"\n");
    await writeFile(join(child,"secret.ores"),"x");
    await assert.rejects(
      resolveExplicit({importer,specifier:"./child/secret",projectRoot:project}),
      /nested package boundary/
    );
  });
});

test("manifest-backed symlinked importer cannot launder outside sibling",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project");
    const src=join(project,"src");
    const outside=join(base,"outside");
    await mkdir(src,{recursive:true});
    await mkdir(outside);
    const physicalImporter=join(outside,"main.ores");
    await writeFile(physicalImporter,"x");
    await writeFile(join(outside,"helper.ores"),"x");
    const importer=join(src,"main.ores");
    if(!await symlinkOrSkip(t,physicalImporter,importer)) return;
    await assert.rejects(
      resolveExplicit({importer,specifier:"./helper",projectRoot:project}),
      /escapes physical project root/
    );
  });
});

test("manifest-backed in-root alias canonicalizes",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project"); const src=join(project,"src");
    await mkdir(src,{recursive:true});
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    const target=join(src,"real.ores"); await writeFile(target,"x");
    const alias=join(src,"alias.ores");
    if(!await symlinkOrSkip(t,target,alias)) return;
    assert.equal(
      await resolveExplicit({importer,specifier:"./alias",projectRoot:project}),
      await realpath(target)
    );
  });
});

test("absolute import remains explicit and canonical",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project"); const src=join(project,"src");
    await mkdir(src,{recursive:true});
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    const target=join(base,"outside.ores"); await writeFile(target,"x");
    const alias=join(base,"absolute-alias.ores");
    if(!await symlinkOrSkip(t,target,alias)) return;
    assert.equal(
      await resolveExplicit({importer,specifier:alias,projectRoot:project}),
      await realpath(target)
    );
  });
});

test("no-manifest parent-relative import remains supported",async()=>{
  await withSandbox(async base=>{
    const app=join(base,"app"); const shared=join(base,"shared");
    await mkdir(app); await mkdir(shared);
    const importer=join(app,"main.ores"); await writeFile(importer,"x");
    const target=join(shared,"value.ores"); await writeFile(target,"x");
    assert.equal(
      await resolveExplicit({importer,specifier:"../shared/value"}),
      await realpath(target)
    );
  });
});

test("dangling explicit alias fails closed",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project"); const src=join(project,"src");
    await mkdir(src,{recursive:true});
    const importer=join(src,"main.ores"); await writeFile(importer,"x");
    const alias=join(src,"dangling.ores");
    if(!await symlinkOrSkip(t,join(src,"missing.ores"),alias)) return;
    await assert.rejects(
      resolveExplicit({importer,specifier:"./dangling",projectRoot:project})
    );
  });
});


test("dot-prefixed names remain bare rather than explicit-relative",async()=>{
  await withSandbox(async base=>{
    const project=join(base,"project");
    const src=join(project,"src");
    await mkdir(src,{recursive:true});
    const importer=join(src,"main.ores");
    await writeFile(importer,"x");

    assert.equal(
      await resolveExplicit({importer,specifier:".hidden/util",projectRoot:project}),
      null
    );
    assert.equal(
      await resolveExplicit({importer,specifier:"..backup/util",projectRoot:project}),
      null
    );
  });
});


test("nested package reached through directory alias still rejects",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project");
    const src=join(project,"src");
    const child=join(src,"child");
    await mkdir(child,{recursive:true});
    const importer=join(src,"main.ores");
    await writeFile(importer,"x");
    await writeFile(join(child,LEGACY_PACKAGE_MARKER),"schema_version = \"1\"\n");
    await writeFile(join(child,"secret.ores"),"x");
    if(!await symlinkOrSkip(t,child,join(src,"alias"))) return;
    await assert.rejects(
      resolveExplicit({importer,specifier:"./alias/secret",projectRoot:project}),
      /nested package boundary/
    );
  });
});

test("malformed nested package marker still claims authority",async()=>{
  await withSandbox(async base=>{
    const project=join(base,"project");
    const child=join(project,"src","child");
    await mkdir(child,{recursive:true});
    const importer=join(project,"src","main.ores");
    await writeFile(importer,"x");
    await writeFile(join(child,LEGACY_PACKAGE_MARKER),"this is not valid toml = [\n");
    await writeFile(join(child,"secret.ores"),"x");
    await assert.rejects(
      resolveExplicit({importer,specifier:"./child/secret",projectRoot:project}),
      /nested package boundary/
    );
  });
});

test("dangling nested package marker still claims authority",async t=>{
  await withSandbox(async base=>{
    const project=join(base,"project");
    const child=join(project,"src","child");
    await mkdir(child,{recursive:true});
    const importer=join(project,"src","main.ores");
    await writeFile(importer,"x");
    if(!await symlinkOrSkip(
      t,
      join(child,"missing-manifest.toml"),
      join(child,LEGACY_PACKAGE_MARKER)
    )) return;
    await writeFile(join(child,"secret.ores"),"x");
    await assert.rejects(
      resolveExplicit({importer,specifier:"./child/secret",projectRoot:project}),
      /nested package boundary/
    );
  });
});
