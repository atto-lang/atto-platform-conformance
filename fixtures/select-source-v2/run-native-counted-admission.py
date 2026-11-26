#!/usr/bin/env python3
"""Run real scalar compiler admission; never report a counted guest pass."""
import argparse, hashlib, json, pathlib, subprocess, tempfile

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--backend", required=True, choices=["forge", "cranelift"])
    p.add_argument("--compiler", required=True)
    a = p.parse_args()
    compiler = str(pathlib.Path(a.compiler).resolve())
    root = pathlib.Path(__file__).resolve().parent
    manifest = json.loads((root / "manifest.json").read_text())
    cases = [c for c in manifest["cases"] if c["id"].startswith(("counted-", "reject-counted-"))]
    assert len(cases) == 9
    def invoke(mode, path):
        return subprocess.run([compiler, mode, str(path)], capture_output=True, timeout=30, check=False)
    for c in cases:
        src = root / c["path"]
        raw = src.read_bytes()
        assert hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == c["gitBlobSha1"]
        r = invoke("ir", src)
        assert r.returncode > 0 and not r.stdout.strip() and r.stderr.strip(), (c["id"], r)
    with tempfile.TemporaryDirectory() as td:
        src = pathlib.Path(td) / "probe.atto"
        total = 0
        for prefix in ("select", "nb select", "await select", "await nb select"):
            for header in ("(3)", "<int>(3)", "(0)", "(-1)", "(true)", "(1+2)"):
                for body in ("{ default: -> { return 42; } }", "over default: -> { return 42; } end"):
                    src.write_text("pub fnc main(): int { return " + prefix + header + " " + body + "; }\n")
                    r = invoke("ir", src)
                    assert r.returncode > 0 and not r.stdout.strip() and r.stderr.strip(), (prefix, header, body, r)
                    total += 1
        src.write_text("pub fnc main(): int { return 42; }\n")
        r = invoke("run", src)
        assert r.returncode == 0 and r.stdout.strip() == b"42", r
    print(f"COUNTED_SELECT_ADMISSION_PASS backend={a.backend} exact_blobs=9 isolated={total} no_IR; scalar_control=42; COUNTED_GUEST_NOT_EXECUTED")

if __name__ == "__main__":
    main()
