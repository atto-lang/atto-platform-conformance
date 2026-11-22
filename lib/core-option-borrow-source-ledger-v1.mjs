// A strict, offline, source-only evidence guard. Never authenticates a
// compiler, guest, typed borrow diagnostic, NativeAOT or sanitizer receipt.
import {lstatSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadCoreOptionDashboard} from './core-option-parity-dashboard-v1.mjs';
import {validateCoreOptionBorrowParity} from './core-option-borrow-parity-v1.mjs';

const PINS=Object.freeze({
  "java": {
    "tree": "58d26bb865a1211fae18395ab87587f6a4433b68",
    "stage": "borrow_source_candidate",
    "files": {
      "core/option.atto": "4400fae94588587fbb85474256e82cac6c26256c",
      "core/result.atto": "6bae249740af1088e069c3592ff8fb2bc72f1216",
      "tests/core_option_result/borrowed_queries.atto": "35f77b9020812364d1d0885e35f53a071cb50134",
      "src/test/java/dev/oreslang/CoreOptionResultBorrowSafetyTest.java": "d44dfe085ed6728e5f5b50be889a1c56bf78bc39"
    }
  },
  "llvm": {
    "tree": "1861bf7efb93c51f76cfb8767907bde210c50a38",
    "stage": "borrow_source_candidate",
    "files": {
      "library/ores.core/option.atto": "ca4534b771c9e1981777ce4be00630bd6398631d",
      "library/ores.core/result.atto": "8f09c5b60b99f6510583be9f722ac70320e2b93f",
      "tests/core_option_result/borrowed_read_42.atto": "9baff7ba4753686e69d7bbf5134e5b82f6da5a65",
      "tests/core_option_result/negative_affine_borrow_escape.atto": "8326c4abf663e97c41e28795e9febdbf7e78f4b5"
    }
  },
  "rs": {
    "tree": "49903cf337cf9833adefc6a2e70ab58533138f88",
    "stage": "borrow_source_candidate",
    "files": {
      "core/option.atto": "46acf6c4fadb462255d418bd65a70f616016aa0a",
      "core/result.atto": "2c88acd11d79e6df52eee092f4a03d5448e02d06",
      "tests/core_option_result/borrowed_read_42.atto": "9baff7ba4753686e69d7bbf5134e5b82f6da5a65",
      "tests/core_option_result/negative_affine_borrow_escape.atto": "8326c4abf663e97c41e28795e9febdbf7e78f4b5"
    }
  },
  "net": {
    "tree": "3a9c6a3f365fa008edb195be31cb9723cd1e8c4f",
    "stage": "borrow_source_candidate",
    "files": {
      "library/atto.core/option.atto": "0c22fdf444c46b0865f84a6d131fed0da67d1013",
      "library/atto.core/result.atto": "6d62baabf8271dc090644943cd4a47f5928283e7",
      "tests/core_option_result/borrowed_read_42.atto": "9baff7ba4753686e69d7bbf5134e5b82f6da5a65",
      "tests/core_option_result/negative_affine_borrow_escape.atto": "8326c4abf663e97c41e28795e9febdbf7e78f4b5"
    }
  },
  "wasm": {
    "tree": "be83842d1a51e43c397e41e9ea43366cd0a09476",
    "stage": "borrow_source_candidate",
    "files": {
      "core/option.atto": "bb90d49469e689ca1f298b7f5d9e9f54b5c1d7d8",
      "core/result.atto": "469aa451725fffb94d9dcd50b47191979849c658",
      "tests/core_option_result/borrowed_read_42.atto": "a548d4c187bfe7d620addb334f549956dfcd366b",
      "tests/core_option_result/negative_affine_borrow_escape.atto": "90dbdfed9cde95f0ed9bd192f947c640d27f7cb7"
    }
  },
  "forge": {
    "tree": "610e0d6e87e91c9ff65befa24ddfa9de5bbc463f",
    "stage": "borrow_source_candidate",
    "files": {
      "core/option.atto": "eda1116be794be1bdb280ae959ff1a77a533a4af",
      "core/result.atto": "c8ba43d3b5c3737bab85e1893648492c6bec3128",
      "tests/core_option_result/borrowed_read_42.atto": "a548d4c187bfe7d620addb334f549956dfcd366b",
      "tests/core_option_result/negative_affine_borrow_escape.atto": "90dbdfed9cde95f0ed9bd192f947c640d27f7cb7"
    }
  },
  "cranelift": {
    "tree": "8a4f920d423a63b16c9692f3a218844c4966bb22",
    "stage": "borrow_source_candidate",
    "files": {
      "core/option.atto": "114caf65f17d6b87f5440b2b17fe6b9deab8f4c4",
      "core/result.atto": "2d60346c041330a8ed40c4fc23ad1e5d66197723",
      "tests/core_option_result/borrowed_read_42.atto": "a548d4c187bfe7d620addb334f549956dfcd366b",
      "tests/core_option_result/negative_affine_borrow_escape.atto": "90dbdfed9cde95f0ed9bd192f947c640d27f7cb7"
    }
  },
  "js": {
    "tree": "fc03ac64dfcbceef0f12ab5525731f22a6449894",
    "stage": "concrete_scalar_no_generic_borrow",
    "files": {
      "core/option.atto": "06fa440dd3d7f055028a49a88d50a098dc9607c3",
      "core/result.atto": "f398a518e40a1c0bd6445c5eacdf382d87946ac9",
      "tests/core-option-result-source.test.mjs": "f7b70e10d432027254f94a155fd22f6b52dd8a17",
      "core/OPTION_RESULT_STATUS.md": "77a86e3290a54c744780cba3b924788c42ef08da"
    }
  },
  "hdl": {
    "tree": "0049cc6c08ce824b7323caa4d5c2fa8b1ed1f884",
    "stage": "rtl_scalar_unsynthesized",
    "files": {
      "core/option.atto": "402b12d369f6e84362dcc1cb7c1231a184b2f050",
      "core/result.atto": "c1633e21a65ea1fd555b0324a8c3416e630f46b1",
      "core/OPTION_RESULT_STATUS.md": "1447838587094eeb52e0abb9e0717af01fb6f485"
    }
  },
  "atto": {
    "tree": null,
    "stage": "no_borrow_candidate",
    "files": {}
  },
  "realtime": {
    "tree": null,
    "stage": "no_borrow_candidate",
    "files": {}
  }
});
const FULL_SHA=/^[0-9a-f]{40}$/;
const deny=why=>{throw Error('BORROW_SOURCE_LEDGER_DENIED: '+why);};
function exact(o,keys,where) {
  if(!o||typeof o!=='object'||Array.isArray(o)||
     JSON.stringify(Object.keys(o).sort())!==JSON.stringify([...keys].sort()))
    deny('wrong object keys: '+where);
}
export function validateBorrowSourceLedger(data,dashboard=loadCoreOptionDashboard()) {
  exact(data,['schema','as_of','registry_link','authority','release_qualified',
    'notes','backends'],'ledger');
  if(data.schema!=='atto.core-option-borrow-source-ledger.v1'||
     data.as_of!=='2026-11-22'||
     data.registry_link!=='contracts/eleven-backend-parity-v1/core-option-dashboard.json'||
     data.authority!=='source_metadata_observed_only'||
     data.release_qualified!==false||
     typeof data.notes!=='string'||data.notes.length<50||data.notes.length>500)
    deny('unsafe header or fake release qualification');
  if(!Array.isArray(data.backends)||data.backends.length!==11)deny('missing backend');
  const expected=new Map(dashboard.backends.map(x=>[x.id,x]));
  let files=0,admitted=0;
  const seen=new Set();
  for(const b of data.backends){
    exact(b,['id','repository','source_head_sha','root_tree_sha','stage',
      'source_artifacts','checks','release_qualified'],'backend');
    const ref=expected.get(b.id),pin=PINS[b.id];
    if(!ref||!pin||seen.has(b.id))deny('duplicate or unrecognized backend');
    seen.add(b.id);
    if(b.repository!==ref.repository||
       b.source_head_sha!==(ref.candidate?.head_sha??null)||
       b.root_tree_sha!==pin.tree||b.stage!==pin.stage||
       b.release_qualified!==false)
      deny('source SHA/compilation stage substitution: '+b.id);
    if(b.source_head_sha!==null&&!FULL_SHA.test(b.source_head_sha))deny('bad candidate SHA');
    if(b.root_tree_sha!==null&&!FULL_SHA.test(b.root_tree_sha))deny('bad root tree SHA');
    if(!Array.isArray(b.source_artifacts)||
      b.source_artifacts.length!==Object.keys(pin.files).length)
      deny('missing or extra source artifact: '+b.id);
    const used=new Set();
    for(const f of b.source_artifacts) {
      exact(f,['path','blob_sha'],'source artifact');
      if(typeof f.path!=='string'||!Object.hasOwn(pin.files,f.path)||
         used.has(f.path)||pin.files[f.path]!==f.blob_sha||!FULL_SHA.test(f.blob_sha)||
         f.path.startsWith('/')||f.path.includes('..')||f.path.includes('\\'))
        deny('wrong source path, type or Git blob SHA: '+b.id);
      used.add(f.path);files++;
    }
    exact(b.checks,['compiled_guest','semantic_borrow_negative','native_aot',
      'memory_safety'],'guest evidence checks');
    if(Object.values(b.checks).some(x=>x!=='not_executed'))
      deny('fake PASS / unsupported / host-only evidence: '+b.id);
    if(b.stage==='borrow_source_candidate')admitted++;
  }
  if(seen.size!==11||files!==35||admitted!==7)deny('not all target profiles covered');
  return {backends:11,borrow_candidates:7,source_artifacts:35,guest_passes:0};
}
export function loadBorrowSourceLedger(path=fileURLToPath(
 new URL('../contracts/eleven-backend-parity-v1/borrow-source-ledger.json',import.meta.url))) {
 const st=lstatSync(path);
 if(!st.isFile()||st.isSymbolicLink())deny('source ledger not a regular file');
 const raw=readFileSync(path,'utf8');
 const data=JSON.parse(raw);
 if(raw!==JSON.stringify(data,null,2)+'\n')deny('noncanonical or duplicate-key JSON');
 validateBorrowSourceLedger(data);
 return data;
}
