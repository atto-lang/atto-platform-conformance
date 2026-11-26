// Host test isolation, not guest sandbox or a language termination proof.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
const driver=String.raw`
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createContext,SourceTextModule} from "node:vm";
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
 // The emitted strict module must be closed and synchronous. Do not expose
 // process, require, filesystem, host callbacks or the receipt writer.
 // This is oracle isolation, not a hostile-code security sandbox.
 const context=createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
 // Console output is not part of this strict ABI; deny it inside the context.
 const guard=new SourceTextModule('globalThis.console=Object.freeze({log(){throw Error("unexpected guest stdout")},error(){throw Error("unexpected guest stderr")},warn(){throw Error("unexpected guest stderr")}});',{context});
 await guard.link(()=>{throw Error("static import denied");});await guard.evaluate();
 const guest=new SourceTextModule(new TextDecoder("utf-8",{fatal:true}).decode(bytes),{context,
  importModuleDynamically:()=>{throw Error("dynamic import denied");}});
 await guest.link(()=>{throw Error("static import denied");});
 await guest.evaluate();
 assert.equal(typeof guest.namespace.main,"function");
 value=guest.namespace.main();
}
assert.equal(value,BigInt(want));
process.stdout.write("STRICT_GUEST_OK "+value.toString()+"\n");
`;
export function runStrictGuest(artifact,kind,decimal,id,timeout=10000){
 assert.ok(kind==="js"||kind==="wasm");
 assert.match(decimal,/^(0|-?[1-9][0-9]*)$/);
 assert.ok(BigInt(decimal)>=-(1n<<63n)&&BigInt(decimal)<(1n<<63n),"i64 result range");
 assert.ok(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=60000,"bounded timeout");
 const input=Buffer.from(artifact);
 assert.ok(input.length>0&&input.length<=16*1024*1024,"bounded guest artifact");
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 const r=spawnSync(process.execPath,["--experimental-vm-modules","--disable-warning=ExperimentalWarning","--input-type=module","-e",driver,kind,decimal],{
  input,env,encoding:"utf8",timeout,killSignal:"SIGKILL",maxBuffer:1024*1024
 });
 if(r.error)throw new Error(id+": guest process "+(r.error.code??r.error.message),{cause:r.error});
 assert.equal(r.signal,null,id+": guest signal "+r.signal);
 assert.equal(r.status,0,id+": "+r.stderr);
 assert.equal(r.stderr,"",id+": unexpected guest stderr");
 assert.equal(r.stdout,"STRICT_GUEST_OK "+decimal+"\n",id+": unexpected guest stdout");
}
