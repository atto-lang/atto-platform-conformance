import test from 'node:test';
import assert from 'node:assert/strict';
import { model } from '../src/actor-resilience-lifecycle-v1.mjs';
function suite(test,eq,model){
  test("admission needs a reserved receipt",()=>{let a=model({receipt:false});eq(a.admit("x",1),false);eq(a.snapshot().state,"rejected")});
  test("handled checked arithmetic does not poison actor",()=>{let a=model();eq(a.checkedError(),"Err");eq(a.snapshot().state,"running");eq(a.snapshot().published,false)});
  test("exact fit and one-over are atomic",()=>{let a=model();eq(a.admit("a",8),true);eq(a.admit("b",1),false);eq(a.snapshot().used,8);eq(a.snapshot().live,1)});
  test("suspension retains aggregate charge",()=>{let a=model();eq(a.admit("a",5),true);eq(a.suspend("a"),true);eq(a.admit("b",4),false);eq(a.admit("b",3),true);eq(a.snapshot().used,8)});
  test("bad resource sizes do not mutate",()=>{let a=model();for(const n of [0,-1,Infinity,NaN,1.5,Number.MAX_SAFE_INTEGER+1])eq(a.admit("x",n),false);eq(a.snapshot().used,0)});
  test("fault fences fresh receives and checked recovery",()=>{let a=model();eq(a.fault("stack_quota"),true);eq(a.admit("x",1),false);eq(a.checkedError(),null);eq(a.fault("secondary"),false);eq(a.snapshot().primary,"stack_quota")});
  test("physical retirement waits for every live receive",()=>{let a=model();a.admit("a",4);a.admit("b",4);a.fault("stack_quota");eq(a.retire(),false);eq(a.notice(),false);eq(a.restart(),false);eq(a.finish("a",1),true);eq(a.retire(),false);eq(a.finish("b",1),true);eq(a.retire(),true);eq(a.snapshot().used,0)});
  test("cleanup failure cannot mask original cause",()=>{let a=model();a.fault("stack_quota");eq(a.cleanupFailed(),true);eq(a.snapshot().primary,"stack_quota");eq(a.snapshot().incomplete,true)});
  test("full DATA and exhausted arena do not block reserved terminal notice",()=>{let a=model();a.fillData();eq(a.allocate(8),true);eq(a.allocate(1),false);a.admit("x",8);a.fault("arena_quota");a.finish("x",1);eq(a.snapshot().arena,8);a.retire();eq(a.snapshot().arena,0);eq(a.snapshot().dataFull,true);eq(a.notice(),true);eq(a.notice(),false)});
  test("duplicate completion and stale generation are rejected",()=>{let a=model();a.admit("x",1);a.fault("arena_quota");eq(a.finish("x",1),true);eq(a.finish("x",1),false);a.retire();a.notice();a.restart();a.admit("x",1);eq(a.finish("x",1),false);eq(a.snapshot().used,1);eq(a.finish("x",2),true)});
  test("restart only after terminal publication, new generation and bounded credit",()=>{let a=model();a.fault("stack_quota");a.retire();eq(a.restart(),false);a.notice();eq(a.restart(),true);eq(a.snapshot().generation,2);a.fault("stack_quota");a.retire();a.notice();eq(a.restart(),false)});
  test("reference model cannot certify physical isolation",()=>{let a=model();eq(a.snapshot().certified,false);a.fault("stack_quota");a.retire();a.notice();eq(a.snapshot().certified,false)});
  test("invalid configuration rejects admission",()=>{for(const opt of [{limit:NaN},{limit:-1},{arenaLimit:Infinity},{restarts:-1},{restarts:1.2},{receipt:"true"},{unwindReserve:9}]){let a=model(opt);eq(a.snapshot().state,"rejected");eq(a.admit("x",1),false)}});
  test("invocation identity is never reused within a generation",()=>{let a=model();eq(a.admit("x",1),true);eq(a.finish("x",1),true);eq(a.admit("x",1),false);eq(a.finish("x",1),false);eq(a.snapshot().replies,1)});
  test("I/O completion is not physical invocation retirement",()=>{let a=model();a.admit("x",2);eq(a.startIo("io","x"),true);a.fault("stack_quota");eq(a.finish("x",1),false);eq(a.retire(),false);eq(a.finishIo("io",1),true);eq(a.finishIo("io",1),false);eq(a.finish("x",1),true);eq(a.retire(),true)});
  test("I/O identities and generations are fenced",()=>{let a=model();a.admit("x",1);a.startIo("i","x");a.finishIo("i",1);eq(a.startIo("i","x"),false);a.fault("arena_quota");a.finish("x",1);a.retire();a.notice();a.restart();a.admit("x",1);a.startIo("i","x");eq(a.finishIo("i",1),false);eq(a.snapshot().io,1);eq(a.finishIo("i",2),true)});
  test("unwind reserve is charged up front and never replenished on failure",()=>{let a=model({unwindReserve:2});eq(a.admit("x",7),false);eq(a.admit("x",6),true);a.fault("stack_quota");eq(a.cleanup(1),true);eq(a.cleanup(2),false);eq(a.snapshot().reserve,1);eq(a.cleanup(1),false);eq(a.snapshot().primary,"stack_quota");eq(a.snapshot().incomplete,true)});
  test("quarantine cannot fabricate DONE or restart",()=>{let a=model();a.admit("x",1);a.startIo("i","x");a.fault("stack_quota");eq(a.quarantine(),true);eq(a.finishIo("i",1),true);eq(a.finish("x",1),true);eq(a.retire(),false);eq(a.notice(),false);eq(a.restart(),false)});
  test("restart retains queued DATA indication and fresh arena",()=>{let a=model();a.fillData();a.allocate(8);a.fault("arena_quota");a.retire();a.notice();a.restart();eq(a.snapshot().dataFull,true);eq(a.snapshot().arena,0);eq(a.allocate(8),true)});
  test("maximum safe integer arithmetic never wraps",()=>{let a=model({limit:Number.MAX_SAFE_INTEGER,arenaLimit:Number.MAX_SAFE_INTEGER,unwindReserve:1});eq(a.admit("x",Number.MAX_SAFE_INTEGER-1),true);eq(a.admit("y",1),false);eq(a.allocate(Number.MAX_SAFE_INTEGER),true);eq(a.allocate(1),false)});
  test("completion without an explicit incarnation cannot retire current work",()=>{let a=model();a.admit("x",1);a.startIo("io","x");eq(a.finishIo("io"),false);eq(a.finishIo("io",1),true);eq(a.finish("x"),false);eq(a.finish("x",1),true);a.fault("stack_quota");a.retire();a.notice();a.restart();a.admit("x",1);a.startIo("io","x");eq(a.finishIo("io"),false);eq(a.finishIo("io",1),false);eq(a.finishIo("io",2),true);eq(a.finish("x"),false);eq(a.finish("x",1),false);eq(a.snapshot().used,1);eq(a.finish("x",2),true)});
  test("all permutations of two physical completions and retirement preserve terminal ordering",()=>{
    function permutations(xs){return xs.length===0?[[]]:xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>j!==i)).map(rest=>[x,...rest]))}
    for(const steps of permutations(["a","b","retire","notice","restart"])){
      const a=model();a.admit("a",4);a.admit("b",4);a.fault("stack_quota");let retired=false,notified=false,done=0;
      for(const step of steps){
        if(step==="a"||step==="b"){eq(a.finish(step,1),true);done++}
        if(step==="retire"){eq(a.retire(),done===2);retired=done===2}
        if(step==="notice"){eq(a.notice(),retired);notified=retired}
        if(step==="restart")eq(a.restart(),notified);
        eq(a.snapshot().certified,false);
      }
    }
  });
}
suite(test, assert.equal, model);
