export const BACKENDS = Object.freeze([
  "oreslang-source.java",
  "oreslang-source.llvm",
  "oreslang-source.net",
  "oreslang-source.wasm",
  "oreslang-source.forge"
]);

export const INVARIANTS = Object.freeze(
  Array.from({length:15}, (_, index) => "BQ" + String(index + 1).padStart(2, "0"))
);

const SHA1=/^[a-f0-9]{40}$/;

function fail(message) {
  throw new Error("INVALID_BOUNDED_QUEUE_V1: " + message);
}
function object(value,name) {
  if(value===null || typeof value!=="object" || Array.isArray(value))
    fail(name+" must be object");
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype && proto!==null)
    fail(name+" must be plain data object");
  // JSON evidence cannot contain symbols, accessors or inherited authority.
  // Inspect own property descriptors rather than invoking caller getters.
  for(const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=="string" || !descriptor?.enumerable ||
       !Object.hasOwn(descriptor,"value"))
      fail(name+" must contain only enumerable own data fields");
  }
  return value;
}
function exactRecordArray(value, length, name) {
  if(!Array.isArray(value)) fail(name+" must be an array");
  const size=Object.getOwnPropertyDescriptor(value,"length")?.value;
  if(size!==length) fail(name+" must have exact length");
  const keys=Reflect.ownKeys(value);
  if(keys.length!==length+1) fail(name+" unexpected array metadata");
  const result=[];
  for(let i=0;i<length;i++) {
    const slot=Object.getOwnPropertyDescriptor(value,String(i));
    if(!slot?.enumerable || !Object.hasOwn(slot,"value"))
      fail(name+" requires own enumerable data slots");
    result.push(slot.value);
  }
  return result;
}
function exactKeys(value,keys,name) {
  for(const key of Object.keys(value)) if(!keys.includes(key)) fail(name+" unexpected key: "+key);
  for(const key of keys) if(!Object.hasOwn(value,key)) fail(name+" missing key: "+key);
}
function nonempty(value,name) {
  if(typeof value!=="string" || value.trim().length===0) fail(name+" must be nonempty");
}
function commit(value,name) {
  if(typeof value!=="string" || !SHA1.test(value)) fail(name+" must be exact Git SHA-1");
}
function positive(value,name) {
  if(!Number.isSafeInteger(value) || value<1) fail(name+" must be positive integer");
}

