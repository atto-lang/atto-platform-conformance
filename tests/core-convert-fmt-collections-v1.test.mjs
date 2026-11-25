// HOST-ONLY reference oracle and strict transcript admission.
// Do not treat these unit tests or locally synthesized lines as compiled guest CI.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

export const contract=JSON.parse(readFileSync(new URL("../contracts/core-convert-fmt-collections-v1.json",import.meta.url),"utf8"));
const MIN=-(1n<<63n), MAX=(1n<<63n)-1n;
const ok=x=>"ok:"+String(x),err=x=>"err:"+x;
const sorted=a=>a.every((v,i)=>i===0||a[i-1]<=v);
const arr=a=>"["+a.join(",")+"]";

export function oracle({op,args:a}){
  if(op==="convert.bool_to_int")return String(a[0]?1:0);
  if(op==="convert.try_bool_from_int")return a[0]===0?ok(false):a[0]===1?ok(true):err(1);
  if(op==="convert.try_u8_from_int")return a[0]>=0&&a[0]<=255?ok(a[0]):err(2);
  if(op==="convert.ascii_decimal_digit")return a[0]>=48&&a[0]<=57?ok(a[0]-48):err(3);
  if(op==="convert.ascii_hex_digit"){
    const n=a[0];
    return n>=48&&n<=57?ok(n-48):n>=65&&n<=70?ok(n-55):n>=97&&n<=102?ok(n-87):err(4);
  }
  if(op==="convert.decimal_step_negative"){
    const acc=BigInt(a[0]),digit=a[1],negative=a[2];
    if(digit<0||digit>9)return err(3);
    if(acc>0n)return err(5);
    const floor=-922337203685477580n;
    if(acc<floor||acc===floor&&digit>(negative?8:7))return err(6);
    return ok(acc*10n-BigInt(digit));
  }
  if(op==="text_convert.try_bool_from_string"){
    return a[0]==="true"?ok(true):a[0]==="false"?ok(false):err("expected lowercase true or false");
  }
  if(op==="text_convert.try_int_from_string"){
    const s=a[0],points=[...s],start=points[0]==="-"?1:0;
    if(!points.length||points.length>20)return err("invalid signed decimal length");
    if(start===points.length)return err("missing decimal digits");
    if(points.length-start>19)return err("too many decimal digits");
    if(!/^[0-9]+$/.test(points.slice(start).join("")))return err("invalid ASCII decimal digit");
    const n=BigInt(s);
    return n<MIN||n>MAX?err("signed decimal overflow"):ok(n.toString());
  }
  if(op==="fmt.decimal_digit_count")return String(BigInt(a[0]).toString().replace("-","").length);
  if(op==="fmt.decimal_ascii_from_right"){
    const digits=BigInt(a[0]).toString().replace("-","");
    const pos=a[1];
    return pos<0||pos>=digits.length?err(7):ok(digits.charCodeAt(digits.length-pos-1));
  }
  if(op==="fmt.decimal_is_negative")return String(BigInt(a[0])<0n);
  if(op==="fmt.hex_ascii_nibble"){
    return a[0]<0||a[0]>15?err(4):ok(a[0]<10?48+a[0]:87+a[0]);
  }
  if(op==="fmt.bool_ascii_length")return String(a[0]?4:5);
  if(op==="fmt.bool_ascii_at"){
    const s=a[0]?"true":"false",pos=a[1];
    return pos<0||pos>=s.length?err(7):ok(s.charCodeAt(pos));
  }
  if(op==="text_fmt.format_bool")return a[0]?"true":"false";
  if(op==="text_fmt.format_int")return BigInt(a[0]).toString();
  if(op==="text_fmt.format_hex_byte"){
    return a[0]<0||a[0]>255?err("hex byte out of range"):ok(a[0].toString(16).padStart(2,"0"));
  }
  if(op==="collections.is_sorted_int")return String(sorted(a[0]));
  if(op==="collections.index_of_int")return String(a[0].indexOf(a[1]));
  if(op==="collections.contains_int")return String(a[0].includes(a[1]));
  if(op==="collections.lower_bound_int"){
    if(!sorted(a[0]))return err("lower bound requires sorted input");
    let lo=0,hi=a[0].length;
    while(lo<hi){const m=lo+Math.floor((hi-lo)/2);if(a[0][m]<a[1])lo=m+1;else hi=m;}
    return ok(lo);
  }
  if(op==="collections.unique_int"){
    return a[0].length>4096?err("unique_int input exceeds 4096 items"):ok(arr([...new Set(a[0])]));
  }
  if(op==="collections.merge_sorted_int"){
    const [left,right,budget]=a;
    if(budget<0||budget>65536)return err("merge budget outside 0..65536");
    if(left.length>budget||right.length>budget-left.length)return err("merge exceeds item budget");
    if(!sorted(left)||!sorted(right))return err("merge requires sorted inputs");
    let i=0,j=0;const result=[];
    while(i<left.length&&j<right.length){
      if(left[i]<=right[j])result.push(left[i++]);else result.push(right[j++]);
    }
    while(i<left.length)result.push(left[i++]);
    while(j<right.length)result.push(right[j++]);
    return ok(arr(result));
  }
  throw Error("unknown operation: "+op);
}

