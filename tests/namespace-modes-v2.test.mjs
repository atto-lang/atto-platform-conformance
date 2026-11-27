import test from 'node:test';
import {readFileSync} from 'node:fs';

function check(doc) {
  const eq=(a,b,where)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(where+": "+JSON.stringify(a)+" != "+JSON.stringify(b))};
  const err=(code)=>{throw Error(code)};
  const ident=x=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(x)&&!["self","super","parent","pkg","shared","default","file","folder","namespace"].includes(x)&&!x.startsWith("__atto_");
  function resolveMode(path,header){
    if(!header||header==="use file namespace;"||header==="use default namespace;")return {scope:["FILE",path]};
    if((header.match(/\buse\s+(?:default\s+|file\s+|folder\s+)?namespace\b/g)||[]).length>1)err("E_DUPLICATE");
    if(!header.startsWith("use "))err("E_SYNTAX");
    const named=/^use namespace ([A-Za-z_][\w.]*)\;$/.exec(header);
    if(named){if(!named[1].split(".").every(ident))err("E_SYNTAX");return {scope:["NAMED",named[1]]}}
    const depth=/^use default namespace\((-?\d+)\);$/.exec(header);
    if(header!=="use folder namespace;"&&!depth)err("E_SYNTAX");
    if(typeof path!=="string"||path.includes("\\")||path.includes(":")||path.split("/").some(x=>!x||x==="."||x==="..")||!path.endsWith(".atto")||path.split("/").at(-1)===".atto")err("E_NAMESPACE_PATH");
    const parts=path.split("/").slice(0,-1);
    if(!depth)return {scope:["FOLDER",parts.join("/")]};
    const n=Number(depth[1]);if(!Number.isSafeInteger(n)||n<1||n>32||n>parts.length)err("E_NAMESPACE_DEPTH");
    const suffix=parts.slice(-n);if(!suffix.every(ident))err("E_NAMESPACE_PATH");
    return {scope:["NAMED",suffix.join(".")]};
  }
  function parent(current,reference){
    const [root,...rest]=reference.split(".");
    const up=x=>x==="parent"||x==="super";
    let base=[];
    if(root!=="pkg"){if(root!=="self"&&!up(root)||!current)err("E_IMPORT_PATH");base=current.split(".");if(!base.every(ident)||base.length>8)err("E_IMPORT_PATH");}
    let count=0;if(up(root)){count=1;while(up(rest[0])){rest.shift();count++;}if(count>base.length)err("E_IMPORT_PATH");base=base.slice(0,base.length-count);}
    if(!rest.length||!rest.every(ident)||base.length+rest.length>8||reference.split(".").length>8)err("E_IMPORT_PATH");
    return {target:[...base,...rest].join(".")};
  }
  eq(doc.status,"CORPUS_ONLY_NOT_BACKEND_EXECUTION","status");
  const cases=[...doc.modes,...doc.parents,...doc.guests];
  eq(new Set(cases.map(c=>c.id)).size,cases.length,"unique IDs");
  for(const c of doc.modes){let got;try{got=resolveMode(c.path,c.header)}catch(e){got={diagnostic:e.message}}eq(got,c.expect,c.id)}
  for(const c of doc.parents){let got;try{got=parent(c.current,c.reference)}catch(e){got={diagnostic:e.message}}eq(got,c.expect,c.id)}
  // Verify the source fixture memberships independently; this is not parsing
  // class bodies or executing an Atto guest.
  for(const c of doc.guests){
    if(!Object.hasOwn(c.files,c.entry))throw Error(c.id+" missing entry");
    let owner=null,owners=0,methods=0,foreign=false;
    const parsed=Object.entries(c.files).map(([path,src])=>{
      const head=/^use [^\n;]+(?:\([^)]*\))?;/.exec(src)?.[0]??"";
      return {src,key:JSON.stringify(resolveMode(path,head).scope)};
    });
    for(const unit of parsed)if(unit.src.includes("declare")&&/\bclass Foo;/.test(unit.src)){owner=unit.key;owners++;}
    for(const unit of parsed)if(unit.src.includes("mtd (Foo)")){if(unit.key===owner)methods++;else foreign=true}
    const good=owners===1&&methods===1&&!foreign;
    eq(good,c.expect.outcome==="return",c.id);
    if(!good)eq(c.expect.noExecutable,true,c.id+" negative gate");
  }
  return {scopeCases:doc.modes.length,parentCases:doc.parents.length,fixtureMembershipCases:doc.guests.length};
}

test('namespace v2 reference identities and fixture membership (host only)', () => {
  check(JSON.parse(readFileSync(new URL('../fixtures/namespace-modes-v2/cases.json', import.meta.url),'utf8')));
});
