// Source-free M0 policy oracle. Does NOT implement an MCP server, transport parser or guest execution.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const contract=JSON.parse(readFileSync(new URL("../contracts/mcp-dev-control-m0-v1.json",import.meta.url),"utf8"));
const schema=JSON.parse(readFileSync(new URL("../schemas/mcp-dev-control-m0-v1.schema.json",import.meta.url),"utf8"));
const allowed=new Set(contract.methods.allowed);
const resources=new Set(contract.resources);
const budgets=contract.budgets;
const scopeFor=s=>s==="upgrade/status"?"inspect:upgrade_status":s==="process/summary"?"inspect:summary":"inspect:metrics";
function admit({enabled=true,authenticated=true,principal,request,now=100000,seen=new Set(),inflight=0,perSecond=0,perMinute=0,audit=true,bytes=100,depth=4,responseBytes=100,hostBootId="boot",activeIds=new Set(),cancelled=false,disconnected=false,elapsedMs=0}){
  const deny=reason=>({ok:false,reason});
  if(!enabled)return deny("DISABLED");
  if(!authenticated||!principal)return deny("UNAUTHENTICATED");
  if(!audit)return deny("AUDIT_FAILURE");
  if(cancelled||disconnected||elapsedMs>budgets.deadlineMs)return deny("TIMEOUT");
  if(bytes>budgets.maxFrameBytes||depth>budgets.maxJsonDepth||responseBytes>budgets.maxResponseBytes)return deny("OVERFLOW");
  if(inflight>=budgets.maxInflight||perSecond>=budgets.maxRequestsPerSecond||perMinute>=budgets.maxRequestsPerMinute||seen.size>=budgets.maxReplayNonces)return deny("QUOTA");
  if(!allowed.has(request.method))return deny("UNSUPPORTED");
  if(!(typeof request.id==="string" && request.id.length>0 && request.id.length<=64) && !(Number.isSafeInteger(request.id) && request.id>=0))return deny("MALFORMED");
  if(activeIds.has(request.id))return deny("DUPLICATE_ID");
  const s=request.security;
  if(!s||s.schema_version!==contract.schema||request.protocolVersion!==contract.protocolVersion)return deny("VERSION");
  if(!/^[0-9a-f]{32,64}$/.test(s.nonce)||Math.abs(now-s.issued_at_ms)>budgets.clockSkewMs)return deny("MALFORMED");
  if(seen.has(principal.boot_id+":"+principal.principal_id+":"+s.nonce))return deny("REPLAY");
  if(principal.expires_at_ms<=now)return deny("UNAUTHENTICATED");
  if(principal.boot_id!==hostBootId||principal.generation!==s.expected_generation)return deny("GENERATION");
  if(principal.runtime_id!==s.runtime_id)return deny("RUNTIME");
  if(principal.tenant_id!==s.tenant_id)return deny("TENANT");
  const need=request.method==="resources/read"?null:"inspect:catalog";
  if(need&&!principal.scopes.includes(need))return deny("SCOPE");
  if(request.method==="resources/read"){
    const match=/^atto-dev:\/\/runtime\/([A-Za-z0-9_.-]{1,128})\/tenant\/([A-Za-z0-9_.-]{1,128})\/(.+)$/.exec(request.uri||"");
    if(!match||!resources.has(match[3])||[".",".."].includes(match[1])||[".",".."].includes(match[2]))return deny("MALFORMED");
    if(match[1]!==principal.runtime_id)return deny("RUNTIME");
    if(match[2]!==principal.tenant_id)return deny("TENANT");
    if(!principal.scopes.includes(scopeFor(match[3])))return deny("SCOPE");
  }
  return {ok:true,reason:"OK"};
}
const principal={principal_id:"p",boot_id:"boot",runtime_id:"r",tenant_id:"t",generation:3,expires_at_ms:150000,scopes:["inspect:catalog","inspect:summary","inspect:metrics","inspect:upgrade_status"]};
const request={id:"req-1",method:"resources/read",protocolVersion:contract.protocolVersion,uri:"atto-dev://runtime/r/tenant/t/process/summary",security:{schema_version:contract.schema,nonce:"a".repeat(32),issued_at_ms:100000,runtime_id:"r",tenant_id:"t",expected_generation:3}};
const check=(over={},p=principal)=>admit({principal:p,request:{...request,...over,security:{...request.security,...(over.security||{})}}});
test("M0 is disabled and explicitly non-executable",()=>{assert.equal(contract.enabledByDefault,false);assert.match(contract.status,/SOURCE_FREE/);assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema")});
test("positive read-only policy model",()=>assert.equal(check().ok,true));
test("disabled rejects",()=>assert.equal(admit({enabled:false,principal,request}).reason,"DISABLED"));
test("unauthenticated rejects",()=>assert.equal(admit({authenticated:false,principal,request}).reason,"UNAUTHENTICATED"));
test("cross tenant in metadata rejects",()=>assert.equal(check({security:{tenant_id:"foreign"}}).reason,"TENANT"));
test("cross tenant in URI rejects",()=>assert.equal(check({uri:"atto-dev://runtime/r/tenant/foreign/process/summary"}).reason,"TENANT"));
test("cross runtime in URI rejects",()=>assert.equal(check({uri:"atto-dev://runtime/foreign/tenant/t/process/summary"}).reason,"RUNTIME"));
test("stale generation rejects",()=>assert.equal(check({security:{expected_generation:2}}).reason,"GENERATION"));
test("stale trusted boot rejects",()=>assert.equal(admit({principal,request,hostBootId:"old"}).reason,"GENERATION"));
test("expired principal rejects",()=>assert.equal(check({}, {...principal,expires_at_ms:1}).reason,"UNAUTHENTICATED"));
test("catalog scope escalation rejects",()=>assert.equal(check({method:"resources/list"}, {...principal,scopes:["inspect:summary"]}).reason,"SCOPE"));
test("read scope escalation rejects",()=>assert.equal(check({}, {...principal,scopes:["inspect:catalog"]}).reason,"SCOPE"));
test("unknown protocol version rejects",()=>assert.equal(check({protocolVersion:"old"}).reason,"VERSION"));
test("nonce replay rejects",()=>assert.equal(admit({principal,request,seen:new Set(["boot:p:"+request.security.nonce])}).reason,"REPLAY"));
test("clock skew rejects",()=>assert.equal(check({security:{issued_at_ms:1}}).reason,"MALFORMED"));
test("quota and replay saturation reject",()=>{for(const opts of [{inflight:2},{perSecond:8},{perMinute:60},{seen:new Set(Array.from({length:128},(_,i)=>String(i)))}])assert.equal(admit({principal,request,...opts}).reason,"QUOTA")});
test("oversized frame/depth/response reject",()=>{for(const opts of [{bytes:32769},{depth:13},{responseBytes:65537}])assert.equal(admit({principal,request,...opts}).reason,"OVERFLOW")});
test("unsupported mutations and forged artifact do not grant authority",()=>{for(const method of ["tools/call","upgrade/prepare","upgrade/commit","upgrade/rollback","guest/eval","guest/invoke","memory/write","initialize"])assert.equal(check({method,artifact:{signed:true}}).reason,"UNSUPPORTED")});
test("unknown resource rejects",()=>assert.equal(check({uri:"atto-dev://runtime/r/tenant/t/actors/private-state"}).reason,"MALFORMED"));
test("audit failure denies",()=>assert.equal(admit({principal,request,audit:false}).reason,"AUDIT_FAILURE"));
test("schema rejects caller principal and unknown methods structurally",()=>{assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.params.properties._meta.additionalProperties,false);assert.ok(!schema.properties.method.enum.includes("tools/call"));assert.ok(!("principal" in schema.properties))});

function makeReferenceLedger(){
  const activeIds=new Set(),seen=new Set();
  return {
    begin({principal:p=principal,request:r=request,...options}={}){
      const result=admit({principal:p,request:r,activeIds,seen,inflight:activeIds.size,...options});
      if(!result.ok)return result;
      activeIds.add(r.id);
      seen.add(p.boot_id+":"+p.principal_id+":"+r.security.nonce);
      return result;
    },
    finish(id){return activeIds.delete(id)},
    active(){return activeIds.size}
  };
}
test("duplicate live JSON-RPC ID rejected even with a distinct nonce",()=>{
 const ledger=makeReferenceLedger();
 assert.equal(ledger.begin().reason,"OK");
 const next={...request,security:{...request.security,nonce:"b".repeat(32)}};
 assert.equal(ledger.begin({request:next}).reason,"DUPLICATE_ID");
 assert.equal(ledger.active(),1);
 assert.equal(ledger.finish(request.id),true);
 assert.equal(ledger.begin({request:next}).reason,"OK");
});
test("request cancellation/disconnect releases reference ledger slot but never refunds nonce",()=>{
 const ledger=makeReferenceLedger();
 assert.equal(ledger.begin().reason,"OK");
 assert.equal(ledger.finish(request.id),true);
 assert.equal(ledger.active(),0);
 assert.equal(ledger.begin().reason,"REPLAY");
 const next={...request,security:{...request.security,nonce:"c".repeat(32)}};
 assert.equal(ledger.begin({request:next,cancelled:true}).reason,"TIMEOUT");
 assert.equal(ledger.begin({request:next,disconnected:true}).reason,"TIMEOUT");
 assert.equal(ledger.begin({request:next,elapsedMs:501}).reason,"TIMEOUT");
 assert.equal(ledger.active(),0);
 assert.equal(ledger.begin({request:next}).reason,"OK");
});
test("two concurrent IDs exhaust configured inflight limit",()=>{
 const ledger=makeReferenceLedger();
 assert.equal(ledger.begin().ok,true);
 const r2={...request,id:"req-2",security:{...request.security,nonce:"d".repeat(32)}};
 assert.equal(ledger.begin({request:r2}).ok,true);
 const r3={...request,id:"req-3",security:{...request.security,nonce:"e".repeat(32)}};
 assert.equal(ledger.begin({request:r3}).reason,"QUOTA");
});
test("caller-supplied boot and self-reported client identity are not authority",()=>{
 assert.equal(check({boot_id:"foreign",clientInfo:{name:"root",version:"999"}}).ok,true);
 assert.equal(check({boot_id:"foreign",security:{tenant_id:"foreign"}}).reason,"TENANT");
});
test("schema models optional client identity, nonempty client capabilities, and redacted summary fields",()=>{
 const meta=schema.properties.params.properties._meta;
 assert.ok(!meta.required.includes("io.modelcontextprotocol/clientInfo"));
 assert.equal(meta.properties["io.modelcontextprotocol/clientCapabilities"].maxProperties,16);
 assert.equal(schema.$defs.resourceSummary.additionalProperties,false);
 assert.ok(!Object.hasOwn(schema.$defs.resourceSummary.properties,"pointer"));
 assert.ok(!Object.hasOwn(schema.$defs.resourceSummary.properties,"secret"));
 assert.ok(schema.$defs.audit.properties.reason.enum.includes("DUPLICATE_ID"));
});
test("traversal-shaped identifiers rejected by model",()=>{
 assert.equal(check({uri:"atto-dev://runtime/../tenant/t/process/summary"}).reason,"MALFORMED");
});