// Validate captured data only. No signature, workflow provenance, compiler
// identity, runner step proof, exact tree or SHA: NOT authenticated evidence.
export function verifyGuestTranscript(transcript,cases=contract.cases){
  assert.equal(typeof transcript,"string");
  if(!transcript.endsWith("\n")||transcript.includes("\r"))throw Error("noncanonical transcript terminators");
  const expected=new Map(cases.map(c=>[c.id,c.expected]));
  if(expected.size!==cases.length)throw Error("duplicate corpus identities");
  const lines=transcript.slice(0,-1).split("\n"),seen=new Set();
  for(const line of lines){
    const m=/^ATTO_LIB_V1\|([a-z0-9-]+)\|([^\r\n|]+)$/.exec(line);
    if(!m)throw Error("malformed, blank or non-guest case line");
    const [,id,result]=m;
    if(!expected.has(id)||seen.has(id))throw Error("unknown/duplicate guest case "+id);
    if(expected.get(id)!==result)throw Error("mismatch "+id);
    seen.add(id);
  }
  if(seen.size!==expected.size)throw Error("missing guest case results");
  return {matchedCases:seen.size,evidenceKind:"UNAUTHENTICATED_TRANSCRIPT"};
}

test("candidate contract cannot self-certify source or borrow results",()=>{
  assert.equal(contract.schemaVersion,1);
  assert.equal(contract.contract,"atto-core-convert-fmt-collections-v1");
  assert.equal(contract.status,"CANDIDATE_NOT_EXECUTED");
  assert.equal(contract.guestExecuted,0);
  assert.equal(contract.backendCandidates.length,9);
  assert.equal(contract.borrowAdmissionCandidates.length,5);
  assert.equal(contract.sourcePolicy.noHeapInCore,true);
  for(const b of contract.backendCandidates){
    assert.match(b.headSha,/^[a-f0-9]{40}$/);
    assert.equal(b.guestStatus,"NOT_EXECUTED");
    assert.equal(b.borrowStatus,"NOT_EXECUTED");
  }
  for(const b of contract.borrowAdmissionCandidates){
    assert.match(b.id,/^(?:positive|negative)_[a-z_]+$/);
    if(b.expect==="reject"){
      assert.equal(b.diagnosticRequired,"semantic-ownership-diagnostic");
      assert.equal(b.parserRejectionDoesNotCount,true);
    }
  }
});

test("all unique candidate vectors agree with independent mathematical model",()=>{
  assert.equal(contract.cases.length,91);
  const ids=new Set();
  for(const c of contract.cases){
    assert.match(c.id,/^[a-z0-9-]+$/);
    assert.ok(!ids.has(c.id),"duplicate id "+c.id);
    ids.add(c.id);
    assert.equal(oracle(c),c.expected,c.id);
  }
});

test("strict transcript rejects missing, duplicated, skipped or spoofed output",()=>{
  const valid=contract.cases.map(c=>"ATTO_LIB_V1|"+c.id+"|"+c.expected).join("\n")+"\n";
  assert.deepEqual(verifyGuestTranscript(valid),{matchedCases:91,evidenceKind:"UNAUTHENTICATED_TRANSCRIPT"});
  const first=valid.slice(0,valid.indexOf("\n")),withoutFirst=valid.slice(first.length+1);
  for(const bad of [
    "",valid+"\n",valid+" ",valid.replace("\n","\r\n"),
    withoutFirst,first+"\n"+valid,
    valid.replace(first,first+"\n"+first),
    valid.replace(first,first.replace(/\|[^|]*$/,"|SKIPPED")),
    valid.replace(first,first.replace("ATTO_LIB_V1|","ATTO_LIB_V1|unknown-")),
    valid.replace(first,"HOST_ONLY|"+first),
    valid.replace(first,first+"|extra"),
    valid.replace(first,first.replace(/.$/,"z")),
  ])assert.throws(()=>verifyGuestTranscript(bad));
});

test("host-only randomized core fmt scalar extraction covers signed i64 extremes",()=>{
  let s=0x12345678;
  const draw=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return BigInt(s);};
  const nums=[MIN,MAX,0n,-1n,1n];
  for(let i=0;i<10000;i++){
    const v=(draw()<<32n)|draw();
    nums.push(v>MAX?v-(1n<<64n):v);
  }
  for(const value of nums){
    const digits=value.toString().replace("-","");
    assert.equal(oracle({op:"fmt.decimal_digit_count",args:[value.toString()]}),String(digits.length));
    for(let p=0;p<digits.length;p++){
      assert.equal(oracle({op:"fmt.decimal_ascii_from_right",args:[value.toString(),p]}),ok(digits.charCodeAt(digits.length-1-p)));
    }
    assert.equal(oracle({op:"text_convert.try_int_from_string",args:[value.toString()]}),ok(value.toString()));
  }
});
