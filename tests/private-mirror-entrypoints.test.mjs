import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {resolve, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

// Source-local, source-free static security audit. It does not authorize
// private transfers or replace exact-head executed CI and independent review.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensions = /\.(?:js|mjs|cjs|sh|yml|yaml)$/i;
const DISABLED = "PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL";
const disabledEntrypoints = new Map([
  ["bin/require-private-mirror.mjs", "requirePrivateMirror"],
  ["bin/private-mirror-publish.mjs", "publishPrivateMirror"]
]);

function sourceFiles(dir, result=[]) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    if(entry.isSymbolicLink()) throw Error("unreviewed executable symlink in CI audit");
    const full=join(dir,entry.name);
    if(entry.isDirectory()) sourceFiles(full,result);
    else if(entry.isFile()&&extensions.test(entry.name)) result.push(full);
  }
  return result;
}

function suspiciousWrites(src) {
  return /\bgit\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+)*push\b/i.test(src) ||
    /\b(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*["']git["']\s*,\s*\[\s*["']push["']/i.test(src) ||
    /\bgh\s+api\b/i.test(src) ||
    /\/git\/(?:blobs|trees|commits|refs)\b/i.test(src) ||
    (/\b(?:POST|PATCH|PUT|DELETE)\b/.test(src) &&
     /api\.github\.com|github\.com\/[^\s]+\.git/.test(src));
}

function lockedExport(src,name) {
  const sig=new RegExp("export\\s+async\\s+function\\s+"+name+
    "\\s*\\(\\{[\\s\\S]*?\\}\\)\\s*\\{");
  const match=sig.exec(src);
  assert.ok(match,"required exported deny-only function absent: "+name);
  const body=src.slice(match.index+match[0].length);
  const first=body.replace(/^\s*(?:\/\/[^\n]*\n\s*)*/,"");
  assert.ok(first.startsWith('throw Error("'+DISABLED+'");'),
    name+" must deny as its FIRST executable statement");
}

function audit(path,src) {
  if(disabledEntrypoints.has(path)) lockedExport(src,disabledEntrypoints.get(path));
  // No module gets an exception, even a previously approved publisher.
  assert.equal(suspiciousWrites(src),false,
    "unreviewed direct GitHub source-copy/write entrypoint: "+path);
}

test("all executable surfaces have zero direct Git object publishers",()=>{
  let visited=0,disabled=0;
  for(const subdir of ["bin","tools",".github/workflows"]) {
    for(const file of sourceFiles(join(root,subdir))) {
      const path=relative(root,file).replaceAll("\\","/");
      audit(path,readFileSync(file,"utf8"));
      if(disabledEntrypoints.has(path)) disabled++;
      visited++;
    }
  }
  assert.equal(disabled,2,"both legacy publisher surfaces must be scanned");
  assert.ok(visited>=30,"executable surface enumeration unexpectedly shrunk");
});

test("any direct Git push or Git-object API write fails, regardless of filename",()=>{
  for(const code of [
    "git push --force origin HEAD",
    "git -C /tmp/checkout push origin HEAD",
    "git -c core.hooksPath=/tmp/hooks push origin HEAD",
    "git --git-dir /tmp/a.git push origin main",
    "git --work-tree /tmp/private -C /tmp/private push origin main",
    "spawn('git',['push','origin','main'])",
    "spawnSync('git',['push','upstream','HEAD'])",
    "execFileSync('git',['push','origin','HEAD'])",
    "gh api repos/other/repo/git/refs --method POST",
    'fetch("https://api.github.com/repos/a/b/git/blobs",{method:"POST"})',
    'const endpoint="/git/trees"; transfer(endpoint);',
    'const endpoint="/git/commits"; fetch(endpoint,{method:"POST"})'
  ]) {
    assert.throws(()=>audit("tools/unreviewed-transfer.mjs",code),
      /unreviewed direct GitHub/);
  }
});

test("old publisher's name no longer grants a Git-write exemption",()=>{
  const disabledSource=readFileSync(new URL("../bin/private-mirror-publish.mjs",import.meta.url),"utf8");
  audit("bin/private-mirror-publish.mjs",disabledSource);
  assert.throws(()=>audit("bin/private-mirror-publish.mjs",
    disabledSource+'\nfetch("https://api.github.com/repos/a/b/git/blobs",{method:"POST"});'),
    /unreviewed direct GitHub/);
});

test("both public module APIs must reject before any executable logic",()=>{
  for(const [path,name] of disabledEntrypoints) {
    const src=readFileSync(join(root,path),"utf8");
    lockedExport(src,name);
    assert.doesNotMatch(src,/\/git\/(?:blobs|trees|commits|refs)/,
      "retired Git object copy machinery must not reappear");
    assert.doesNotMatch(src,/https:\/\/api\.github\.com/,
      "retired private repository API requests must not reappear");
  }
});

test("an empty or moved denial no longer satisfies the control",()=>{
  for(const [path,name] of disabledEntrypoints) {
    const src=readFileSync(join(root,path),"utf8");
    assert.throws(()=>lockedExport(src.replace(
      'throw Error("'+DISABLED+'");',
      'return {status:"PRIVATE_MIRROR_APPROVED"};'
    ),name),/FIRST executable statement/);
    assert.throws(()=>lockedExport(src.replace(
      'throw Error("'+DISABLED+'");',
      'const shouldNeverRun = true;\n  throw Error("'+DISABLED+'");'
    ),name),/FIRST executable statement/);
  }
});
