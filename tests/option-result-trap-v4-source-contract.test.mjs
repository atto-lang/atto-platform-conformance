import test from "node:test";
import assert from "node:assert/strict";
import {join,resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {readPinnedRegular} from "../bin/verify-option-result-trap-receipt.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const prefix="fixtures/option-result-trap/v4/";
const guest=/pub fnc main\(\): (?:int|void)\s*\{/;
const contracts=new Map([
 ["trap_ok",[/trap fnc checked\(\): Result<int,\s*String>/,/return Ok\(42\)/,
   /Option<Result<int,\s*String>> outer = checked\(\)/,/inner\.unwrap\(\)\s*-\s*42/]],
 ["trap_err",[/trap fnc checked\(\): Result<int,\s*String>/,/return Err\("typed-error"\)/,
   /outer\.is_none\(\)/,/inner\.is_ok\(\)/,/inner\.unwrap_or\(19\)\s*==\s*19/]],
 ["trap_throw_none",[/trap fnc checked\(Animal animal\): Result<int,\s*String>/,
   /animal as Dog/,/checked\(new Cat\(\)\)/,/outer\.is_none\(\)/]],
 ["trap_nested_none",[/trap fnc checked\(\): Option<Result<int,\s*String>>/,
   /return None;/,/Option<Option<Result<int,\s*String>>> outer/,/inner\.is_none\(\)/]],
 ["trap_ok_none",[/trap fnc checked\(\): Result<Option<int>,\s*String>/,
   /return Ok\(None\)/,/Option<Result<Option<int>,\s*String>> outer/,
   /value\.is_none\(\)/]],
 ["trap_expr_err",[/fnc checked\(\): Result<int,\s*String>/,
   /Option<Result<int,\s*String>> outer = trap checked\(\)/,/outer\.unwrap\(\)\.is_err\(\)/]],
 ["trap_expr_nested",[/trap fnc checked\(\): Result<int,\s*String>/,
   /Option<Option<Result<int,\s*String>>> outer = trap checked\(\)/,
   /inside\.unwrap\(\)\.is_err\(\)/]],
 ["trap_panic_bypass",[/trap fnc checked\(\): Result<int,\s*String>/,
   /return Err\("typed-error"\)|failure = Err\("typed-error"\)/,
   /failure\.unwrap\(\)/,/UNREACHABLE-ORT4/]],
 ["negative/call_no_implicit_result",[/trap fnc checked\(\): Result<int,\s*String>/,
   /Result<int,\s*String> wrong = checked\(\)/]],
 ["negative/expr_no_implicit_result",[/fnc checked\(\): Result<int,\s*String>/,
   /Result<int,\s*String> wrong = trap checked\(\)/]],
 ["negative/nested_no_flatten",[/trap fnc checked\(\): Result<int,\s*String>/,
   /Option<Result<int,\s*String>> wrong = trap checked\(\)/]]
]);
const stripComments=s=>s.replace(/\/\/[^\r\n]*/g,"").replace(/\/\*[\s\S]*?\*\//g,"");
function inspect(name,source){
 const anchors=contracts.get(name);
 assert(anchors,name);
 const body=stripComments(source);
 for(const anchor of anchors)assert.match(body,anchor,name+" lost independent source anchor "+anchor);
 if(!name.startsWith("negative/"))assert.match(body,guest);
 if(name==="trap_panic_bypass")assert.match(body,/failure\.unwrap\(\)/);
 else if(!name.startsWith("negative/"))assert.match(body,/return 0;|return inner\.unwrap\(\)\s*-\s*42/);
}
test("ORT4 independent semantic anchors survive outside identifying comments",()=>{
 for(const name of contracts.keys()){
  const relative=prefix+name+".ores",full=resolve(root,relative);
  assert(full.startsWith(root+sep));
  inspect(name,readPinnedRegular(full).toString("utf8"));
 }
});
test("ORT4 mutation: changed code cannot hide behind an unchanged case-ID comment",()=>{
 const cases=[
  ["trap_ok",s=>s.replace("return Ok(42);","return Err(\"wrong\");")],
  ["trap_err",s=>s.replace("return Err(\"typed-error\");","return Ok(42);")],
  ["trap_throw_none",s=>s.replace("animal as Dog","animal")],
  ["trap_nested_none",s=>s.replace("return None;","return Some(Ok(42));")],
  ["trap_ok_none",s=>s.replace("return Ok(None);","return Ok(Some(42));")],
  ["trap_expr_err",s=>s.replace("outer = trap checked()","outer = checked()")],
  ["trap_expr_nested",s=>s.replace("outer = trap checked()","outer = checked()")],
  ["trap_panic_bypass",s=>s.replace("failure.unwrap()","failure.unwrap_or(0)")],
  ["negative/call_no_implicit_result",s=>s.replace("wrong = checked()","wrong = trap checked()")],
  ["negative/expr_no_implicit_result",s=>s.replace("wrong = trap checked()","wrong = checked()")],
  ["negative/nested_no_flatten",s=>s.replace("wrong = trap checked()","wrong = checked()")]
 ];
 for(const [name,mutate] of cases){
  const bytes=readPinnedRegular(join(root,prefix,name+".ores")).toString("utf8");
  const modified=mutate(bytes);
  assert.notEqual(modified,bytes);
  assert(modified.includes("ORT4-"+name.replaceAll("/","_").toUpperCase()));
  assert.throws(()=>inspect(name,modified),name);
 }
});
