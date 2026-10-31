import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {resolve, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

// Source-local static gate. This is defense-in-depth, NOT a substitute for
// GitHub permissions, independent incident dispositions or per-snapshot review.
// It searches the executable CLI/tool/workflow surfaces of THIS repository.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const approvedPublisher = "bin/private-mirror-publish.mjs";
const extensions = /\.(?:js|mjs|cjs|sh|yml|yaml)$/i;

function sourceFiles(dir, list=[]) {
  for (const entry of readdirSync(dir, {withFileTypes:true})) {
    if (entry.isSymbolicLink()) throw Error("unreviewed executable symlink in CI audit");
    const full = join(dir,entry.name);
    if (entry.isDirectory()) sourceFiles(full,list);
    else if (entry.isFile() && extensions.test(entry.name)) list.push(full);
  }
  return list;
}
function suspiciousWrites(src) {
  return /\bgit\s+(?:-C\s+\S+\s+)?push\b/i.test(src) ||
    /\b(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*["']git["']\s*,\s*\[\s*["']push["']/i.test(src) ||
    /\bgh\s+api\b/i.test(src) ||
    /\/git\/(?:blobs|trees|commits|refs)\b/i.test(src) ||
    (/\b(?:POST|PATCH|PUT|DELETE)\b/.test(src) &&
     /api\.github\.com|github\.com\/[^\s]+\.git/.test(src));
}
function audit(path, src) {
  if (path === approvedPublisher) {
    // Requiring the module name alone would not be enough to certify the
    // implementation, but a missing guard is a mandatory review failure.
    assert.match(src,/from\s+["']\.\/require-private-mirror\.mjs["']/);
    assert.match(src,/await\s+authorize\(\)/);
    assert.match(src,/const\s+authorize\s*=\s*\(\)\s*=>\s*requirePrivateMirror/);
    assert.ok(src.indexOf("await authorize();") >= 0 &&
      src.indexOf("await authorize();") < src.indexOf("const srcCommit=await githubRequest("),
      "publisher must authorize BEFORE fetching the private source commit");
    return;
  }
  assert.equal(suspiciousWrites(src),false,
    "unreviewed direct GitHub source-copy/write entrypoint: "+path);
}

test("only the guarded source publisher may own Git object/ref write surfaces",()=>{
  let visited=0;
  for (const subdir of ["bin","tools",".github/workflows"]) {
    for (const file of sourceFiles(join(root,subdir))) {
      audit(relative(root,file).replaceAll("\\","/"),readFileSync(file,"utf8"));
      visited++;
    }
  }
  assert.ok(visited>=30,"executable surface enumeration unexpectedly shrunk");
});

test("static admission gate rejects direct Git pushes and GitHub object API bypasses",()=>{
  for (const code of [
    "git push --force https://github.com/other/repo.git HEAD:refs/heads/a",
    "git -C /tmp/checkout push origin HEAD:refs/heads/ci-export",
    "execFileSync('git',['push','origin','HEAD:refs/heads/ci-export'])",
    "gh api repos/other/repo/git/refs --method POST -f ref=refs/heads/test",
    'fetch("https://api.github.com/repos/x/y/git/blobs",{method:"POST"})',
    'const resource="/git/trees"; transfer(resource);'
  ]) {
    assert.throws(()=>audit("bin/unreviewed-publisher.mjs",code),
      /unreviewed direct GitHub/);
  }
});

test("publisher guard cannot silently lose its shared authorization import",()=>{
  assert.throws(()=>audit(approvedPublisher,
    'await publish(); const endpoint="/git/blobs";'),
    /require-private-mirror/);
});
