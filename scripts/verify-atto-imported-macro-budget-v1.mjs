import {readFileSync, lstatSync} from "node:fs";
import {isDeepStrictEqual} from "node:util";
const DEFAULT = new URL("../contracts/atto-source-v1/imported-macro-budget-v1.json", import.meta.url);
export const CANONICAL = {
  "schema": "attolang.imported-macro-budget.v1",
  "language_extension": ".atto",
  "macro_producer": "define pub macro identity(Syntax<Expr> value) -> Syntax<Expr> { return value; }",
  "macro_invocation": "lib.identity!(syntax expr 1)",
  "import_statement": "import * as lib from \"./producer.atto\";",
  "budget_scope": "single_consumer_source_unit",
  "max_expansions": 128,
  "cases": [
    {
      "id": "exactly-128",
      "expansions": 128,
      "expected": "COMPILE_AND_EXECUTE",
      "exit_code": 42
    },
    {
      "id": "over-128",
      "expansions": 129,
      "expected": "COMPILE_REJECT",
      "diagnostic_class": "macro_expansion_budget",
      "emitted_ir_bytes": 0,
      "emitted_artifacts": 0
    }
  ],
  "backend_states": [
    {
      "backend": "java",
      "evidence": "NOT_EXECUTED"
    },
    {
      "backend": "llvm",
      "evidence": "NOT_EXECUTED"
    },
    {
      "backend": "wasm",
      "evidence": "NOT_EXECUTED"
    },
    {
      "backend": "forge",
      "evidence": "NOT_EXECUTED"
    },
    {
      "backend": "net",
      "evidence": "NOT_EXECUTED"
    }
  ],
  "source_only": true,
  "requires": [
    "exact source tree/head SHA",
    "compiler log with executed steps",
    "native guest binary hash for success",
    "no IR or output artifact on rejection",
    "independent backend review"
  ]
};
export function verifyAttoImportedMacroBudgetV1(file = DEFAULT) {
  if (lstatSync(file).isSymbolicLink()) throw Error("symlinked imported macro manifest denied");
  const raw = readFileSync(file, "utf8");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw Error("invalid imported macro manifest JSON"); }
  // Raw exact canonical form rejects duplicate keys, reordered/forged fields,
  // noncanonical escape text and status substitutions.
  if (raw !== JSON.stringify(parsed, null, 2) + "\n")
    throw Error("noncanonical or duplicate imported macro manifest keys");
  if (!isDeepStrictEqual(parsed, CANONICAL))
    throw Error("imported macro contract/budget/evidence changed without review");
  return {backends:5, cases:2, maxExpansions:128, sourceOnly:true,
          guestsExecuted:0};
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  console.log(JSON.stringify(verifyAttoImportedMacroBudgetV1()));
}
