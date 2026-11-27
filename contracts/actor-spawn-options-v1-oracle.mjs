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
