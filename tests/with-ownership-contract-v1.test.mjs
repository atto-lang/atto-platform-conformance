import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {strict as assert} from "node:assert";

const root=fileURLToPath(new URL("../../",import.meta.url));
const contract=JSON.parse(readFileSync(join(root,"contracts/with-ownership-v1.json"),"utf8"));
function validate(x) {
    assert.deepEqual(Object.keys(x).sort(),["schema_version","contract","classification","source_extension","canonical_receiver","implicit_return","backends","contract_properties","cases","evidence"].sort());
    assert.equal(x.schema_version,1);
    assert.equal(x.contract,"atto-with-ownership-v1");
    assert.equal(x.classification,"candidate-not-five-backend-verified");
    assert.equal(x.source_extension,".atto");
    assert.equal(x.canonical_receiver,"self");
    assert.equal(x.implicit_return,false);
    assert.deepEqual(x.backends,["java","llvm","wasm","forge","net"]);
    assert.deepEqual(x.cases.map(c=>c.id),["record-copy","class-self-copy","class-take","record-use-after-take","class-implicit-copy","class-borrow-copy","record-effectful-rhs","class-this-spelling","contextual-with","trivia-inert"]);
    assert.deepEqual(Object.keys(x.evidence).sort(),["java","llvm","wasm","forge","net"].sort());
    for (const backend of ["llvm","wasm","forge","net"])
        assert.equal(x.evidence[backend],"NOT_EXECUTED");
    for (const c of x.cases) {
        assert.deepEqual(Object.keys(c).sort(),["id","fixture","kind","expected_java","unimplemented_backends","unimplemented_diagnostic"].sort());
        assert.match(c.fixture,/^fixtures\/with-ownership-v1\/[a-z-]+\.atto$/);
        assert.equal(c.fixture,`fixtures/with-ownership-v1/${c.id}.atto`);
        assert.ok(c.kind==="run"||c.kind==="compile_reject");
        assert.deepEqual(c.unimplemented_backends,["llvm","wasm","forge","net"]);
        assert.equal(c.unimplemented_diagnostic,"WITH_BACKEND_UNSUPPORTED");
        const bytes=readFileSync(join(root,c.fixture));
        assert.ok(bytes.length>20&&bytes.length<4096);
        assert.equal(bytes.at(-1),10);
        assert.ok(createHash("sha256").update(bytes).digest("hex").length===64);
    }
}
validate(contract);
for(const mutant of [
    {...contract,classification:"verified-all"},
    {...contract,backends:["java"]},
    {...contract,implicit_return:true},
    {...contract,cases:contract.cases.slice(1)},
    {...contract,cases:contract.cases.map((x,i)=>i===0?{...x,unimplemented_diagnostic:"PASS"}:x)}
]) assert.throws(()=>validate(mutant));
console.log("WITH_FIVE_BACKEND_CONTRACT_SOURCE_ONLY_PASS fixtures="+contract.cases.length+" GUEST_EXECUTION=NOT_EXECUTED");
