import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const ledger=JSON.parse(readFileSync(fileURLToPath(
 new URL("../evidence/atto-core-numeric-stage2-20261107.json",import.meta.url))));
const MASK=(1n<<64n)-1n,SPAN=1n<<64n,MAX=(1n<<63n)-1n;
const EDGES=[-(1n<<63n),-(1n<<63n)+1n,-43n,-1n,0n,1n,42n,MAX-1n,MAX];
function checksum(mode) {
 let state=0x6a09e667f3bcc909n;
 const next=()=>{
  let z=state=(state+0x9e3779b97f4a7c15n)&MASK;
  z=((z^(z>>30n))*0xbf58476d1ce4e5b9n)&MASK;
  z=((z^(z>>27n))*0x94d049bb133111ebn)&MASK;
  return (z^(z>>31n))&MASK;
 };
 const signed=x=>x>MAX?x-SPAN:x;
 let digest=14695981039346656037n;
 for(let i=0;i<10000;i++){
  let a,b,c;
  if(i<EDGES.length**3){
   a=EDGES[Math.floor(i/81)%9];
   b=EDGES[Math.floor(i/9)%9];
   c=EDGES[i%9];
  } else {
   a=signed(next()); b=signed(next()); c=signed(next());
  }
  const result=mode==="min_int"?(a<b?a:b):
   mode==="max_int"?(a>b?a:b):
   b>c?b:(a<b?b:(a>c?c:a));
  digest=((digest^(result&MASK))*1099511628211n)&MASK;
 }
 return digest.toString(16).padStart(16,"0");
}
test("portable numeric 30000-case independent reference generator matches expected digests",()=>{
 const protocol=ledger.differential_protocol;
 assert.deepEqual(protocol.operations,["min_int","max_int","clamp_int"]);
 assert.equal(protocol.count_per_operation,10000);
 assert.equal(protocol.edge_cartesian_cases,729);
 assert.equal(protocol.edge_count,EDGES.length);
 assert.equal(ledger.guest_status,"NOT_EXECUTED");
 for(const mode of protocol.operations)
  assert.equal(checksum(mode),protocol.expected[mode],mode+" checksum drift");
});
test("reference digests are mode-separated and forged checksum mutation is detectable",()=>{
 const values=ledger.differential_protocol.operations.map(checksum);
 assert.equal(new Set(values).size,3);
 for(const val of values){
  const corrupt=val.slice(0,15)+(val[15]==="0"?"1":"0");
  assert.ok(!values.includes(corrupt),"forged checksum unexpectedly matches");
 }
 assert.equal(ledger.differential_protocol.verification,
  "REFERENCE_ONLY_DOES_NOT_PROVE_BACKEND_EXECUTION");
});
