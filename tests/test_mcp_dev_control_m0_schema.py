"""Independent JSON Schema checks for MCP M0: source-free, never runtime proof."""
import copy
import json
import pathlib
import unittest
from jsonschema import Draft202012Validator

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas/mcp-dev-control-m0-v1.schema.json").read_text())
CONTRACT = json.loads((ROOT / "contracts/mcp-dev-control-m0-v1.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)

def req(method="resources/read"):
    params = {"_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {"elicitation": {}},
        "io.atto.dev/security": {
            "schema_version": "atto.mcp.dev-control.m0.v1",
            "nonce": "a" * 32, "issued_at_ms": 100000,
            "runtime_id": "r", "tenant_id": "t", "expected_generation": 3}}}
    if method == "resources/read":
        params["uri"] = "atto-dev://runtime/r/tenant/t/process/summary"
    return {"jsonrpc": "2.0", "id": "req-1", "method": method, "params": params}

class TestM0Schema(unittest.TestCase):
    def test_draft_schema_valid(self):
        Draft202012Validator.check_schema(SCHEMA)
    def test_accepts_optional_client_info_and_nonempty_capabilities(self):
        for info in (None, {"name": "test client", "version": "1.0.0"}):
            obj = req()
            if info is not None:
                obj["params"]["_meta"]["io.modelcontextprotocol/clientInfo"] = info
            self.assertTrue(VALIDATOR.is_valid(obj))
    def test_rejects_malformed_client_info(self):
        for info in ({}, {"name": "n"}, {"name": "", "version": "v"}, {"name": "n", "version": "v", "role": "root"}):
            obj = req()
            obj["params"]["_meta"]["io.modelcontextprotocol/clientInfo"] = info
            self.assertFalse(VALIDATOR.is_valid(obj))
    def test_client_capabilities_required_and_bounded(self):
        obj = req()
        del obj["params"]["_meta"]["io.modelcontextprotocol/clientCapabilities"]
        self.assertFalse(VALIDATOR.is_valid(obj))
        obj = req()
        obj["params"]["_meta"]["io.modelcontextprotocol/clientCapabilities"] = {str(i): {} for i in range(17)}
        self.assertFalse(VALIDATOR.is_valid(obj))
    def test_rejects_unknown_methods_and_client_principal(self):
        obj = req("upgrade/commit")
        self.assertFalse(VALIDATOR.is_valid(obj))
        obj = req()
        obj["principal"] = {"principal_id": "admin"}
        self.assertFalse(VALIDATOR.is_valid(obj))
    def test_rejects_cross_namespace_uri_and_traversal(self):
        for uri in ("atto-dev://runtime/r/tenant/t/actors/private", "atto-dev://runtime/../tenant/t/process/summary",
                    "atto-dev://runtime/r/tenant/t/../process/summary", "file:///etc/passwd"):
            obj = req()
            obj["params"]["uri"] = uri
            self.assertFalse(VALIDATOR.is_valid(obj))
    def test_read_must_have_uri_and_list_must_not(self):
        obj = req()
        del obj["params"]["uri"]
        self.assertFalse(VALIDATOR.is_valid(obj))
        obj = req("resources/list")
        obj["params"]["uri"] = "atto-dev://runtime/r/tenant/t/process/summary"
        self.assertFalse(VALIDATOR.is_valid(obj))
    def test_rejects_unredacted_summary(self):
        validator = Draft202012Validator({"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"],
                                        "$ref": "#/$defs/resourceSummary"})
        obj = {"kind": "process/summary", "runtime_id": "r", "tenant_id": "t",
               "generation": 3, "status": "ok", "counters": {"actors": 1}}
        self.assertTrue(validator.is_valid(obj))
        for field in ("pointer", "secret", "credentials", "raw_state"):
            sample = copy.deepcopy(obj)
            sample[field] = "sensitive"
            self.assertFalse(validator.is_valid(sample))
        obj["counters"]["private_value"] = 10
        self.assertFalse(validator.is_valid(obj))
    def test_audit_reason_and_non_authoritative_metadata(self):
        self.assertIn("DUPLICATE_ID", SCHEMA["$defs"]["audit"]["properties"]["reason"]["enum"])
        self.assertEqual(CONTRACT["authority"]["clientInfoIsAuthority"], False)
        self.assertEqual(CONTRACT["evidence"]["classification"], "SOURCE_FREE_POLICY_MODEL_ONLY")

if __name__ == "__main__":
    unittest.main()
