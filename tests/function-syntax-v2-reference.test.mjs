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


function normalizeHeaderTypeSource(text){
  let out="",quote=null,escape=false,block=0;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(block){
      if(c==="/"&&n==="*"){block++;i++;continue;}
      if(c==="*"&&n==="/"){block--;out+=" ";i++;continue;}
      continue;
    }
    if(quote!==null){
      if(escape){escape=false;continue;}
      if(c==="\\"){escape=true;continue;}
      if(c===quote){quote=null;continue;}
      continue;
    }
    if(c==="/"&&n==="/") break;
    if(c==="/"&&n==="*"){block=1;out+=" ";i++;continue;}
    if(c==="\""||c==="'"||c==="\`"){out+="__ores_literal_type__";quote=c;continue;}
    out+=c;
  }
  return block===0&&quote===null ? out : null;
}

function typeDelimitersBalanced(text){
  const stack=[];
  let previous=null;
  for(const c of text){
    if(c==="("||c==="["||c==="{"||c==="<") stack.push(c);
    else if(c===")"){ if(stack.pop()!=="(") return false; }
    else if(c==="]"){ if(stack.pop()!=="[") return false; }
    else if(c==="}"){ if(stack.pop()!=="{") return false; }
    else if(c===">"){
      if(stack.at(-1)==="<") stack.pop();
      else if(previous!=="=") return false;
    }
    previous=c;
  }
  return stack.length===0;
}

function topLevelTypeChunks(text){
  const chunks=[];
  let start=null, paren=0, bracket=0, brace=0, angle=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    const top=paren===0&&bracket===0&&brace===0&&angle===0;
    if(/\s/.test(c)&&top){
      if(start!==null){ chunks.push(text.slice(start,i)); start=null; }
      continue;
    }
    if(start===null) start=i;
    if(c==="(") paren++;
    else if(c===")") paren=Math.max(0,paren-1);
    else if(c==="[") bracket++;
    else if(c==="]") bracket=Math.max(0,bracket-1);
    else if(c==="{") brace++;
    else if(c==="}") brace=Math.max(0,brace-1);
    else if(c==="<") angle++;
    else if(c===">"&&angle>0) angle--;
  }
  if(start!==null) chunks.push(text.slice(start));
  return chunks;
}

function parseTypeChunks(chunks,state){
  if(!parseTypeAtomChunks(chunks,state)) return false;
  while(state.i<chunks.length&&chunks[state.i]==="|"){
    state.i++;
    if(!parseTypeAtomChunks(chunks,state)) return false;
  }
  return true;
}

function parseTypeAtomChunks(chunks,state){
  if(state.i>=chunks.length) return false;
  const token=chunks[state.i];

  if(token==="!"||token==="type"){
    state.i++;
    return parseTypeAtomChunks(chunks,state);
  }
  if(token==="borrow"||token==="&"||token==="&mut"){
    const prefix=token;
    state.i++;
    if(prefix!=="&mut"&&state.i<chunks.length&&chunks[state.i]==="mut") state.i++;
    return parseTypeAtomChunks(chunks,state);
  }
  if(token==="tuple"){
    state.i++;
    if(state.i>=chunks.length||!chunks[state.i].startsWith("(")) return false;
    state.i++;
    return true;
  }
  if(token==="struct"||token==="record"){
    state.i++;
    if(state.i>=chunks.length||!chunks[state.i].startsWith("{")) return false;
    state.i++;
    return true;
  }
  if(token==="typeof"){
    state.i++;
    if(state.i>=chunks.length) return false;
    if(chunks[state.i]==="fnc"){
      state.i++;
      if(state.i>=chunks.length||!chunks[state.i].startsWith("(")) return false;
      state.i++;
    }else if(chunks[state.i].startsWith("fnc(")){
      state.i++;
    }else return false;
    if(state.i>=chunks.length||chunks[state.i]!=="=>") return false;
    state.i++;
    return parseTypeChunks(chunks,state);
  }
  if(token==="|"||token==="=>"||token==="."||token==="mut") return false;

  const first=chunks[state.i++];
  if(first.startsWith("(")&&state.i<chunks.length&&chunks[state.i]==="=>"){
    state.i++;
    return parseTypeChunks(chunks,state);
  }
  while(state.i+1<chunks.length&&chunks[state.i]===".") state.i+=2;
  while(state.i<chunks.length&&(chunks[state.i].startsWith("<")||chunks[state.i].startsWith("["))) state.i++;
  return true;
}

function isCompleteTypePrefix(text){
  const normalized=normalizeHeaderTypeSource(text);
  if(normalized===null || normalized.includes(";")) return false;
  const typeSource=normalized.trim();
  if(!typeDelimitersBalanced(typeSource)) return false;
  const chunks=topLevelTypeChunks(typeSource);
  if(chunks.length===0) return false;
  const state={i:0};
  return parseTypeChunks(chunks,state)&&state.i===chunks.length;
}

function classifyV2Callable(source){
  const rawLines=source.split(/\r?\n/);
  const lines=visibleSource(source).split(/\r?\n/);
  const headerIndex=lines.findIndex(line=>line.trim().length>0);
  if(headerIndex<0) return false;
  const header=lines[headerIndex];
  const rawHeader=rawLines[headerIndex];
  if(!/\b(fnc|routine)\b/.test(header)) return false;

  const close=header.indexOf(")");
  if(close<0) return false;
  let tail=header.slice(close+1).trimStart();
  let rawTail=rawHeader.slice(close+1).trimStart();

  if(tail.startsWith(":")) return false;
  if(!tail.startsWith("->") || !rawTail.startsWith("->")) return false;
  tail=tail.slice(2);
  rawTail=rawTail.slice(2);

  const asMatch=/\bas\b/.exec(tail);
  const colonAt=tail.indexOf("::");
  const candidates=[];
  if(asMatch) candidates.push({start:asMatch.index,end:asMatch.index+2});
  if(colonAt>=0) candidates.push({start:colonAt,end:colonAt+2});
  candidates.sort((a,b)=>a.start-b.start);

  if(candidates.length){
    const sep=candidates[0];
    const typeText=rawTail.slice(0,sep.start).trim();
    if(!isCompleteTypePrefix(typeText)) return false;
    const body=tail.slice(sep.end).trimStart();
    if(/^as\b/.test(body) || body.startsWith(":")) return false;
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
  assert.equal(manifest.referenceVectors.length,33);
  let accepted=0;
  let rejected=0;
  for(const vector of manifest.referenceVectors){
    const actual=classifyV2Callable(vector.source);
    assert.equal(actual,vector.accepted,vector.id);
    if(actual) accepted++; else rejected++;
  }
  assert.equal(accepted,14);
  assert.equal(rejected,19);
});
