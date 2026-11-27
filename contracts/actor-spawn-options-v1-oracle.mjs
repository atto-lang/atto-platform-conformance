// Source-free fixed-cap example-schema oracle; NOT an Atto parser/runtime or a full scheduling implementation.
// No pool authority, ownership, concurrency, allocation, cancellation or guest execution is modeled.
function check(sections, policy) {
  const seen=new Set(); const opts={}; const fail=(code)=>{throw new Error(code)};
  for(const [section,entries] of sections){
    if(!["schedule","resources","init"].includes(section))fail("UNKNOWN_SECTION");
    if(seen.has(section))fail("DUP_SECTION");seen.add(section);const keys=new Set();opts[section]={};
    for(const [key,value] of entries){
      if(keys.has(key))fail("DUP_KEY");keys.add(key);
      if(section==="schedule"){
        if(key==="max_parallelism"){if(!Number.isSafeInteger(value)||value<1||value>policy.max_parallelism)fail("CAP");}
        else if(key==="affinity"){if(!["none","sticky","pinned","dedicated"].includes(value))fail("AFFINITY");}
        else fail("UNKNOWN_KEY");
      } else if(section==="resources"){
        if(!Object.hasOwn(policy.resources,key))fail("UNKNOWN_KEY");
        if(!Number.isSafeInteger(value)||value<1||value>policy.resources[key])fail("QUOTA");
      } else {
        if(!Object.hasOwn(policy.init,key))fail("UNKNOWN_KEY");
        if(typeof value!==policy.init[key]||(typeof value==="number"&&!Number.isSafeInteger(value)))fail("TYPE");
      }
      opts[section][key]=value;
    }
  }
  for(const key of Object.keys(policy.init))if(!Object.hasOwn(opts.init||{},key))fail("REQUIRED");
  const parallel=opts.schedule?.max_parallelism??policy.max_parallelism;
  if(policy.serial&&parallel!==1)fail("SERIAL");
  if(["pinned","dedicated"].includes(opts.schedule?.affinity)&&parallel!==1)fail("AFFINITY_CAP");
  return opts;
}
const p={
  "max_parallelism": 4,
  "serial": false,
  "resources": {
    "heap_size": 67108864,
    "stack_size": 65536,
    "mailbox_capacity": 1024
  },
  "init": {
    "name": "string",
    "seed": "number"
  }
};
const cases=[
  [
    "canonical",
    [
      [
        "schedule",
        [
          [
            "max_parallelism",
            2
          ],
          [
            "affinity",
            "sticky"
          ]
        ]
      ],
      [
        "resources",
        [
          [
            "heap_size",
            67108864
          ],
          [
            "stack_size",
            65536
          ],
          [
            "mailbox_capacity",
            1024
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    null
  ],
  [
    "init only",
    [
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    null
  ],
  [
    "empty optional sections",
    [
      [
        "schedule",
        []
      ],
      [
        "resources",
        []
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    null
  ],
  [
    "empty when no init",
    [],
    null,
    {
      "max_parallelism": 4,
      "serial": false,
      "resources": {
        "heap_size": 67108864,
        "stack_size": 65536,
        "mailbox_capacity": 1024
      },
      "init": {}
    }
  ],
  [
    "unknown section",
    [
      [
        "security",
        []
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "UNKNOWN_SECTION"
  ],
  [
    "duplicate section",
    [
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "DUP_SECTION"
  ],
  [
    "duplicate resource",
    [
      [
        "resources",
        [
          [
            "heap_size",
            1
          ],
          [
            "heap_size",
            2
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "DUP_KEY"
  ],
  [
    "unknown resource",
    [
      [
        "resources",
        [
          [
            "heap_bytes",
            1
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "UNKNOWN_KEY"
  ],
  [
    "zero stack",
    [
      [
        "resources",
        [
          [
            "stack_size",
            0
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "QUOTA"
  ],
  [
    "negative heap",
    [
      [
        "resources",
        [
          [
            "heap_size",
            -1
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "QUOTA"
  ],
  [
    "excess mailbox",
    [
      [
        "resources",
        [
          [
            "mailbox_capacity",
            1025
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "QUOTA"
  ],
  [
    "unsafe integer",
    [
      [
        "resources",
        [
          [
            "heap_size",
            9007199254740992
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "QUOTA"
  ],
  [
    "fractional",
    [
      [
        "resources",
        [
          [
            "stack_size",
            1.5
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "QUOTA"
  ],
  [
    "cap escalation",
    [
      [
        "schedule",
        [
          [
            "max_parallelism",
            5
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "CAP"
  ],
  [
    "serial escalation",
    [
      [
        "schedule",
        [
          [
            "max_parallelism",
            2
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "SERIAL",
    {
      "max_parallelism": 4,
      "serial": true,
      "resources": {
        "heap_size": 67108864,
        "stack_size": 65536,
        "mailbox_capacity": 1024
      },
      "init": {
        "name": "string",
        "seed": "number"
      }
    }
  ],
  [
    "unknown affinity",
    [
      [
        "schedule",
        [
          [
            "affinity",
            "arbitrary"
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "AFFINITY"
  ],
  [
    "pinned parallel",
    [
      [
        "schedule",
        [
          [
            "max_parallelism",
            2
          ],
          [
            "affinity",
            "pinned"
          ]
        ]
      ],
      [
        "init",
        [
          [
            "name",
            "worker-1"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "AFFINITY_CAP"
  ],
  [
    "missing init",
    [],
    "REQUIRED"
  ],
  [
    "wrong type",
    [
      [
        "init",
        [
          [
            "name",
            "x"
          ],
          [
            "seed",
            "42"
          ]
        ]
      ]
    ],
    "TYPE"
  ],
  [
    "unknown init key",
    [
      [
        "init",
        [
          [
            "name",
            "x"
          ],
          [
            "seed",
            42
          ],
          [
            "raw",
            1
          ]
        ]
      ]
    ],
    "UNKNOWN_KEY"
  ],
  [
    "duplicate init key",
    [
      [
        "init",
        [
          [
            "name",
            "x"
          ],
          [
            "name",
            "y"
          ],
          [
            "seed",
            42
          ]
        ]
      ]
    ],
    "DUP_KEY"
  ]
];
function run(check,cases,p){let passed=0;for(const [name,sections,want,policy] of cases){let got=null;try{check(sections,policy??p)}catch(e){got=e.message}if(got!==want)throw new Error(name+": "+got+" != "+want);passed++}return passed}
console.log('source-free cases passed:',run(check,cases,p));


// Sequential logical-lease oracle only: no real scheduler, threads or memory.
// stop fences new work; release requires settled init and receive leases.
// Physical task/FFI/allocator quiescence remains a separate runtime obligation.
function lifecycle(limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw Error("QUOTA");
  let used=0, generation=0;
  const actors=new Map();
  const lookup=ref=>actors.get(ref);
  function admit(charge,payload) {
    if(!Number.isSafeInteger(charge)||charge<=0||charge>limit-used)throw Error("QUOTA");
    if(generation===Number.MAX_SAFE_INTEGER)throw Error("GENERATION_EXHAUSTED");
    const ref=Object.freeze({generation:++generation});
    used+=charge;
    actors.set(ref,{charge,payload,phase:"initializing",started:false,taken:false,init:null,receives:new Set()});
    return ref;
  }
  function begin(ref) {
    const a=lookup(ref);
    if(!a||a.phase!=="initializing"||a.started)throw Error("INIT_AUTHORITY");
    a.started=true;
    a.init=Object.freeze({ref});
    return a.init;
  }
  function take(lease) {
    const a=lookup(lease?.ref);
    if(!a||a.init!==lease||a.phase!=="initializing"||a.taken)throw Error("INIT_AUTHORITY");
    a.taken=true;const payload=a.payload;a.payload=undefined;return payload;
  }
  function settle(lease,success) {
    const a=lookup(lease?.ref);
    if(!a||a.init!==lease||typeof success!=="boolean")throw Error("INIT_AUTHORITY");
    a.init=null;a.payload=undefined;
    if(!success||a.phase==="retiring"){a.phase="retiring";return false;}
    a.phase="ready";return true;
  }
  function stop(ref) {
    const a=lookup(ref);
    if(!a||a.phase==="retiring")return false;
    a.phase="retiring";return true;
  }
  function receive(ref) {
    const a=lookup(ref);
    return !!a&&a.phase==="ready";
  }
  function enter(ref) {
    const a=lookup(ref);
    if(!a||a.phase!=="ready")return null;
    const lease=Object.freeze({ref});
    a.receives.add(lease);return lease;
  }
  function leave(lease) {
    const a=lookup(lease?.ref);
    if(!a||!a.receives.delete(lease))throw Error("STALE_LEASE");
  }
  function release(ref) {
    const a=lookup(ref);
    if(!a)throw Error("STALE_REF");
    if(a.phase!=="retiring")throw Error("NOT_RETIRED");
    if(a.init!==null||a.receives.size!==0)throw Error("IN_FLIGHT");
    a.payload=undefined;actors.delete(ref);used-=a.charge;
  }
  return {admit,begin,take,settle,stop,receive,enter,leave,release,used:()=>used};
}
function runLifecycle() {
  let n=0;
  const eq=(a,b)=>{if(a!==b)throw Error("lifecycle assertion "+(n+1)+": "+a+" != "+b);n++};
  const denies=(f,want)=>{let got;try{f()}catch(e){got=e.message}eq(got,want)};
  const l=lifecycle(10);
  const a=l.admit(6,{name:"worker",seed:42});
  eq(l.used(),6);eq(l.receive(a),false);eq(l.enter(a),null);
  denies(()=>l.admit(5,{}),"QUOTA");eq(l.used(),6);
  denies(()=>l.begin({generation:a.generation}),"INIT_AUTHORITY");
  const init=l.begin(a);
  denies(()=>l.begin(a),"INIT_AUTHORITY");
  denies(()=>l.take({ref:a}),"INIT_AUTHORITY");
  eq(l.take(init).seed,42);denies(()=>l.take(init),"INIT_AUTHORITY");
  eq(l.settle(init,true),true);eq(l.receive(a),true);
  denies(()=>l.settle(init,true),"INIT_AUTHORITY");
  denies(()=>l.release(a),"NOT_RETIRED");
  const r1=l.enter(a),r2=l.enter(a);
  eq(r1!==null,true);eq(r2!==null,true);
  eq(l.stop(a),true);eq(l.stop(a),false);eq(l.receive(a),false);eq(l.enter(a),null);
  eq(l.used(),6);denies(()=>l.release(a),"IN_FLIGHT");
  denies(()=>l.leave({ref:a}),"STALE_LEASE");
  l.leave(r1);denies(()=>l.leave(r1),"STALE_LEASE");denies(()=>l.release(a),"IN_FLIGHT");
  l.leave(r2);l.release(a);eq(l.used(),0);denies(()=>l.release(a),"STALE_REF");
  const b=l.admit(10,{seed:1}),bi=l.begin(b);
  eq(l.stop(b),true);eq(l.used(),10);eq(l.receive(b),false);
  denies(()=>l.release(b),"IN_FLIGHT");denies(()=>l.admit(1,{}),"QUOTA");
  denies(()=>l.take(bi),"INIT_AUTHORITY");eq(l.settle(bi,true),false);
  eq(l.used(),10);l.release(b);eq(l.used(),0);
  const c=l.admit(10,{});eq(c.generation>b.generation,true);eq(l.stop(b),false);
  eq(l.receive(b),false);denies(()=>l.settle(bi,true),"INIT_AUTHORITY");
  const ci=l.begin(c);eq(l.settle(ci,false),false);eq(l.receive(c),false);
  eq(l.used(),10);l.release(c);eq(l.used(),0);
  const d=l.admit(10,{});eq(l.stop(d),true);denies(()=>l.begin(d),"INIT_AUTHORITY");
  eq(l.used(),10);l.release(d);eq(l.used(),0);
  const other=lifecycle(10);const e=l.admit(10,{}),ei=l.begin(e);
  denies(()=>other.settle(ei,true),"INIT_AUTHORITY");
  eq(l.settle(ei,true),true);const er=l.enter(e);eq(l.stop(e),true);
  denies(()=>other.leave(er),"STALE_LEASE");l.leave(er);l.release(e);eq(l.used(),0);
  denies(()=>l.admit(0,{}),"QUOTA");denies(()=>l.admit(Number.MAX_SAFE_INTEGER+1,{}),"QUOTA");
  denies(()=>lifecycle(0),"QUOTA");
  // Deterministic transition traces, not real concurrent execution.
  for(let i=0;i<10000;i++){
    const x=l.admit(10,{}),xi=l.begin(x);
    if(i%2===0){eq(l.stop(x),true);denies(()=>l.release(x),"IN_FLIGHT");eq(l.settle(xi,true),false);}
    else{eq(l.settle(xi,true),true);const y=l.enter(x);eq(l.stop(x),true);denies(()=>l.release(x),"IN_FLIGHT");l.leave(y);}
    eq(l.used(),10);l.release(x);eq(l.used(),0);
  }
  return n;
}
console.log("source-free lifecycle assertions passed:",runLifecycle());
