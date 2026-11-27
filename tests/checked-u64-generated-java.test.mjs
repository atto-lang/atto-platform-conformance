import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const PIN='02037fb8fd3b4056fc9eab4d75b51e95d03dd65b';
const mode=process.env.ATTO_U64_GENERATED_JAVA_REQUIRED;
assert.ok(mode===undefined||mode==='0'||mode==='1','ATTO_U64_GENERATED_JAVA_REQUIRED must be 0 or 1');
const path=process.env.ATTO_U64_JAVA_SOURCE;
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const MAX=(1n<<64n)-1n;
const M=0xffffffffn;
let state=0x9e3779b97f4a7c15n;
function next(){state^=(state<<13n)&MAX;state^=state>>7n;state^=(state<<17n)&MAX;return state;}
const checked=n=>n<0n||n>MAX?null:n;
const cases=[];
for(let i=0;i<256;i++){
  const a=next(),b=next(),c=next();
  const x=a&M,y=b&M;
  cases.push({family:'add',expr:`op(${a},${i%2===0?MAX-a:b})`,op:'+',expected:checked(a+(i%2===0?MAX-a:b))});
  cases.push({family:'subtract',expr:`op(${a},${i%2===0?a:b})`,op:'-',expected:checked(a-(i%2===0?a:b))});
  cases.push({family:'multiply',expr:`op(${i%2===0?x:a},${i%2===0?y:b})`,op:'*',expected:checked((i%2===0?x:a)*(i%2===0?y:b))});
  const p=checked(x*y),q=checked(p+c);
  cases.push({family:'intermediate',expr:`first(42,op(${x},${y})+${c})`,op:'*',expected:q===null?null:42n});
}
const driver=String.raw`
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.lang.reflect.InvocationTargetException;
import java.util.*;
import javax.tools.ToolProvider;
public class GuestDriver {
  public static void main(String[] args) throws Exception {
    var rows=Files.readAllLines(Path.of("cases.tsv"),StandardCharsets.US_ASCII);
    if(rows.size()!=256) throw new AssertionError("case count");
    if(args[0].equals("compile")) {
      var compilerArgs=new ArrayList<String>();
      compilerArgs.add("-d"); compilerArgs.add(".");
      for(int i=0;i<rows.size();i++) {
        var fields=rows.get(i).split("\\t",2);
        var captured=new ByteArrayOutputStream();
        var in=System.in;var out=System.out;
        try {
          System.setIn(new ByteArrayInputStream(fields[1].getBytes(StandardCharsets.US_ASCII)));
          System.setOut(new PrintStream(captured,true,StandardCharsets.UTF_8));
          CheckedU64.main(new String[0]);
        } finally {System.setIn(in);System.setOut(out);}
        String generated=captured.toString(StandardCharsets.UTF_8);
        String marker="public final class AttoGuest {";
        if(generated.indexOf(marker)<0||generated.indexOf(marker)!=generated.lastIndexOf(marker))throw new AssertionError("class marker");
        String name="Guest"+i;
        // Only the class declaration is renamed; emitted method bodies are untouched.
        Path file=Path.of(name+".java");
        Files.writeString(file,generated.replace(marker,"public final class "+name+" {"));
        compilerArgs.add(file.toString());
      }
      if(ToolProvider.getSystemJavaCompiler().run(null,null,null,compilerArgs.toArray(String[]::new))!=0)throw new AssertionError("javac failed");
      return;
    }
    if(!args[0].equals("execute"))throw new AssertionError("driver mode");
    int values=0,faults=0;
    for(int i=0;i<rows.size();i++) {
      String expected=rows.get(i).split("\\t",2)[0];
      var guest=Class.forName("Guest"+i).getMethod("guest");
      try {
        String actual=Long.toUnsignedString((Long)guest.invoke(null));
        if(!expected.equals(actual))throw new AssertionError(i+": "+expected+" != "+actual);
        values++;
      } catch(InvocationTargetException e) {
        if(!expected.equals("overflow")||e.getCause().getClass()!=ArithmeticException.class||!"E_U64_OVERFLOW".equals(e.getCause().getMessage()))throw e;
        faults++;
      }
    }
    if(values+faults!=256||values==0||faults==0)throw new AssertionError("coverage");
    System.out.println(values+" "+faults);
  }
}`;
const family=process.env.ATTO_U64_JAVA_FAMILY;
const families=['add','subtract','multiply','intermediate'];
assert.ok(family===undefined||families.includes(family),'invalid generated Java family');
test('exact generated Java JVM guest corpus',{timeout:180000,skip:!path&&mode!=='1'?'NOT_EXECUTED: exact Java compiler source unavailable':false},async t=>{
  assert.ok(path,'ATTO_U64_JAVA_SOURCE required');const bytes=readFileSync(resolve(path));assert.equal(blob(bytes),PIN);
  const root=mkdtempSync(join(tmpdir(),'atto-java-generated-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'CheckedU64.java'),bytes);writeFileSync(join(root,'GuestDriver.java'),driver);
  const run=(cmd,args,cwd=root)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:90000,maxBuffer:1024*1024});assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');return r.stdout;};
  const javac=process.env.JAVAC??'javac',java=process.env.JAVA??'java';
  run(javac,['CheckedU64.java','GuestDriver.java']);
  for(const selected of family===undefined?families:[family])await t.test(selected,()=>{
    const rows=cases.filter(x=>x.family===selected);
    writeFileSync(join(root,'cases.tsv'),rows.map(row=>`${row.expected??'overflow'}\tpub fnc main():uint{return ${row.expr};} fnc op(u64 a,uint b):u64{return a${row.op}b;} fnc first(uint a,u64 b):uint{return a;}`).join('\n')+'\n');
    run(java,['GuestDriver','compile']);
    const values=rows.filter(row=>row.expected!==null).length,faults=256-values;
    for(const flags of [[],['-Xint']])assert.equal(run(java,[...flags,'GuestDriver','execute']),`${values} ${faults}\n`);
    console.log(`${selected}: ${values} values, ${faults} expected faults, default JVM and -Xint`);
  });
  assert.equal(blob(readFileSync(resolve(path))),PIN);
});
