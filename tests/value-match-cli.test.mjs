import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const cli=fileURLToPath(new URL("../bin/value-match-evidence.mjs",import.meta.url));
const sha="012345678901234567890123456789abcdefabcd";
const base=["--backend=java-graalvm","--source-sha="+sha,
  "--check-argv="+JSON.stringify(["/no/such/oreslang-check","{file}"]),
  "--run-argv="+JSON.stringify(["/no/such/oreslang-run","{file}"])];
function call(args){return spawnSync(process.execPath,[cli,...args],{encoding:"utf8",timeout:15000})}
test("missing real backend commands always fails closed",()=>{
 const r=call(base);
 assert.equal(r.status,2);
 assert.match(r.stderr,/ENOENT|no such file/i);
 assert.doesNotMatch(r.stdout,/"ok":\s*true/);
});
test("CLI requires source revision and both real backend commands",()=>{
 for(const args of [[],["--backend=java-graalvm"],base.filter(x=>!x.startsWith("--run-argv=")),
   base.filter(x=>!x.startsWith("--check-argv="))]){
  const r=call(args);assert.equal(r.status,2);assert.match(r.stderr,/required/);
 }
});
test("CLI rejects duplicate, unknown, malformed JSON and injected placeholders",()=>{
 for(const suffix of [["--backend=llvm"],["--unknown=1"],
   ["--check-argv=not-json"],
   ["--run-argv="+JSON.stringify(["/bin/echo","file={file}"])]]){
  const r=call([...base,...suffix]);assert.equal(r.status,2);
  assert.doesNotMatch(r.stdout,/"ok":\s*true/);
 }
});
test("invalid source SHA cannot be mistaken for executed compiler evidence",()=>{
 const r=call(base.map(x=>x.startsWith("--source-sha=")?"--source-sha=not-a-commit":x));
 assert.equal(r.status,2);
 assert.match(r.stderr,/source SHA/);
});
