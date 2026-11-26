// Host test isolation, not guest sandbox or a language termination proof.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
const driver=String.raw`
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const [kind,want]=process.argv.slice(1);
const bytes=readFileSync(0);
let value;
if(kind==="wasm"){
 const module=new WebAssembly.Module(bytes);
 assert.deepEqual(WebAssembly.Module.imports(module),[]);
 const guest=new WebAssembly.Instance(module,{});
 assert.equal(guest.exports.panic_code.value,0);
 value=guest.exports.main();
 assert.equal(guest.exports.panic_code.value,0);
}else{
 const guest=await import("data:text/javascript;base64,"+bytes.toString("base64"));
 value=guest.main();
}
assert.equal(value,BigInt(want));
process.stdout.write("STRICT_GUEST_OK "+value.toString()+"\n");
`;
export function runStrictGuest(artifact,kind,decimal,id,timeout=10000){
 assert.ok(kind==="js"||kind==="wasm");
 assert.match(decimal,/^(0|-?[1-9][0-9]*)$/);
 const r=spawnSync(process.execPath,["--input-type=module","-e",driver,kind,decimal],{
  input:Buffer.from(artifact),encoding:"utf8",timeout,killSignal:"SIGKILL",maxBuffer:1024*1024
 });
 if(r.error)throw new Error(id+": guest process "+(r.error.code??r.error.message),{cause:r.error});
 assert.equal(r.signal,null,id+": guest signal "+r.signal);
 assert.equal(r.status,0,id+": "+r.stderr);
 assert.equal(r.stderr,"",id+": unexpected guest stderr");
 assert.equal(r.stdout,"STRICT_GUEST_OK "+decimal+"\n",id+": unexpected guest stdout");
}
