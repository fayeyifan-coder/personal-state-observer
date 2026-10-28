"""Disposable Linux pseudo-terminal smoke test for offline password prompts.
This tests real terminal input/no echo, not Windows Terminal/PowerShell TTY.
No network, Netlify, owner credentials, or live operator keys.
"""
import json
import os
import pty
import select
import subprocess
import shutil
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLI = REPO / "tools" / "operator-offline.mjs"
FIXTURE = REPO / "tests" / "pairing-evidence-fixture.mjs"
SITE = "bb178423-5f8d-4b79-98b1-627179d25ea1"
PASSWORD = "synthetic-only-password-34721!"
with tempfile.TemporaryDirectory(prefix="pso-terminal-test-") as home:
    target = Path(home) / "one-time-fixture"
    fixture_dir = Path(home) / "pso-operator-generated"
    generated = subprocess.run(
        ["node", str(FIXTURE), "--out", str(fixture_dir)],
        capture_output=True, text=True, timeout=10
    )
    assert generated.returncode == 0, generated.stderr
    labels = json.loads((fixture_dir / "fixture-labels.json").read_text("utf-8"))
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("node", [
            "node", str(CLI), "init",
            "--dir", str(target), "--site-id", SITE,
            "--issuer", str(fixture_dir / "issuer.json")
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
        until("请输入独立核对的服务器签发公钥完整64位指纹".encode())
        os.write(fd, (labels["issuerFingerprint"] + "\r").encode("utf-8"))
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

        # A second PTY proves the complete manual sign ceremony accepts the
        # exact owner, full fingerprint and APPROVE, then hides the unlock
        # password. No trusted owner/real iPhone record is involved.
        owner = labels["ownerId"]
        fingerprint = labels["fingerprint"]
        receipt_path = fixture_dir / "receipt.json"
        signed_path = Path(home) / "signed-packet.json"
        child, signfd = pty.fork()
        if child == 0:
            os.execvp("node", [
                "node", str(CLI), "sign", "--dir", str(target),
                "--receipt", str(receipt_path), "--out", str(signed_path)
            ])
        sign_output = bytearray()

        def sign_until(needle: str):
            end = time.monotonic() + 12
            while time.monotonic() < end:
                readable, _, _ = select.select([signfd], [], [], .25)
                if readable:
                    try:
                        chunk = os.read(signfd, 8192)
                    except OSError:
                        break
                    sign_output.extend(chunk)
                    if needle.encode() in sign_output:
                        return
            raise AssertionError("Missing signed-command prompt: " + needle)

        try:
            sign_until("独立确认账户 ID")
            os.write(signfd, (owner + "\r").encode())
            sign_until("输入手机显示的完整64字符公钥指纹")
            os.write(signfd, (fingerprint + "\r").encode())
            sign_until("确认操作类型")
            os.write(signfd, b"APPROVE\r")
            sign_until("审批私钥口令")
            os.write(signfd, (PASSWORD + "\r").encode())
            sign_until("已输出离线签名凭证")
            _, result = os.waitpid(child, 0)
            assert os.WIFEXITED(result) and os.WEXITSTATUS(result) == 0
            assert PASSWORD.encode() not in sign_output, "Signing leaked password"
            packet = json.loads(signed_path.read_text("utf-8"))
            assert packet["command"]["ownerId"] == owner
            assert packet["command"]["fingerprint"] == fingerprint
            assert packet["command"]["action"] == "approve-publisher"
            verify = subprocess.run([
                "node", str(CLI), "verify", "--dir", str(target),
                "--signed", str(signed_path)
            ], capture_output=True, text=True, timeout=10)
            assert verify.returncode == 0, "Offline signature verification failed"
            print("[PASS] full offline approval ceremony and hidden unlock password")
        finally:
            try:
                os.close(signfd)
            except OSError:
                pass
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
