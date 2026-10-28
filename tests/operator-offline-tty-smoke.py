"""Disposable Linux pseudo-terminal smoke test for offline password prompts.
This tests real terminal input/no echo, not Windows Terminal/PowerShell TTY.
No network, Netlify, owner credentials, or live operator keys.
"""
import json
import os
import pty
import select
import shutil
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLI = REPO / "tools" / "operator-offline.mjs"
SITE = "bb178423-5f8d-4b79-98b1-627179d25ea1"
PASSWORD = "synthetic-only-password-34721!"
with tempfile.TemporaryDirectory(prefix="pso-terminal-test-") as home:
    target = Path(home) / "one-time-fixture"
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("node", [
            "node", str(CLI), "init",
            "--dir", str(target), "--site-id", SITE
        ])
    captured = bytearray()

    def until(needle: bytes, deadline=12):
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            readable, _, _ = select.select([fd], [], [], .25)
            if readable:
                try:
                    chunk = os.read(fd, 8192)
                except OSError:
                    break
                captured.extend(chunk)
                if needle in captured:
                    return
        raise AssertionError("Missing terminal prompt: " + needle.decode("utf-8", "replace"))

    try:
        until("新密钥口令".encode())
        os.write(fd, (PASSWORD + "\r").encode("utf-8"))
        until("再次输入口令确认".encode())
        os.write(fd, (PASSWORD + "\r").encode("utf-8"))
        until("已在仓库外生成加密操作员私钥".encode())
        _, result = os.waitpid(pid, 0)
        assert os.WIFEXITED(result) and os.WEXITSTATUS(result) == 0, captured.decode(
            "utf-8", "replace"
        )
        assert PASSWORD.encode("utf-8") not in captured, "Terminal echoed passphrase"
        pem = (target / "operator-encrypted-private.pem").read_text("utf-8")
        assert pem.startswith("-----BEGIN ENCRYPTED PRIVATE KEY-----")
        assert PASSWORD not in pem
        manifest = json.loads((target / "operator-public.json").read_text("utf-8"))
        assert manifest["siteId"] == SITE
        assert len(manifest["fingerprint"]) == 64
        assert "d" not in manifest["publicJwk"]
        print("[PASS] pseudo-TTY hidden password and separate encrypted operator key")
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
