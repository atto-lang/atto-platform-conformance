import assert from "node:assert/strict";
import fs from "node:fs";
import { expectedRows, verifyReport } from "../tools/verify-explicit-export-backend-report.mjs";

const contract = JSON.parse(fs.readFileSync(
  new URL("../contracts/explicit-exports-v1.json", import.meta.url), "utf8"));

const rows = expectedRows(contract);
assert.equal(rows.length,
  contract.modifier_cases.length + contract.cases.length + contract.syntax_cases.length);
assert.equal(contract.syntax_cases.length, 31);
assert.equal(contract.cases.length, 23);

const good = {
  schema:"oreslang.explicit-exports.backend-report.v1",
  backend:"synthetic-reference",
  exact_head:"0123456789abcdef0123456789abcdef01234567",
  execution:{
    status:"EXECUTED",
    run_url:"https://example.invalid/run/1"
  },
  native_exposure:"UNCHANGED",
  results:rows.map(row => ({
    id:row.id,
    status:row.expected,
    diagnostic:row.diagnostic
  }))
};
assert.deepEqual(verifyReport(contract, good), []);

const unexecuted = structuredClone(good);
unexecuted.execution.status = "NOT_EXECUTED";
assert(verifyReport(contract, unexecuted).includes("EXECUTION_REQUIRED"));

const wrongDiagnostic = structuredClone(good);
const rejected = rows.find(row => row.expected === "REJECT");
wrongDiagnostic.results.find(row => row.id === rejected.id).diagnostic = "GENERIC_PARSE_ERROR";
assert(verifyReport(contract, wrongDiagnostic)
  .some(error => error.startsWith("DIAGNOSTIC_MISMATCH:")));

const missing = structuredClone(good);
missing.results.pop();
assert(verifyReport(contract, missing).some(error => error.startsWith("MISSING_RESULT:")));

const nativeLeak = structuredClone(good);
nativeLeak.native_exposure = "EXPOSED";
assert(verifyReport(contract, nativeLeak).includes("NATIVE_EXPOSURE_MUST_BE_UNCHANGED"));

console.log(JSON.stringify({
  status:"PASS",
  protocol:"oreslang.explicit-exports.backend-report.v1",
  required_cases:rows.length,
  syntax_cases:contract.syntax_cases.length,
  semantic_cases:contract.cases.length,
  modifier_cases:contract.modifier_cases.length
}));
