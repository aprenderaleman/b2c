"""
Lightweight SSH helper used during deploy. Wraps paramiko with password
auth + streamed stdout.  Not meant to stay in production — this is
purely for the one-time VPS bootstrap.

Usage:
    python scripts/ssh_exec.py HOST USER PASSWORD 'command'
"""
from __future__ import annotations

import io
import sys
import paramiko

# Windows default console is cp1252 — force UTF-8 so emoji / box-drawing chars
# from Docker output don't crash the streamer.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def run(host: str, user: str, password: str, command: str, timeout: int = 600) -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=20, banner_timeout=20)
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout, get_pty=True)
    # Stream output
    for line in iter(stdout.readline, ""):
        if not line:
            break
        print(line, end="", flush=True)
    rc = stdout.channel.recv_exit_status()
    err = stderr.read().decode("utf-8", errors="replace")
    if err:
        print(err, file=sys.stderr, end="")
    client.close()
    return rc


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: ssh_exec.py HOST USER PASSWORD COMMAND", file=sys.stderr)
        sys.exit(2)
    sys.exit(run(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]))
