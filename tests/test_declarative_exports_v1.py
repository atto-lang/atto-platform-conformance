"""Self-contained structural integrity checks for the shared export-v1 corpus.

This verifies the corpus, NOT that every compiler supports the language.
Backend conformance requires independently executed compiler/guest receipts.
"""
from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "declarative-exports-v1.json"
FIXTURES = ROOT / "fixtures" / "declarative-exports-v1"


class DeclarativeExportV1Corpus(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_schema_and_backend_inventory(self) -> None:
        self.assertEqual(self.contract["schema"], "atto.declarative-exports.v1")
        self.assertEqual(self.contract["version"], 1)
        self.assertEqual(
            set(self.contract["backends"]),
            {"java", "llvm", "net", "rs", "js", "forge", "cranelift", "hdl", "wasm"},
        )
        self.assertTrue(self.contract["rules"]["file_root_only"])
        self.assertTrue(self.contract["rules"]["forward_reference"])
        self.assertEqual(self.contract["rules"]["package_scope_external_access"], "deny")

    def test_unique_cases_and_exact_fixture_inventory(self) -> None:
        cases = self.contract["cases"]
        self.assertGreaterEqual(len(cases), 14)
        ids = [case["id"] for case in cases]
        files = [case["source"] for case in cases]
        self.assertEqual(len(ids), len(set(ids)), "duplicate case ID")
        self.assertEqual(len(files), len(set(files)), "duplicate fixture path")
        self.assertEqual(
            {path.name for path in FIXTURES.glob("*.atto")},
            set(files),
            "stray or missing fixtures are not allowed",
        )
        for case in cases:
            with self.subTest(case=case["id"]):
                self.assertEqual(Path(case["source"]).name, case["source"])
                self.assertIn(case["expect"], {"accept", "reject"})
                source = (FIXTURES / case["source"]).read_bytes()
                self.assertLessEqual(len(source), 1 << 20)
                self.assertTrue(source.endswith(b"\n"))
                self.assertNotIn(b"\x00", source)
                self.assertIn(b"export pub", source)
                self.assertIn(b";", source)
                if case["expect"] == "accept":
                    self.assertIn(case["target_kind"], {"fnc", "class"})
                    self.assertIn(case["visibility"], {"public", "package"})
                    self.assertNotIn("diagnostic", case)
                else:
                    self.assertIn(
                        case["diagnostic"],
                        {"unbound_export", "export_kind_mismatch", "duplicate_export",
                         "invalid_scope", "export_not_file_root",
                         "conflicting_export_visibility"},
                    )

    def test_equivalent_placements_share_declaration_text(self) -> None:
        by_id = {case["id"]: case for case in self.contract["cases"]}
        pairs = [(case, by_id[case["equivalent_to"]])
                 for case in self.contract["cases"] if "equivalent_to" in case]
        self.assertGreaterEqual(len(pairs), 3)
        for later, earlier in pairs:
            with self.subTest(pair=later["id"]):
                self.assertEqual(later["expect"], "accept")
                self.assertEqual(earlier["expect"], "accept")
                self.assertEqual(later["target_kind"], earlier["target_kind"])
                self.assertEqual(later["visibility"], earlier["visibility"])
                a = (FIXTURES / later["source"]).read_text(encoding="utf-8")
                b = (FIXTURES / earlier["source"]).read_text(encoding="utf-8")
                # Ignore the position of the identical export directive.
                def strip_exports(text: str) -> list[str]:
                    return [line for line in text.splitlines() if not line.startswith("export pub")]
                self.assertEqual(strip_exports(a), strip_exports(b))
                # The inferred-kind spelling is semantically equal to an
                # explicit fnc kind only when the target declaration is fnc.
                def normalized_exports(text: str) -> list[str]:
                    result = []
                    for line in text.splitlines():
                        if not line.startswith("export pub"):
                            continue
                        if line == "export pub main;" and "fnc main(" in text:
                            line = "export pub fnc main;"
                        result.append(line)
                    return sorted(result)
                self.assertEqual(normalized_exports(a), normalized_exports(b))


if __name__ == "__main__":
    unittest.main()
