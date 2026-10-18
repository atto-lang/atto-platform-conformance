#!/usr/bin/env node
import {readFileSync, lstatSync, realpathSync, readdirSync, existsSync} from "node:fs";
import {resolve, join, sep} from "node:path";
import {execFileSync} from "node:child_process";
import {validateRegistry,validateMember} from "../src/ecosystem-contract.mjs";

function git(dir, args) {
  return execFileSync("git",args,{cwd:dir,encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"],maxBuffer:256*1024}).trim();
}
export function inspectCheckouts(registry, parent, {allowMissing=false}={}) {
  validateRegistry(registry);
  const base=realpathSync(resolve(parent));
  if(!lstatSync(base).isDirectory()) throw new Error("root must be a directory");
  const seen=new Set(), checked=[], missing=[];
  const members=new Set(registry.repositories.map(r=>r.name));
  // Unknown checkout siblings are ignored: the parent may contain unrelated workspaces.
  for(const row of registry.repositories) {
    const dir=join(base,row.name);
    if(!existsSync(dir)) {missing.push(row.name);continue;}
    const st=lstatSync(dir);
    if(!st.isDirectory() || st.isSymbolicLink() || realpathSync(dir)!==dir) throw new Error("non-directory or linked checkout: "+row.name);
    const manifestPath=join(dir,".oreslang","integration.json");
    if(!existsSync(manifestPath)) throw new Error("missing integration contract: "+row.name);
    const fst=lstatSync(manifestPath);
    if(!fst.isFile() || fst.isSymbolicLink() || fst.size>65536) throw new Error("unsafe member manifest: "+row.name);
    const member=JSON.parse(readFileSync(manifestPath,"utf8"));
    validateMember(registry,member);
    const top=realpathSync(git(dir,["rev-parse","--show-toplevel"]));
    if(top!==dir) throw new Error("not an independent git checkout: "+row.name);
    const commit=git(dir,["rev-parse","HEAD"]);
    const tree=git(dir,["rev-parse","HEAD^{tree}"]);
    if(!/^[0-9a-f]{40,64}$/.test(commit) || !/^[0-9a-f]{40,64}$/.test(tree)) throw new Error("invalid git object ID: "+row.name);
    if(git(dir,["status","--porcelain","--untracked-files=all"])) throw new Error("dirty worktree: "+row.name);
    seen.add(row.name);
    checked.push({repository:member.repository,commit,tree,evidence:"metadata-only"});
  }
  if(missing.length&&!allowMissing) throw new Error("missing checkouts: "+missing.join(", "));
  if(checked.length===0) throw new Error("no checked member checkouts");
  return {schemaVersion:1,kind:"oreslang-checkout-coordination-receipt",evidence:"metadata-only",checked,missing};
}
if(process.argv[1] && /audit-member-checkouts\.mjs$/.test(process.argv[1])) {
  const args=process.argv.slice(2);
  const allowed=args.length===1 || (args.length===2 && args[1]==="--allow-missing");
  if(!allowed){console.error("usage: node bin/audit-member-checkouts.mjs ROOT [--allow-missing]");process.exit(2);}
  try{
    const reg=JSON.parse(readFileSync(new URL("../integration/repositories.json",import.meta.url),"utf8"));
    console.log(JSON.stringify(inspectCheckouts(reg,args[0],{allowMissing:args.length===2}),null,2));
  }catch(e){console.error(String(e));process.exitCode=1;}
}