export function validateBoundedQueueContract(contract) {
  object(contract,"contract");
  exactKeys(contract,[
    "schema","contract_id","transport_model","ticket_model","required_invariants",
    "arbitration","scenarios","backends","evidence_rule"
  ],"contract");
  if(contract.schema!=="oreslang.bounded_queue_contract.v1") fail("wrong contract schema");
  if(contract.contract_id!=="bounded-queue-v1") fail("wrong contract id");
  const invariants=exactRecordArray(contract.required_invariants,INVARIANTS.length,"invariants");
  const ids=invariants.map(x=>object(x,"invariant").id);
  if(JSON.stringify(ids)!==JSON.stringify(INVARIANTS)) fail("invariant ids must be BQ01..BQ15 in order");
  for(const invariant of invariants){
    exactKeys(invariant,["id","name","rule"],"invariant");
    nonempty(invariant.name,"invariant name");
    nonempty(invariant.rule,"invariant rule");
  }
  object(contract.arbitration,"arbitration");
  exactKeys(contract.arbitration,[
    "pending_push","close_linearization","receive_linearization"
  ],"arbitration");
  if(!Array.isArray(contract.arbitration.pending_push)
      || contract.arbitration.pending_push.length!==3)
    fail("pending push linearization requires exactly three rules");
  for(const rule of contract.arbitration.pending_push)
    nonempty(rule,"pending push linearization rule");
  if(!contract.arbitration.pending_push[0].includes("cancellation"))
    fail("pending push must state cancellation-before-commit semantics");
  if(!contract.arbitration.pending_push[1].includes("Channel.close"))
    fail("close must linearize through the actual item channel");
  if(!contract.arbitration.pending_push[2].includes("commit"))
    fail("write commit must be final");
  nonempty(contract.arbitration.close_linearization,"close linearization");
  if(!contract.arbitration.close_linearization.includes("actual item channel"))
    fail("synthetic close-token models are forbidden");
  nonempty(contract.arbitration.receive_linearization,"receive linearization");
  if(!Array.isArray(contract.scenarios) || contract.scenarios.length<5) fail("required scenarios missing");
  const scenarioIds=new Set();
  for(const scenario of contract.scenarios){
    object(scenario,"scenario");
    exactKeys(scenario,["id","capacity","actions","expected"],"scenario");
    nonempty(scenario.id,"scenario id");
    if(scenarioIds.has(scenario.id)) fail("duplicate scenario id");
    scenarioIds.add(scenario.id);
    positive(scenario.capacity,"scenario capacity");
    if(!Array.isArray(scenario.actions)||scenario.actions.length===0) fail("scenario actions required");
    if(!Array.isArray(scenario.expected)||scenario.expected.length===0) fail("scenario expected events required");
    for(const event of [...scenario.actions,...scenario.expected]) nonempty(event,"scenario event");
  }
  for(const required of [
    "pending_writers_fifo","cancel_older_then_progress","close_with_pending",
    "full_is_nonretaining","stale_ticket_after_close","full_returns_payload"
  ]) if(!scenarioIds.has(required)) fail("missing scenario: "+required);
  if(JSON.stringify(contract.backends)!==JSON.stringify(BACKENDS)) fail("exact five backend order required");
  nonempty(contract.evidence_rule,"evidence rule");
  return {ok:true,invariants:INVARIANTS.length,scenarios:contract.scenarios.length,backends:BACKENDS.length};
}

export function validateBoundedQueueBackendStatus(status) {
  object(status,"status");
  exactKeys(status,[
    "schema","contract_id","source_contract","records","parity_certified","release_ready"
  ],"status");
  if(status.schema!=="oreslang.bounded_queue_backend_status.v1") fail("wrong status schema");
  if(status.contract_id!=="bounded-queue-v1") fail("wrong status contract id");
  object(status.source_contract,"source contract");
  exactKeys(status.source_contract,[
    "repository","pull_request","head_commit","execution_status"
  ],"source contract");
  if(status.source_contract.repository!=="ores-truffle-oreslang/rx-oreslang-channels")
    fail("wrong source contract repository");
  positive(status.source_contract.pull_request,"source contract pull request");
  commit(status.source_contract.head_commit,"source contract head");
  if(status.source_contract.execution_status!=="NOT_EXECUTED")
    fail("pending manifest cannot claim source execution");
  const records=exactRecordArray(status.records,BACKENDS.length,"backend records");
  const seen=new Set();
  for(const record of records){
    object(record,"backend record");
    exactKeys(record,[
      "backend","source_lowering","runtime_substrate","guest_execution","reference","reason"
    ],"backend record");
    if(!BACKENDS.includes(record.backend)||seen.has(record.backend))
      fail("missing, foreign or duplicate backend");
    seen.add(record.backend);
    if(!["implemented-unexecuted","unsupported"].includes(record.source_lowering))
      fail("invalid source lowering state");
    if(!["implementation-added-unexecuted","contract-tests-added-unexecuted","unsupported"].includes(record.runtime_substrate))
      fail("invalid runtime substrate state");
    if(record.guest_execution!=="NOT_EXECUTED")
      fail("pending backend cannot claim guest execution");
    object(record.reference,"backend reference");
    for(const [key,value] of Object.entries(record.reference)){
      if(key.endsWith("_commit")) commit(value,key);
      else positive(value,key);
    }
    nonempty(record.reason,"backend reason");
  }
  if(status.parity_certified!==false||status.release_ready!==false)
    fail("pending manifest must remain fail-closed");
  return {
    ok:true,
    backendCount:BACKENDS.length,
    executedBackendCount:0,
    parityCertified:false,
    releaseReady:false,
    blocked:records.map(x=>x.backend)
  };
}
