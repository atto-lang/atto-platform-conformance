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
  test("physical retirement waits for every live receive",()=>{let a=model();a.admit("a",4);a.admit("b",4);a.fault("stack_quota");eq(a.retire(),false);eq(a.notice(),false);eq(a.restart(),false);eq(a.finish("a"),true);eq(a.retire(),false);eq(a.finish("b"),true);eq(a.retire(),true);eq(a.snapshot().used,0)});
  test("cleanup failure cannot mask original cause",()=>{let a=model();a.fault("stack_quota");eq(a.cleanupFailed(),true);eq(a.snapshot().primary,"stack_quota");eq(a.snapshot().incomplete,true)});
  test("full DATA and arena quota do not block reserved terminal notice",()=>{let a=model();a.fillData();a.admit("x",8);a.fault("arena_quota");a.finish("x");a.retire();eq(a.snapshot().dataFull,true);eq(a.notice(),true);eq(a.notice(),false)});
  test("duplicate completion and stale generation are rejected",()=>{let a=model();a.admit("x",1);a.fault("arena_quota");eq(a.finish("x",1),true);eq(a.finish("x",1),false);a.retire();a.notice();a.restart();a.admit("x",1);eq(a.finish("x",1),false);eq(a.snapshot().used,1);eq(a.finish("x",2),true)});
  test("restart only after terminal publication, new generation and bounded credit",()=>{let a=model();a.fault("stack_quota");a.retire();eq(a.restart(),false);a.notice();eq(a.restart(),true);eq(a.snapshot().generation,2);a.fault("stack_quota");a.retire();a.notice();eq(a.restart(),false)});
  test("reference model cannot certify physical isolation",()=>{let a=model();eq(a.snapshot().certified,false);a.fault("stack_quota");a.retire();a.notice();eq(a.snapshot().certified,false)});
}
suite(test, assert.equal, model);
