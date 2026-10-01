"""Run the Devnet program upgrade CLI with short-lived signer files from stdin.

PowerShell passes JSON containing old and owner 64-byte keypair arrays. The
files exist only in WSL's temporary directory for the lifetime of this call.
Never print the input or keypair file contents.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PROGRAM = "2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik"
BUILD = str(Path(__file__).resolve().parents[1] / "contracts/funded-fee-router/target/deploy/funded_fee_router.so")
SOLANA_CLI = os.environ.get("SOLANA_CLI_PATH") or shutil.which("solana")
DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "transfer", "deploy", "close"):
        raise SystemExit("Usage: devnet-router-upgrade-cli.py check|transfer|deploy|close [buffer-address]")
    if not SOLANA_CLI:
        raise RuntimeError("Set SOLANA_CLI_PATH to the installed Solana CLI executable")
    payload = json.load(sys.stdin)
    rpc = payload.get("rpc", "devnet")
    if not (rpc == "devnet" or rpc.startswith("https://")) or any(char in rpc for char in "\r\n\"'"):
        raise ValueError("Only a Devnet RPC URL is allowed")
    keys = {}
    if sys.argv[1] == "check":
        with tempfile.TemporaryDirectory(prefix="funded-devnet-router-") as directory:
            config = Path(directory) / "cli.yml"
            config.write_text(f"---\njson_rpc_url: {rpc}\nwebsocket_url: ''\nkeypair_path: /root/.config/solana/id.json\naddress_labels: {{}}\ncommitment: finalized\n", encoding="utf8")
            os.chmod(config, 0o600)
            genesis = subprocess.run([SOLANA_CLI, "--config", str(config), "genesis-hash"],
                                     check=True, capture_output=True, text=True).stdout.strip()
            if genesis != DEVNET_GENESIS:
                raise ValueError(f"The RPC endpoint is not Solana Devnet (genesis {genesis!r})")
            print("Verified Solana Devnet genesis")
        return
    for role in ("old", "owner", "buffer"):
        if role == "buffer" and not payload.get(role):
            continue
        data = json.loads(payload[role])
        if len(data) != 64 or any(not isinstance(n, int) or n < 0 or n > 255 for n in data):
            raise ValueError("Invalid signer material")
        keys[role] = data
    with tempfile.TemporaryDirectory(prefix="funded-devnet-router-") as directory:
        paths = {}
        config = Path(directory) / "cli.yml"
        config.write_text(f"---\njson_rpc_url: {rpc}\nwebsocket_url: ''\nkeypair_path: /root/.config/solana/id.json\naddress_labels: {{}}\ncommitment: finalized\n", encoding="utf8")
        os.chmod(config, 0o600)
        genesis = subprocess.run([SOLANA_CLI, "--config", str(config), "genesis-hash"],
                                 check=True, capture_output=True, text=True).stdout.strip()
        if genesis != DEVNET_GENESIS:
            raise ValueError("The RPC endpoint is not Solana Devnet")
        for role, data in keys.items():
            path = Path(directory) / f"{role}.json"
            path.write_text(json.dumps(data), encoding="ascii")
            os.chmod(path, 0o600)
            paths[role] = str(path)
        if sys.argv[1] == "transfer":
            command = [SOLANA_CLI, "program", "set-upgrade-authority", PROGRAM,
                       "--upgrade-authority", paths["old"],
                       "--new-upgrade-authority", paths["owner"],
                       "--keypair", paths["old"], "--config", str(config), "--commitment", "finalized"]
        elif sys.argv[1] == "deploy":
            if not Path(BUILD).is_file():
                raise FileNotFoundError("Reviewed router SBF build is missing")
            command = [SOLANA_CLI, "program", "deploy", BUILD, "--program-id", PROGRAM,
                       "--upgrade-authority", paths["owner"],
                       "--keypair", paths["old"], "--config", str(config), "--commitment", "finalized",
                       "--use-rpc"]
            if "buffer" in paths:
                command.extend(["--buffer", paths["buffer"]])
        else:
            if len(sys.argv) != 3 or len(sys.argv[2]) < 32:
                raise ValueError("A buffer address is required")
            command = [SOLANA_CLI, "program", "close", sys.argv[2],
                       "--authority", paths["owner"], "--recipient", paths["old"],
                       "--keypair", paths["old"], "--config", str(config), "--commitment", "finalized"]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f"Devnet CLI {sys.argv[1]} failed (exit {result.returncode}); temporary buffer must be checked on chain")
        for label in ("Program Id", "Signature"):
            match = re.search(rf"^{label}: ([1-9A-HJ-NP-Za-km-z]+)$", result.stdout, re.MULTILINE)
            if match:
                print(f"{label}: {match.group(1)}")
        if sys.argv[1] == "close":
            print("Devnet buffer close submitted; verify closure and refund on chain")


if __name__ == "__main__":
    main()
