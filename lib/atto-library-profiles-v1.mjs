// Backend-neutral AttoLang library closure policy; NOT a compiler or artifact validator.
// Policy changes require a new versioned manifest and backend compiler execution.
function ensure(condition,message){if(!condition)throw Error(message)}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
export function validateManifest(m){
 ensure(m && typeof m==="object","manifest object required");
 ensure(m.schemaVersion===1 && m.contract==="atto.library-profiles/1" && m.language==="AttoLang","identity/schema violation");
 ensure(m.sourceSuffix===".atto" && m.status==="SPECIFICATION_ONLY_NOT_EXECUTED","source extension/evidence violation");
 const tiers={
  core:{namespace:"atto.core",dependencies:["core"],permittedCapabilities:[]},
  alloc:{namespace:"atto.alloc",dependencies:["core","alloc"],permittedCapabilities:["allocator"]},
  std:{namespace:"atto.std",dependencies:["core","alloc","std"],permittedCapabilities:["allocator","executor","os_io"]}
 };
 ensure(same(m.tiers,tiers),"library tiers or dependency direction altered");
 ensure(same(m.optionalActor,{
  namespace:"atto.runtime.actor",independentOfLibraryTier:true,
  staticCapabilities:["static_actor"],hostedCapabilities:["executor","mailbox","supervision"],
  staticModeRequiresCallerOwnedBoundedStorage:true
 }),"actor must remain independent and bounded in Core");
 const expectedProfiles=[
  {id:"core",tiers:["core"],capabilities:[]},
  {id:"core+static-actor",tiers:["core","actor"],capabilities:["static_actor"]},
  {id:"alloc",tiers:["core","alloc"],capabilities:["allocator"]},
  {id:"alloc+actor",tiers:["core","alloc","actor"],capabilities:["allocator","executor","mailbox","supervision"]},
  {id:"std",tiers:["core","alloc","std"],capabilities:["allocator","executor","os_io"]},
  {id:"std+actor",tiers:["core","alloc","std","actor"],capabilities:["allocator","executor","os_io","mailbox","supervision"]},
  {id:"full",tiers:["core","alloc","std","actor"],capabilities:["allocator","executor","os_io","mailbox","supervision"]}
 ];
 ensure(same(m.profiles,expectedProfiles),"invalid or relaxed build preset");
 ensure(same(m.evidence,{java:"NOT_EXECUTED",llvm:"NOT_EXECUTED",net:"NOT_EXECUTED",wasm:"NOT_EXECUTED",forge:"NOT_EXECUTED"}),"contract tests are not backend evidence");
 const f=m.freestanding;
 ensure(f && f.target==="thumbv7m-none-eabi" && f.existingLegacyGate==="tools/core-baremetal-gate","freestanding gate missing");
 ensure(f.canonicalAttoFixture==="fixtures/atto-library-profiles/v1/core-numeric.atto","canonical Atto Core fixture missing");
 ensure(same(f.requiredEvidence,["exact_source_head","compiler_generated_ir","compiled_guest_object","undefined_symbol_audit","static_link_no_libc","linked_elf_segment_audit","executed_qemu_guest","negative_import_rejection","negative_helper_injection"]),"freestanding evidence weakened");
 ensure(same(f.permittedExternalHelperNames,["memcpy","memmove","memset","memcmp","__mulodi4"]) && f.permittedExternalHelperPrefix==="__aeabi_","ABI helper allowlist weakened");
 ensure(same(f.forbiddenArtifactFeatures,["libc","heap_allocator","tracing_gc","os_services","actor_startup","dynamic_loader","tls","constructors"]),"freestanding exclusions weakened");
 ensure(same(m.fixtures,[
  {id:"core-numeric",file:"fixtures/atto-library-profiles/v1/core-numeric.atto",expected:"CANDIDATE_COMPILE_AND_EXECUTE",profile:"core"},
  {id:"core-to-std",file:"fixtures/atto-library-profiles/v1/reject-core-to-std.atto",expected:"REJECT_BEFORE_IR",profile:"core"},
  {id:"core-to-alloc",file:"fixtures/atto-library-profiles/v1/reject-core-to-alloc.atto",expected:"REJECT_BEFORE_IR",profile:"core"}
 ]),"fixtures changed without contract version update");
 return true;
}
export function verifyProfileGraph(m,{profile,modules,roots}){
 validateManifest(m);
 ensure(Array.isArray(modules) && modules.length>0 && modules.length<=256,"bounded module inventory required");
 ensure(Array.isArray(roots) && roots.length>0 && roots.length<=32,"bounded entry roots required");
 const p=m.profiles.find(p=>p.id===profile);
 ensure(p,"unknown profile");
 const entries=new Map();
 const allowedRequires=new Set(["allocator","executor","os_io","mailbox","supervision","static_actor"]);
 for(const module of modules){
  ensure(module && typeof module.id==="string" && /^[a-z][a-z0-9_-]{0,63}$/.test(module.id),"invalid module id");
  ensure(["core","alloc","std","actor","app"].includes(module.tier),"unknown library tier");
  ensure(!entries.has(module.id),"duplicate module");
  ensure(Array.isArray(module.imports) && module.imports.length<=64 && new Set(module.imports).size===module.imports.length,"invalid imports");
  ensure(Array.isArray(module.requires) && module.requires.length<=6 && new Set(module.requires).size===module.requires.length,"invalid capabilities");
  for(const cap of module.requires) ensure(allowedRequires.has(cap),"unknown or forbidden effect/capability: "+cap);
  if(module.tier==="core") ensure(module.requires.length===0,"Core must remain allocation/OS/runtime-free");
  if(module.tier==="alloc") ensure(module.requires.every(c=>c==="allocator"),"Alloc cannot require OS or executor");
  if(module.tier==="std") ensure(module.requires.every(c=>["allocator","executor","os_io"].includes(c)),"Std tier cannot depend on actor services");
  if(module.tier==="actor"){
   if(profile==="core+static-actor") ensure(module.requires.every(c=>c==="static_actor"),"static actors require caller-owned bounded storage");
   else ensure(!module.requires.includes("static_actor") && module.requires.every(c=>["allocator","executor","mailbox","supervision"].includes(c)),"hosted actor capabilities invalid");
  }
  entries.set(module.id,module);
 }
 const visited=new Set(),inProgress=new Set();
 function visit(id,importer){
  const node=entries.get(id);
  ensure(node,"missing imported module: "+id);
  if(importer){
   ensure(importer.tier==="app" || (importer.tier==="actor" && node.tier!=="app") ||
    (node.tier!=="actor" && node.tier!=="app" && m.tiers[importer.tier]?.dependencies.includes(node.tier)),
    "upward or actor dependency from "+importer.id+" to "+id);
  }
  ensure(node.tier==="app" || p.tiers.includes(node.tier),"tier "+node.tier+" excluded from "+profile);
  ensure(node.requires.every(c=>p.capabilities.includes(c)),"missing capability for "+id);
  ensure(!inProgress.has(id),"cyclic dependency "+id);
  if(visited.has(id))return;
  inProgress.add(id);
  for(const child of node.imports)visit(child,node);
  inProgress.delete(id);visited.add(id);
 }
 for(const id of roots){ensure(entries.get(id)?.tier==="app","roots must be application units");visit(id,null)}
 return {status:"CONTRACT_GRAPH_ONLY",profile,visited:[...visited].sort()};
}
