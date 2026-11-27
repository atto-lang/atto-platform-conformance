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
  const parallel=opts.schedule?.max_parallelism??(policy.serial?1:policy.max_parallelism);
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


// Sequential lifecycle model only: no real scheduler, threads or memory.
// Each transition is explicit so race orderings can be exercised as traces.
function lifecycle(limit) {
  let used=0, next=1;
  const actors=new Map();
  const lookup=ref=>actors.get(ref.generation);
  function admit(charge,payload) {
    if(!Number.isSafeInteger(charge)||charge<=0||charge>limit-used)throw Error("QUOTA");
    const ref=Object.freeze({generation:next++});
    used+=charge;
    actors.set(ref.generation,{ref,charge,payload,phase:"initializing",taken:false});
    return ref;
  }
  function take(ref) {
    const a=lookup(ref);
    if(!a||a.ref!==ref||a.phase!=="initializing"||a.taken)throw Error("INIT_AUTHORITY");
    a.taken=true;const p=a.payload;a.payload=undefined;return p;
  }
  function ready(ref) {
    const a=lookup(ref);
    if(!a||a.ref!==ref||a.phase!=="initializing")return false;
    a.payload=undefined;a.phase="ready";return true;
  }
  function stop(ref) {
    const a=lookup(ref);
    if(!a||a.ref!==ref)return false;
    actors.delete(ref.generation);used-=a.charge;a.payload=undefined;return true;
  }
  function receive(ref) {
    const a=lookup(ref);
    return !!a&&a.ref===ref&&a.phase==="ready";
  }
  return {admit,take,ready,stop,receive,used:()=>used};
}
function runLifecycle() {
  let n=0;
  const eq=(a,b)=>{if(a!==b)throw Error("lifecycle assertion "+(n+1)+": "+a+" != "+b);n++};
  const denies=(f,want)=>{let got;try{f()}catch(e){got=e.message}eq(got,want)};
  const l=lifecycle(10);
  const a=l.admit(6,{name:"worker",seed:42});
  eq(l.used(),6);eq(l.receive(a),false);
  denies(()=>l.admit(5,{}),"QUOTA");eq(l.used(),6);
  denies(()=>l.take({generation:a.generation}),"INIT_AUTHORITY");
  eq(l.take(a).seed,42);denies(()=>l.take(a),"INIT_AUTHORITY");
  eq(l.ready(a),true);eq(l.receive(a),true);eq(l.ready(a),false);
  denies(()=>l.take(a),"INIT_AUTHORITY");
  eq(l.stop(a),true);eq(l.stop(a),false);eq(l.used(),0);
  const b=l.admit(10,{});
  eq(l.receive(b),false);eq(l.stop(b),true);eq(l.ready(b),false);eq(l.used(),0);
  const c=l.admit(10,{});
  eq(l.ready(b),false);eq(l.receive(b),false);eq(l.stop(b),false);
  eq(l.used(),10);eq(l.ready(c),true);eq(l.receive(c),true);
  denies(()=>l.take(c),"INIT_AUTHORITY");eq(l.stop(c),true);eq(l.used(),0);
  denies(()=>l.admit(0,{}),"QUOTA");denies(()=>l.admit(Number.MAX_SAFE_INTEGER+1,{}),"QUOTA");
  eq(l.used(),0);
  return n;
}
console.log("source-free lifecycle assertions passed:",runLifecycle());

 
// Fixed-cap default regression cases: actor kind determines the serial
// default even when the host ceiling permits more than one carrier.
const defaultsInit = ["init", [["name","worker"],["seed",42]]];
const serialPolicy = {...p,serial:true};
const defaultCases = [
  ["serial omitted schedule", [defaultsInit], null, serialPolicy],
  ["serial empty schedule", [["schedule",[]],defaultsInit], null, serialPolicy],
  ["serial explicit one", [["schedule",[["max_parallelism",1]]],defaultsInit], null, serialPolicy],
  ["serial pinned implicit one", [["schedule",[["affinity","pinned"]]],defaultsInit], null, serialPolicy],
  ["serial dedicated implicit one (shape only)", [["schedule",[["affinity","dedicated"]]],defaultsInit], null, serialPolicy],
  ["ordinary pinned implicit four", [["schedule",[["affinity","pinned"]]],defaultsInit], "AFFINITY_CAP"],
  ["ordinary dedicated explicit one (shape only)", [["schedule",[["max_parallelism",1],["affinity","dedicated"]]],defaultsInit], null],
  ["serial explicit two", [["schedule",[["max_parallelism",2]]],defaultsInit], "SERIAL", serialPolicy],
  ["fractional init integer", [["init",[["name","worker"],["seed",1.5]]]], "TYPE"],
  ["init key without schema", [defaultsInit], "UNKNOWN_KEY", {...p,init:{}}]
];
console.log("source-free default cases passed:",run(check,defaultCases,p));
const preserved = check([["resources",[["stack_size",65536]]],defaultsInit,["schedule",[["max_parallelism",1],["affinity","sticky"]]]],p);
if (preserved.resources.stack_size!==65536 || preserved.init.name!=="worker" || preserved.init.seed!==42 ||
    preserved.schedule.max_parallelism!==1 || preserved.schedule.affinity!=="sticky") {
  throw Error("validated supplied option values were not preserved");
}
console.log("source-free value preservation assertions passed: 5");
