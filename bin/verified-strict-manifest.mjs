export function validateStrictManifest(m) {
 const fail=msg=>{throw new Error("invalid strict manifest: "+msg);};
 const tiers=["arithmetic","control-flow","loops","boundaries","guards","lazy-helpers","full-width","mutable-rebinding","mutable-joins","loop-backedges","loop-adversarial","array-bounds","array-adversarial","loop-exits","exit-adversarial","explicit-init"];
 if(!m||m.schemaVersion!==1||m.profile!=="verified-core-strict-i64-v1"||!Array.isArray(m.cases)||!m.cases.length)fail("schema/profile/cases");
 const ids=new Set();
 for(const c of m.cases){
  if(!c||typeof c.id!=="string"||! /^[a-z0-9-]+$/.test(c.id)||ids.has(c.id))fail("invalid or duplicate id");
  ids.add(c.id);
  if(!tiers.includes(c.tier)||typeof c.source!=="string"||!c.source.trim())fail("tier/source: "+c.id);
  const e=c.expected;
  if(!e||typeof e!=="object")fail("expectation: "+c.id);
  if(e.kind==="value"){
   if(typeof e.decimal!=="string"||! /^(0|-?[1-9][0-9]*)$/.test(e.decimal)||e.decimal.length>20||BigInt(e.decimal)<-(1n<<63n)||BigInt(e.decimal)>(1n<<63n)-1n||Object.hasOwn(e,"category"))fail("i64 value: "+c.id);
  }else if(e.kind==="diagnostic"){
   if(typeof e.category!=="string"||! /^E_[A-Z][A-Z0-9_]*$/.test(e.category)||Object.hasOwn(e,"decimal"))fail("diagnostic: "+c.id);
  }else fail("kind: "+c.id);
 }
 return m;
}
