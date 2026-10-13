/**
 * Fixture-integrity scanner ONLY. This does not parse/typecheck Oreslang or
 * establish that a backend supports the proposed actor reply syntax.
 *
 * Unlike a source-text regexp, it ignores strings and comments, balances
 * each branch's braces, and verifies terminal actor delivery operations.
 */
export function fixtureTokens(source) {
 if(typeof source!=="string")throw Error("fixture source must be text");
 const tokens=[];
 let i=0;
 while(i<source.length){
  const c=source[i],next=source[i+1];
  if(/\s/.test(c)){i++;continue}
  if(c==="/"&&next==="/"){
   i+=2;while(i<source.length&&source[i]!=="\n")i++;
   continue;
  }
  if(c==="/"&&next==="*"){
   i+=2;const end=source.indexOf("*/",i);
   if(end<0)throw Error("unterminated fixture comment");
   i=end+2;continue;
  }
  if(c==='"'||c==="'"){
   const quote=c;
   i++;let closed=false;
   while(i<source.length){
    if(source[i]==="\\"){i+=2;continue}
    if(source[i]===quote){i++;closed=true;break}
    i++;
   }
   if(!closed)throw Error("unterminated fixture string");
   tokens.push("<string>");continue;
  }
  if(/[A-Za-z_]/.test(c)){
   const start=i++;
   while(i<source.length&&/[A-Za-z0-9_]/.test(source[i]))i++;
   tokens.push(source.slice(start,i));continue;
  }
  tokens.push(c);i++;
 }
 return tokens;
}
function block(tokens,open){
 if(tokens[open]!=="{")throw Error("expected actor block");
 let depth=0;
 for(let i=open;i<tokens.length;i++){
  if(tokens[i]==="{")depth++;
  if(tokens[i]==="}"&&!--depth)return {body:tokens.slice(open+1,i),end:i+1};
 }
 throw Error("unclosed actor block");
}
function countCall(tokens,name){
 let total=0,last=-1;
 for(let i=0;i+3<tokens.length;i++){
  if(tokens[i]==="self"&&tokens[i+1]==="."&&tokens[i+2]===name&&tokens[i+3]==="("){
   total++;last=i;
  }
 }
 return {total,last};
}
function assertTerminalDone(body,variant){
 const done=countCall(body,"done");
 if(done.total!==1)throw Error(variant+" must call self.done() exactly once");
 const tail=body.slice(done.last);
 if(tail.join(" ")!=="self . done ( ) ;")
  throw Error(variant+" must end with self.done()");
 const responses=countCall(body,"respond");
 if(variant==="Compute"&&responses.total!==1)
  throw Error("Compute must call self.respond() exactly once");
 if(variant==="Result"&&responses.total!==0)
  throw Error("Result one-way branch cannot respond");
 if(variant==="Compute"&&body.slice(responses.last,responses.last+8).join(" ")!==
     "self . respond ( Message . Result (")
  throw Error("Compute must respond with Message.Result");
 for(const operation of ["forward","send","end"]){
  if(countCall(body,operation).total)throw Error("canonical fixture contains unexpected self."+operation);
 }
 if(body.includes("return"))throw Error("void receive cannot return from a match arm");
}
/**
 * Assert the canonical fixture has exactly one receive(Message m): void,
 * whose only body statement is procedural do match and whose Compute/Result
 * branches each complete their delivery exactly once.
 */
export function assertCanonicalActorReceive(source) {
 const tokens=fixtureTokens(source);
 // This is a single canonical actor source fixture. A hidden second receiver
 // with a different type must not evade the exact signature check below.
 const receiveNames=tokens.filter((x,i)=>x==="receive"&&tokens[i+1]==="(").length;
 if(receiveNames!==1)throw Error("canonical actor must declare exactly one receive");
 const starts=[];
 for(let i=0;i+7<tokens.length;i++){
  if(tokens.slice(i,i+8).join(" ")==="receive ( Message m ) : void {")
   starts.push(i+7);
 }
 if(starts.length!==1)throw Error("expected one typed receive(Message m): void block");
 const receive=block(tokens,starts[0]).body;
 if(receive.slice(0,5).join(" ")!=="do match m over {")
  throw Error("receive must begin with procedural do match");
 const dispatched=block(receive,4);
 if(dispatched.end!==receive.length)
  throw Error("receive has unexpected statements after do match");
 const names=[];
 let i=0;
 const match=dispatched.body;
 while(i<match.length){
  if(match.slice(i,i+4).join(" ")!=="on Message . "+match[i+3])
   throw Error("expected typed on Message.Variant arm");
  const variant=match[i+3];
  if(variant!=="Compute"&&variant!=="Result")throw Error("unknown actor match arm");
  i+=4;
  if(match.slice(i,i+7).join(" ")!=="as ( text , n ) {")
   throw Error("expected destructured actor variant arm");
  const arm=block(match,i+6);
  assertTerminalDone(arm.body,variant);
  names.push(variant);
  i=arm.end;
 }
 if(names.join(",")!=="Compute,Result")
  throw Error("canonical actor must exhaust Compute and Result in order");
 return true;
}
