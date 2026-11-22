import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

export const contract = JSON.parse(readFileSync(new URL("../contracts/core-convert-fmt-collections-v1.json", import.meta.url), "utf8"));
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const ok=x=>"ok:"+String(x),err=x=>"err:"+x;
const sorted=a=>a.every((v,i)=>i===0||a[i-1]<=v);
const arr=a=>"["+a.join(",")+"]";

export function oracle({op,args:a}){
  if(op==="convert.bool_to_int")return String(a[0]?1:0);
  if(op==="convert.try_bool_from_int")return a[0]===0?ok(false):a[0]===1?ok(true):err("bool conversion accepts only 0 or 1");
  if(op==="convert.try_u8_from_int")return a[0]>=0&&a[0]<=255?ok(a[0]):err("value out of u8 range");
  if(op==="convert.ascii_decimal_digit")return a[0]>=48&&a[0]<=57?ok(a[0]-48):err("not an ASCII decimal digit");
  if(op==="convert.ascii_hex_digit"){
    const n=a[0];return n>=48&&n<=57?ok(n-48):n>=65&&n<=70?ok(n-55):n>=97&&n<=102?ok(n-87):err("not an ASCII hex digit");
  }
  if(op==="convert.try_bool_from_string")return a[0]==="true"?ok(true):a[0]==="false"?ok(false):err("expected lowercase true or false");
  if(op==="convert.try_int_from_string"){
    const s=a[0],points=[...s],start=points[0]==="-"?1:0;
    if(points.length===0||points.length>20)return err("invalid signed decimal length");
    if(start===points.length)return err("missing decimal digits");
    if(points.length-start>19)return err("too many decimal digits");
    if(!/^[0-9]+$/.test(points.slice(start).join("")))return err("invalid ASCII decimal digit");
    const n=BigInt(s);return n<MIN||n>MAX?err("signed decimal overflow"):ok(n.toString());
  }
  if(op==="fmt.format_bool")return a[0]?"true":"false";
  if(op==="fmt.format_int")return BigInt(a[0]).toString();
  if(op==="fmt.format_hex_byte")return a[0]<0||a[0]>255?err("hex byte out of range"):ok(a[0].toString(16).padStart(2,"0"));
  if(op==="collections.is_sorted_int")return String(sorted(a[0]));
  if(op==="collections.index_of_int")return String(a[0].indexOf(a[1]));
  if(op==="collections.contains_int")return String(a[0].includes(a[1]));
  if(op==="collections.lower_bound_int"){
    if(!sorted(a[0]))return err("lower bound requires sorted input");
    let lo=0,hi=a[0].length;while(lo<hi){const m=lo+Math.floor((hi-lo)/2);if(a[0][m]<a[1])lo=m+1;else hi=m;}return ok(lo);
  }
  if(op==="collections.unique_int")return a[0].length>4096?err("unique_int input exceeds 4096 items"):ok(arr([...new Set(a[0])]));
  if(op==="collections.merge_sorted_int"){
    const [left,right,budget]=a;
    if(budget<0||budget>65536)return err("merge budget outside 0..65536");
    if(left.length>budget||right.length>budget-left.length)return err("merge exceeds item budget");
    if(!sorted(left)||!sorted(right))return err("merge requires sorted inputs");
    let i=0,j=0;const result=[];
    while(i<left.length&&j<right.length){if(left[i]<=right[j])result.push(left[i++]);else result.push(right[j++]);}
    while(i<left.length)result.push(left[i++]);while(j<right.length)result.push(right[j++]);
    return ok(arr(result));
  }
  throw Error("unknown operation: "+op);
}

export function verifyGuestTranscript(transcript, cases=contract.cases){
  assert.equal(typeof transcript,"string");
  const expected=new Map(cases.map(c=>[c.id,c.expected]));
  const observed=new Set();
  for(const line of transcript.trimEnd().split("\n")){
    const match=/^ATTO_LIB_V1\\|([a-z0-9-]+)\\|([^\\r\\n|]*)$/.exec(line);
    if(!match)throw Error("malformed or unexecuted guest result: "+line);
    const [,id,value]=match;
    if(!expected.has(id)||observed.has(id))throw Error("unknown/duplicate guest case "+id);
    if(expected.get(id)!==value)throw Error("guest mismatch "+id);
    observed.add(id);
  }
  if(observed.size!==expected.size)throw Error("missing guest case results");
  return {executedCases:observed.size,kind:"verified-captured-results-only"};
}

test("manifest explicitly refuses to certify candidate heads",()=>{
  assert.equal(contract.schemaVersion,1);
  assert.equal(contract.contract,"atto-core-convert-fmt-collections-v1");
  assert.equal(contract.status,"CANDIDATE_NOT_EXECUTED");
  assert.equal(contract.guestExecuted,0);
  assert.equal(contract.backendCandidates.length,9);
  for(const b of contract.backendCandidates){
    assert.match(b.headSha,/^[0-9a-f]{40}$/);
    assert.equal(b.guestStatus,"NOT_EXECUTED");
  }
});

test("all unique cases agree with independent BigInt/array oracle",()=>{
  assert.ok(contract.cases.length>=60);
  const seen=new Set();
  for(const c of contract.cases){
    assert.match(c.id,/^[a-z0-9-]+$/);
    assert.ok(!seen.has(c.id));
    seen.add(c.id);
    assert.equal(oracle(c),c.expected,c.id);
  }
});

test("strict transcript requires every executed result and rejects fake passes",()=>{
  const valid=contract.cases.map(c=>"ATTO_LIB_V1|"+c.id+"|"+c.expected).join("\n")+"\n";
  assert.equal(verifyGuestTranscript(valid).executedCases,contract.cases.length);
  const first=valid.split("\n")[0];
  const corrupt=[
    "",
    valid.replace(first+"\n",""),
    first+"\n"+valid,
    valid.replace(first,first+"\n"+first),
    valid.replace(first,first.replace(/\\|[^|]*$/, "|SKIPPED")),
    valid.replace(first,first.replace("ATTO_LIB_V1|","ATTO_LIB_V1|unexpected-")),
    valid.replace(first,"HOST_ONLY|"+first),
    valid.replace(first,first+"|garbage"),
    valid.replace(first,first.replace(/.$/,"z"))
  ];
  for(const input of corrupt)assert.throws(()=>verifyGuestTranscript(input));
});
