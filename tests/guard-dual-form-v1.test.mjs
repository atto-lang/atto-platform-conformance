import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, lstatSync, realpathSync} from "node:fs";
import {resolve, join, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "contracts/guard-dual-form-v1.json"), "utf8"));
const gitBlob = bytes => createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
const pin = /^[a-f0-9]{40}$/;
const validKinds = new Set(["NATIVE_GUEST_RETURN", "TYPECHECK_ACCEPT", "COMPILE_REJECT_NO_IR"]);
const knownIds = new Set([
  "brace-continue", "keyword-continue", "brace-failure", "keyword-failure",
  "option-brace", "option-keyword", "keyword-nested-outer-else",
  "reject-keyword-fallthrough", "reject-mixed-delimiters", "reject-missing-end",
  "reject-brace-break", "reject-keyword-break",
  "reject-brace-continue", "reject-keyword-continue",
  "reject-brace-throw", "reject-keyword-throw",
  "guard-void-keyword-false", "guard-void-brace-false",
  "guard-void-keyword-true", "guard-void-brace-true",
  "reject-guard-void-nonvoid-keyword", "reject-guard-void-nonvoid-brace",
  "guard-brace-nested-outer-else"
]);

function assertManifest(m) {
  assert.equal(m.schema, "attolang.guard.dual-form.v1");
  assert.equal(m.status, "SOURCE_CONTRACT_NOT_BACKEND_EXECUTION");
  assert.deepEqual(m.receipts, []);
  assert.deepEqual(Object.keys(m.backends).sort(),
    ["cranelift","forge","hdl","java","js","llvm","net","rs","wasm"]);
  for (const s of Object.values(m.backends)) assert.equal(s, "NOT_EXECUTED");
  assert.equal(m.return_contract.true_path, "continue after guard");
  assert.equal(m.return_contract.false_path,
    "execute failure block; every path must explicitly return from enclosing function");
  assert.deepEqual(m.return_contract.disallowed_substitutes,
    ["throw","raise","panic","break","continue"]);
  assert.equal(m.fixtures.length, knownIds.size);
  const ids = new Set();
  for (const f of m.fixtures) {
    assert.ok(knownIds.has(f.id) && !ids.has(f.id), "known unique fixture id");
    ids.add(f.id);
    assert.ok(validKinds.has(f.kind));
    assert.match(f.git_blob, pin);
    assert.match(f.path, /^fixtures\/guard-dual-form-v1\/[a-z0-9-]+\.atto$/);
    const abs = resolve(root, f.path);
    assert.ok(abs.startsWith(root + sep) && !lstatSync(abs).isSymbolicLink());
    assert.equal(realpathSync(abs), abs, "no symlinked path");
    assert.equal(gitBlob(readFileSync(abs)), f.git_blob, f.id + " exact source blob");
    if (f.kind === "NATIVE_GUEST_RETURN") assert.ok([0,42].includes(f.expected_integer));
    if (f.kind === "COMPILE_REJECT_NO_IR") assert.equal(f.expected_integer, undefined);
  }
}

test("all dual-guard fixtures have verified Git blob pins but NO execution receipts", () => assertManifest(manifest));

test("manifest cannot claim guest parity through a source-only validator", () => {
  for (const bad of [
    {...manifest, status:"VERIFIED"},
    {...manifest, receipts:[{conclusion:"success"}]},
    {...manifest, backends:{...manifest.backends, llvm:"PASS"}},
    {...manifest, fixtures:manifest.fixtures.slice(1)},
    {...manifest, fixtures:manifest.fixtures.map((f,i)=>i===0?{...f,git_blob:"0".repeat(40)}:f)},
  ]) assert.throws(()=>assertManifest(bad));
});

