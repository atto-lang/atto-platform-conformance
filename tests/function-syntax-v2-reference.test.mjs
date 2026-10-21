import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const dir=fileURLToPath(new URL("../fixtures/function-syntax/",import.meta.url));
const manifest=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));

function visibleSource(source){
  let out="";
  let quote=null;
  let escape=false;
  let blockDepth=0;

  for(let i=0;i<source.length;i++){
    const c=source[i];
    const n=source[i+1];

    if(blockDepth>0){
      if(c==="/" && n==="*"){ blockDepth++; out+="  "; i++; continue; }
      if(c==="*" && n==="/"){ blockDepth--; out+="  "; i++; continue; }
      out+=c==="\n" ? "\n" : " ";
      continue;
    }

    if(quote!==null){
      if(escape){ escape=false; out+=" "; continue; }
      if(c==="\\"){ escape=true; out+=" "; continue; }
      if(c===quote){ quote=null; out+=" "; continue; }
      out+=c==="\n" ? "\n" : " ";
      continue;
    }

    if(c==="/" && n==="/"){
      while(i<source.length && source[i]!=="\n"){ out+=" "; i++; }
      if(i<source.length) out+="\n";
      continue;
    }
    if(c==="/" && n==="*"){ blockDepth=1; out+="  "; i++; continue; }
    if(c==="\"" || c==="'" || c==="`"){ quote=c; out+=" "; continue; }
    out+=c;
  }
  return out;
}


function hasAmbiguousBareWords(typeText){
  const words=[];
  let paren=0, bracket=0, brace=0, angle=0;
  for(let i=0;i<typeText.length;){
    const c=typeText[i];
    if(c==="("){ paren++; i++; continue; }
    if(c===")"){ paren=Math.max(0,paren-1); i++; continue; }
    if(c==="["){ bracket++; i++; continue; }
    if(c==="]"){ bracket=Math.max(0,bracket-1); i++; continue; }
    if(c==="{"){ brace++; i++; continue; }
    if(c==="}"){ brace=Math.max(0,brace-1); i++; continue; }
    if(c==="<"){ angle++; i++; continue; }
    if(c===">" && angle>0){ angle--; i++; continue; }
    if(paren===0 && bracket===0 && brace===0 && angle===0 && /[A-Za-z0-9_]/.test(c)){
      const start=i++;
      while(i<typeText.length && /[A-Za-z0-9_]/.test(typeText[i])) i++;
      words.push({start,end:i,text:typeText.slice(start,i)});
      continue;
    }
    i++;
  }
  for(let i=1;i<words.length;i++){
    const a=words[i-1], b=words[i];
    if(!/^\s*$/.test(typeText.slice(a.end,b.start))) continue;
    const ampMut=a.text==="mut" && ((i>=2 && words[i-2].text==="borrow") || typeText.slice(0,a.start).trimEnd().endsWith("&"));
    const legal=a.text==="type" || a.text==="borrow" || ampMut || (a.text==="typeof" && b.text==="fnc");
    if(!legal) return true;
  }
  return false;
}

function classifyV2Callable(source){
  const lines=visibleSource(source).split(/\r?\n/);
  const headerIndex=lines.findIndex(line=>line.trim().length>0);
  if(headerIndex<0) return false;
  const header=lines[headerIndex];
  if(!/\b(fnc|routine)\b/.test(header)) return false;

  const close=header.indexOf(")");
  if(close<0) return false;
  let tail=header.slice(close+1).trimStart();

  if(tail.startsWith(":")) return false;
  if(!tail.startsWith("->")) return false;
  tail=tail.slice(2);

  const asMatch=/\bas\b/.exec(tail);
  const colonAt=tail.indexOf("::");
  const candidates=[];
  if(asMatch) candidates.push({start:asMatch.index,end:asMatch.index+2});
  if(colonAt>=0) candidates.push({start:colonAt,end:colonAt+2});
  candidates.sort((a,b)=>a.start-b.start);

  if(candidates.length){
    const sep=candidates[0];
    const typeText=tail.slice(0,sep.start).trim();
    if(!typeText || hasAmbiguousBareWords(typeText)) return false;
    const body=tail.slice(sep.end).trimStart();
    if(/^as\b/.test(body) || body.startsWith("::")) return false;
    return true;
  }

  if(/\b(return|if|do|select|match|switch|let|const|val|await|spawn|throw|raise|panic)\b/.test(tail)){
    return false;
  }

  const next=lines.slice(headerIndex+1).find(line=>line.trim().length>0)?.trimStart() ?? "";
  if(/^as\b/.test(next) || next.startsWith("::")) return false;
  return true;
}

test("v2 callable separator reference vectors",()=>{
  assert.ok(Array.isArray(manifest.referenceVectors));
  assert.equal(manifest.referenceVectors.length,18);
  let accepted=0;
  let rejected=0;
  for(const vector of manifest.referenceVectors){
    const actual=classifyV2Callable(vector.source);
    assert.equal(actual,vector.accepted,vector.id);
    if(actual) accepted++; else rejected++;
  }
  assert.equal(accepted,8);
  assert.equal(rejected,10);
});
