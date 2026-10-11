import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("paired CLI enforces the committed fixture manifest rather than report-only symmetry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oreslang-paired-"));
  try {
    const manifest = JSON.parse(await readFile(join(root, "fixtures/manifest.json"), "utf8"));
    const rows = await Promise.all(manifest.cases.map(async c => ({
      id: c.id,
      status: "VERIFIED",
      fixtureSha256: sha256(await readFile(join(root, "fixtures", c.file))),
    })));
    function report(backend) {
      return {backend,configured:true,ok:true,failed:0,skipped:0,
        verified:rows.length,declaredSourceSha:"a".repeat(40),
        executableSha256:"b".repeat(64),
        results:rows.map(row=>({...row}))};
    }
    const java=join(dir,"java.json"),llvm=join(dir,"llvm.json");
    const cmd=()=>spawnSync(process.execPath,[join(root,"bin/verify-paired.mjs"),java,llvm],{encoding:"utf8"});
    await writeFile(java,JSON.stringify(report("java")));
    await writeFile(llvm,JSON.stringify(report("llvm")));
    let done=cmd();
    assert.equal(done.status,0,done.stderr);
    assert.equal(JSON.parse(done.stdout).certifiesRuntimeParity,false);

    const incomplete=report("llvm");
    incomplete.results.pop();
    incomplete.verified--;
    await writeFile(llvm,JSON.stringify(incomplete));
    done=cmd();
    assert.notEqual(done.status,0);
    assert.match(done.stderr,/rejected/);

    const corrupt=report("llvm");
    corrupt.results[0].fixtureSha256="f".repeat(64);
    await writeFile(llvm,JSON.stringify(corrupt));
    done=cmd();
    assert.notEqual(done.status,0);
    assert.match(done.stderr,/manifest/);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
