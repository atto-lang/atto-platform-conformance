// Source-free receipt shape validation; does not authenticate a GitHub run.
export function validateEvidence(m,receipts,hashes){
 const errors=[],h40=/^[a-f0-9]{40}$/i,h64=/^[a-f0-9]{64}$/i;
 if(!Array.isArray(receipts))return ["receipts not array"];
 for(const b of m.required_backends){
  const rs=receipts.filter(r=>r?.backend===b);
  if(rs.length!==1){errors.push(`${b}: missing or duplicate receipt`);continue}
  const r=rs[0],ci=r.ci||{};
  if(!h40.test(r.head_sha||"")||!h40.test(r.tree_sha||"")||!h64.test(r.native_artifact_sha256||""))errors.push(`${b}: missing exact SHA/tree/artifact proof`);
  if(r.execution_mode!=="compiled-native-guest"||r.native_guest_executed!==true)errors.push(`${b}: no compiled native guest`);
  if(!Number.isInteger(ci.run_id)||ci.run_id<1||!Number.isInteger(ci.job_id)||ci.job_id<1||!Array.isArray(ci.steps)||!ci.steps.length||!ci.steps.some(x=>x?.kind==="native-guest"&&x.conclusion==="success")||ci.steps.some(x=>x?.conclusion==="failure"))errors.push(`${b}: no nonempty native guest steps`);
  const rows=Array.isArray(r.cases)?r.cases:[];
  if(rows.length!==m.cases.length||new Set(rows.map(x=>x?.id)).size!==m.cases.length)errors.push(`${b}: missing or repeated cases`);
  for(const t of m.cases){
   const row=rows.find(x=>x?.id===t.id);
   if(!row){errors.push(`${b}/${t.id}: missing`);continue}
   if(t.fixture){if(!h64.test(hashes[t.fixture]||"")||row.fixture_sha256!==hashes[t.fixture])errors.push(`${b}/${t.id}: wrong fixture digest`)}
   else if(row.injection!==t.injection)errors.push(`${b}/${t.id}: wrong host injection`);
   if(t.kind==="guest-positive"){
    if(row.phase!=="native-guest"||row.result!=="pass"||row.exit_code!==0||row.stdout!==t.stdout)errors.push(`${b}/${t.id}: no native output proof`);
   }else if(t.kind==="type-negative"){
    if(row.phase!=="semantic-typecheck"||row.result!=="reject"||row.diagnostic_category!==t.diagnostic_category||row.exit_code===0||!Number.isInteger(row.exit_code)||row.parse_failure===true)errors.push(`${b}/${t.id}: missing semantic rejection`);
   }else if(t.kind==="runtime-negative"){
    if(row.phase!=="native-runtime-admission"||row.result!=="reject"||row.diagnostic_category!==t.diagnostic_category||row.rejected_before_enqueue!==true)errors.push(`${b}/${t.id}: missing runtime rejection`);
   }else errors.push(`${b}/${t.id}: unknown case kind`);
   if(row.skipped===true||row.host_only===true||row.pending===true)errors.push(`${b}/${t.id}: unqualified result`);
  }
  for(const assertion of m.security_runtime_assertions)if(r.security_runtime_assertions?.[assertion]!==true)errors.push(`${b}: missing ${assertion}`);
 }
 for(const r of receipts)if(r&&!m.required_backends.includes(r.backend))errors.push(`unexpected backend ${r.backend}`);
 return errors;
}
if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1]).href){
 const {readFileSync}=await import("node:fs");
 const {createHash}=await import("node:crypto");
 const {dirname,resolve}=await import("node:path");
 const [manifestPath,receiptsPath]=process.argv.slice(2);
 if(!manifestPath||!receiptsPath){console.error("usage: node verify-evidence.mjs manifest.json receipts.json");process.exit(2)}
 const m=JSON.parse(readFileSync(manifestPath,"utf8")),receipts=JSON.parse(readFileSync(receiptsPath,"utf8"));
 const root=resolve(dirname(resolve(manifestPath)),"../../.."), hashes={};
 for(const t of m.cases)if(t.fixture){
  const p=resolve(root,t.fixture);
  if(!p.startsWith(root+"/"))throw new Error("fixture path escapes repository");
  hashes[t.fixture]=createHash("sha256").update(readFileSync(p)).digest("hex");
 }
 const errors=validateEvidence(m,receipts,hashes);
 if(errors.length){for(const e of errors)console.error("FAIL",e);process.exit(1)}
 console.log("PASS: five-backend receipt structure complete; independent run/provenance audit still required");
}
