// Source-free receipt shape validation; does not authenticate a GitHub run.
export function validateEvidence(m,receipts,hashes){
 const errors=[],h40=/^[a-f0-9]{40}$/i,h64=/^[a-f0-9]{64}$/i;
 const requiredBackends=["java-graalvm","llvm","wasm","cranelift","net-nativeaot"];
 const requiredCases=[
  ["P01","guest-positive","42"],["P02","guest-positive","true"],
  ["P03","guest-positive","subscribed|p-1"],["P04","guest-positive","42"],
  ["N01","type-negative","CALLABLE_TRANSPORT"],["N02","type-negative","CALLABLE_TRANSPORT"],
  ["N03","type-negative","CALLABLE_TRANSPORT"],["N04","type-negative","CALLABLE_TRANSPORT"],
  ["N05","type-negative","CALLABLE_TRANSPORT"],["N06","type-negative","CALLABLE_TRANSPORT"],
  ["N07","runtime-negative","CALLABLE_TRANSPORT"],["N08","runtime-negative","CALLABLE_TRANSPORT"],
  ["N09","type-negative","BORROWED_PAYLOAD"],["N10","type-negative","MESSAGE_DATA_REQUIRED"],
  ["S01","type-negative","MESSAGE_DATA_REQUIRED"],["S02","type-negative","MESSAGE_DATA_REQUIRED"]
 ];
 const requiredAssertions=["reject-cyclic-graph","reject-depth-over-128","reject-nodes-over-65536","reject-foreign-collection-callback-before-enumeration","reject-dynamic-select-over-256","detach-before-enqueue-or-select-arming","reject-nominal-owner-injection","reject-topic-actorref","preserve-fair-select-cursor"];
 if(!m||m.schema!=="attolang.message-data.310.v1"||!Array.isArray(m.required_backends)||m.required_backends.join("|")!==requiredBackends.join("|")||!Array.isArray(m.cases)||m.cases.length!==requiredCases.length||!Array.isArray(m.security_runtime_assertions)||m.security_runtime_assertions.join("|")!==requiredAssertions.join("|"))return ["missing mandatory canonical MessageData contract cases/backends/assertions"];
 for(const [id,kind,categoryOrStdout] of requiredCases){
  const matching=m.cases.filter(c=>c?.id===id);
  if(matching.length!==1)return ["missing/duplicated canonical case "+id];
  const c=matching[0];
  if(c.kind!==kind||((kind==="guest-positive"?c.stdout:c.diagnostic_category)!==categoryOrStdout))return ["weakened canonical case "+id];
  if(kind==="runtime-negative"){
   if(c.fixture||c.injection!==(id==="N07"?"host-bound-method-value":"host-closure-in-list-map"))return ["invalid runtime injection "+id];
  }else{
   if(typeof c.fixture!=="string"||!c.fixture.startsWith("contracts/v1/message-data-310/fixtures/"+id+"-")||!c.fixture.endsWith(".atto")||!h40.test(c.fixture_git_blob_sha1||""))return ["missing, invalid, or unpinned canonical fixture "+id];
  }
 }

 if(!m.limits||m.limits.depth!==128||m.limits.nodes!==65536||m.limits.select_cases!==256)return ["weakened or missing canonical MessageData limits"];
 if(!Array.isArray(receipts))return ["receipts not array"];
 if(receipts.some(r=>!r||typeof r!=="object"||Array.isArray(r)))return ["null or invalid backend receipt"];
 for(const b of m.required_backends){
  const rs=receipts.filter(r=>r?.backend===b);
  if(rs.length!==1){errors.push(`${b}: missing or duplicate receipt`);continue}
  const r=rs[0],ci=r.ci||{};
  if(!h40.test(r.head_sha||"")||!h40.test(r.tree_sha||"")||!h64.test(r.native_artifact_sha256||""))errors.push(`${b}: missing exact SHA/tree/artifact proof`);
  if(r.execution_mode!=="compiled-native-guest"||r.native_guest_executed!==true)errors.push(`${b}: no compiled native guest`);
  if(!Number.isInteger(ci.run_id)||ci.run_id<1||!Number.isInteger(ci.job_id)||ci.job_id<1||!Array.isArray(ci.steps)||!ci.steps.length||!ci.steps.some(x=>x?.kind==="native-guest"&&x.conclusion==="success")||ci.steps.some(x=>!x||x.conclusion!=="success"))errors.push(`${b}: missing or non-successful native guest steps`);
  const rows=Array.isArray(r.cases)?r.cases:[];
  if(rows.length!==m.cases.length||new Set(rows.map(x=>x?.id)).size!==m.cases.length)errors.push(`${b}: missing or repeated cases`);
  for(const t of m.cases){
   const row=rows.find(x=>x?.id===t.id);
   if(!row){errors.push(`${b}/${t.id}: missing`);continue}
   if(t.fixture){if(!h64.test(hashes[t.fixture]||"")||row.fixture_sha256!==hashes[t.fixture]||row.fixture_git_blob_sha1!==t.fixture_git_blob_sha1)errors.push(`${b}/${t.id}: wrong fixture SHA256 or Git blob identity`)}
   else if(row.injection!==t.injection)errors.push(`${b}/${t.id}: wrong host injection`);
   if(t.kind==="guest-positive"){
    if(row.phase!=="native-guest"||row.result!=="pass"||row.exit_code!==0||row.stdout!==t.stdout||row.stderr!=="")errors.push(`${b}/${t.id}: missing exact native output / clean exit proof`);
   }else if(t.kind==="type-negative"){
    const loc=row.source_location;
    const pattern=t.diagnostic_category==="MESSAGE_DATA_REQUIRED"?/MessageData/i:t.diagnostic_category==="BORROWED_PAYLOAD"?/borrow|Sendable|owned/i:/function|callable|closure|bound method|Topic payload/i;
    if(row.phase!=="semantic-typecheck"||row.result!=="reject"||row.diagnostic_category!==t.diagnostic_category
      ||!Number.isInteger(row.exit_code)||row.exit_code===0
      ||row.parser_accepted!==true||row.parse_failure!==false
      ||typeof row.diagnostic_code!=="string"||row.diagnostic_code.length<3
      ||typeof row.diagnostic_text!=="string"||!pattern.test(row.diagnostic_text)
      ||!loc||loc.file!==t.fixture||!Number.isInteger(loc.line)||loc.line<1
      ||!Number.isInteger(loc.column)||loc.column<1)errors.push(`${b}/${t.id}: missing parse-accepted semantic rejection / category / diagnostic / source position`);
   }else if(t.kind==="runtime-negative"){
    if(row.phase!=="native-runtime-admission"||row.result!=="reject"
      ||row.diagnostic_category!==t.diagnostic_category
      ||row.rejected_before_enqueue!==true||row.receiver_observed_payload!==false
      ||row.harness_exit_code!==0||row.harness_executed!==true
      ||typeof row.diagnostic_text!=="string"||!/function|callable|closure|bound method/i.test(row.diagnostic_text)
      )errors.push(`${b}/${t.id}: missing executed and fail-closed native runtime rejection`);
   }else errors.push(`${b}/${t.id}: unknown case kind`);
   if(row.skipped===true||row.host_only===true||row.pending===true)errors.push(`${b}/${t.id}: unqualified result`);
  }
  for(const assertion of m.security_runtime_assertions)if(r.security_runtime_assertions?.[assertion]!==true)errors.push(`${b}: missing ${assertion}`);
 }
 for(const r of receipts)if(r&&!m.required_backends.includes(r.backend))errors.push(`unexpected backend ${r.backend}`);
 return errors;
}
if(process.argv[1] && import.meta.url===(await import("node:url")).pathToFileURL(process.argv[1]).href){
 const {readFileSync,lstatSync,realpathSync}=await import("node:fs");
 const {createHash}=await import("node:crypto");
 const {dirname,resolve,sep}=await import("node:path");
 const [manifestPath,receiptsPath]=process.argv.slice(2);
 if(!manifestPath||!receiptsPath){console.error("usage: node verify-evidence.mjs manifest.json receipts.json");process.exit(2)}
 const manifestBytes=readFileSync(manifestPath);
 const approvedManifestHash=(process.env.ATTO_MESSAGE_DATA_MANIFEST_SHA256||"").toLowerCase().trim();
 if(!/^[a-f0-9]{64}$/.test(approvedManifestHash))throw new Error("trusted protected-main manifest SHA256 is required in ATTO_MESSAGE_DATA_MANIFEST_SHA256");
 if(createHash("sha256").update(manifestBytes).digest("hex")!==approvedManifestHash)throw new Error("manifest SHA256 differs from trusted protected-main pin");
 const m=JSON.parse(manifestBytes.toString("utf8")),receipts=JSON.parse(readFileSync(receiptsPath,"utf8"));
 const root=resolve(dirname(resolve(manifestPath)),"../../.."), hashes={};
 for(const t of m.cases)if(t.fixture){
  const p=resolve(root,t.fixture);
  if(!p.startsWith(root+sep))throw new Error("fixture path escapes repository");
  if(!lstatSync(p).isFile()||realpathSync(p)!==p)throw new Error("fixture is not a regular non-symlink file");
  const bytes=readFileSync(p);
  const blobId=createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
  if(blobId!==t.fixture_git_blob_sha1)throw new Error("fixture Git blob identity differs from trusted manifest: "+t.fixture);
  hashes[t.fixture]=createHash("sha256").update(bytes).digest("hex");
 }
 const errors=validateEvidence(m,receipts,hashes);
 if(errors.length){for(const e of errors)console.error("FAIL",e);process.exit(1)}
 console.log("PASS: five-backend receipt structure complete; independent run/provenance audit still required");
}
