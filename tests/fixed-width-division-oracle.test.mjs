import test from 'node:test';
import assert from 'node:assert/strict';

// Proposed mathematical quotient/remainder contract, not a compiler test.
// No assumption about source syntax or portable guest error ABI.
function restoring(a,b,width) {
  let q=0n,r=0n;
  for(let i=width-1n;i>=0n;i--) {
    r=(r<<1n)|((a>>i)&1n);
    if(r>=b){r-=b;q|=1n<<i;}
  }
  return [q,r];
}
function candidate(a,b,width,lo,hi) {
  if(b===0n)return {fault:'division_by_zero'};
  const [uq,ur]=restoring(a<0n?-a:a,b<0n?-b:b,width);
  const q=(a<0n)!==(b<0n)?-uq:uq;
  if(q<lo||q>hi)return {fault:'quotient_overflow'};
  const r=a<0n?-ur:ur;
  return {q,r,mod:r<0n?r+(b<0n?-b:b):r};
}
function reference(a,b,lo,hi) {
  if(b===0n)return {fault:'division_by_zero'};
  const q=a/b;
  if(q<lo||q>hi)return {fault:'quotient_overflow'};
  const r=a%b,m=b<0n?-b:b;
  return {q,r,mod:(r+m)%m};
}
for(const signed of [false,true])for(const width of [8n,16n,32n,64n]){
  test(`${signed?'i':'u'}${width}: division and remainder mathematical contract`,()=>{
    const top=1n<<(signed?width-1n:width),lo=signed?-top:0n,hi=top-1n;
    const edges=[...new Set([lo,lo+1n,lo+2n,-2n,-1n,0n,1n,2n,hi/2n,hi-2n,hi-1n,hi].filter(v=>v>=lo&&v<=hi))];
    let count=0,zero=0,overflow=0,values=0;
    const check=(a,b)=>{
      const got=candidate(a,b,width,lo,hi),want=reference(a,b,lo,hi);
      assert.deepEqual(got,want,`${a} / ${b}`);count++;
      if(got.fault==='division_by_zero'){zero++;return;}
      if(got.fault==='quotient_overflow'){overflow++;return;}
      values++;assert.equal(got.q*b+got.r,a);
      const m=b<0n?-b:b;
      assert.ok(got.r>-m&&got.r<m&&got.mod>=0n&&got.mod<m);
      assert.ok(got.r===0n||(got.r<0n)===(a<0n));
    };
    if(width===8n){for(let a=lo;a<=hi;a++)for(let b=lo;b<=hi;b++)check(a,b);assert.equal(count,65536);}
    else {
      for(const a of edges)for(const b of edges)check(a,b);
      let state=0x9e3779b97f4a7c15n;const mask=(1n<<64n)-1n;
      const next=()=>{state^=(state<<13n)&mask;state^=state>>7n;state^=(state<<17n)&mask;return state;};
      const operand=()=>{const n=next();return n&1n?edges[Number((n>>1n)%BigInt(edges.length))]:lo+((n>>1n^next())&((1n<<width)-1n));};
      for(let i=0;i<10000;i++)check(operand(),operand());
      assert.equal(count,edges.length**2+10000);
    }
    assert.ok(zero>0&&values>0);assert.equal(overflow>0,signed);
    console.log(`${signed?'i':'u'}${width}: ${count} pairs; ${values} values, ${zero} zero divisors, ${overflow} quotient overflows`);
  });
}