test("brace and keyword forms pin matching true/false outcomes and Option signature", () => {
  const byId = Object.fromEntries(manifest.fixtures.map(f => [f.id,f]));
  for (const [brace,keyword,expected] of [
    ["brace-continue","keyword-continue",42],
    ["brace-failure","keyword-failure",0],
  ]) {
    assert.equal(byId[brace].expected_integer, expected);
    assert.equal(byId[keyword].expected_integer, expected);
    const a=readFileSync(join(root,byId[brace].path),"utf8");
    const b=readFileSync(join(root,byId[keyword].path),"utf8");
    assert.match(a,/guard (true|false) \{ return 0; \}/);
    assert.match(b,/guard (true|false) else[\s\S]*?return 0;[\s\S]*?end/);
  }
  for (const id of ["option-brace","option-keyword"]) {
    const s=readFileSync(join(root,byId[id].path),"utf8");
    assert.match(s,/fnc optional_port\(bool present\): Option<int>/);
    assert.match(s,/return None;/);
    assert.match(s,/return Some\(8080\);/);
  }
});

test("keyword parse-boundary negative fixtures remain compile-reject targets", () => {
  const byId=Object.fromEntries(manifest.fixtures.map(f=>[f.id,f]));
  for (const id of ["reject-keyword-fallthrough","reject-mixed-delimiters","reject-missing-end"])
    assert.equal(byId[id].kind,"COMPILE_REJECT_NO_IR");
  const nested=readFileSync(join(root,byId["keyword-nested-outer-else"].path),"utf8");
  assert.match(nested,/guard true else[\s\S]*?end[\s\S]*?else[\s\S]*?fi/);
});

test("both guard spellings reject escape-only failure blocks", () => {
  const byId=Object.fromEntries(manifest.fixtures.map(f=>[f.id,f]));
  for (const exit of ["break","continue","throw"]) {
    for (const style of ["brace","keyword"]) {
      const id=`reject-${style}-${exit}`;
      const fixture=byId[id];
      assert.equal(fixture.kind,"COMPILE_REJECT_NO_IR");
      assert.equal(fixture.style,style);
      const source=readFileSync(join(root,fixture.path),"utf8");
      assert.match(source,/guard false/);
      assert.match(source,new RegExp("\\b"+exit+"\\b"));
      if(style==="keyword") assert.match(source,/else[\s\S]*?end/);
      else assert.match(source,/guard false \{/);
    }
  }
});


test("explicit ^ void is a portable valueless guard return in both styles", () => {
  const byId=Object.fromEntries(manifest.fixtures.map(f=>[f.id,f]));
  for (const predicate of ["false","true"]) {
    for (const style of ["keyword","brace"]) {
      const id="guard-void-"+style+"-"+predicate;
      const f=byId[id];
      assert.equal(f.kind,"NATIVE_GUEST_RETURN");
      assert.equal(f.expected_integer,42);
      assert.equal(f.style,style);
      const source=readFileSync(join(root,f.path),"utf8");
      assert.match(source,/fnc process_explicit\(\) -> void/);
      if(style==="keyword") assert.ok(source.includes("guard "+predicate+" else ^ void end\nend"));
      else assert.ok(source.includes("guard "+predicate+" { ^ void }\nend"));
      assert.match(source,/pub fnc main\(\): int/);
    }
  }
  for (const style of ["keyword","brace"]) {
    const id="reject-guard-void-nonvoid-"+style;
    const f=byId[id];
    assert.equal(f.kind,"COMPILE_REJECT_NO_IR");
    const source=readFileSync(join(root,f.path),"utf8");
    assert.match(source,/fnc process_explicit\(\) -> int/);
    assert.match(source,/\^ void/);
  }
  const outer=byId["guard-brace-nested-outer-else"];
  assert.equal(outer.expected_integer,42);
  assert.equal(outer.style,"brace");
  const source=readFileSync(join(root,outer.path),"utf8");
  assert.match(source,/if true then[\s\S]*guard true \{ return 7; \}[\s\S]*else[\s\S]*fi/);
  assert.equal(manifest.authored_execution_gates.rs.expected_real_wasm_guest_cases,12);
  assert.equal(manifest.authored_execution_gates.rs.expected_no_artifact_reject_cases,12);
});
