"""Bounded V3 Devnet upgrade. Signer input is never printed or retained."""
import base64,hashlib,json,os,subprocess,sys,tempfile
from urllib.parse import urlparse
from pathlib import Path
PROGRAM="9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm"
AUTHORITY="7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y"
GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
CLI="/home/tuan/.local/share/solana/install/active_release/bin/solana"
payload=json.load(sys.stdin)
binary=Path(sys.argv[1]); expected=sys.argv[2]
if hashlib.sha256(binary.read_bytes()).hexdigest()!=expected: raise SystemExit("Candidate binary hash differs")
rpc=payload.get("rpc","https://api.devnet.solana.com")
if urlparse(rpc).scheme!="https" or any(char in rpc for char in "\r\n"): raise SystemExit("Invalid Devnet RPC")
with tempfile.TemporaryDirectory(prefix="funded-v3-upgrade-") as folder:
    paths={}
    for role in ("authority",) if payload.get("resumeBuffer") else ("authority","buffer"):
        values=payload[role]
        if len(values)!=64 or any(type(n)!=int or n<0 or n>255 for n in values): raise SystemExit("Invalid signer input")
        path=Path(folder)/f"{role}.json";path.write_text(json.dumps(values));os.chmod(path,0o600);paths[role]=str(path)
    def run(args):
        result=subprocess.run([CLI,*args,"--url",rpc,"--keypair",paths["authority"],"--commitment","finalized"],capture_output=True,text=True)
        if result.returncode:
            reason="rate-limit" if "429" in result.stderr else "insufficient-funds" if "insufficient" in result.stderr.lower() else "cli-failure"
            detail=next((line for line in result.stderr.splitlines() if line.startswith("Error:")),"No CLI error summary").replace(rpc,"<devnet-rpc>")[:300]
            raise RuntimeError(f"Devnet CLI {args[0:2]} failed: {reason}; {detail}")
        return result.stdout
    if run(["genesis-hash"]).strip()!=GENESIS: raise SystemExit("Not Devnet")
    prior=json.loads(run(["program","show",PROGRAM,"--output","json"]))
    if prior.get("programId")!=PROGRAM or prior.get("authority")!=AUTHORITY: raise SystemExit("Program identity or authority changed")
    if payload.get("resumeBuffer"):
        if not payload.get("skipBufferWrite"):
            run(["program","write-buffer",str(binary),"--buffer",payload["resumeBuffer"],
                 "--buffer-authority",paths["authority"],
                 *(["--use-tpu-client","--use-quic"] if payload.get("tpu") else ["--use-rpc"]),
                 "--max-sign-attempts","1" if payload.get("tpu") else "5"])
        uploaded=json.loads(run(["account",payload["resumeBuffer"],"--output","json"]))
        content=base64.b64decode(uploaded["account"]["data"][0])
        if hashlib.sha256(content[37:]).hexdigest()!=expected: raise RuntimeError("Uploaded buffer differs from tested binary")
    if payload.get("uploadOnly"):
        if not payload.get("resumeBuffer"): raise RuntimeError("Upload-only requires the existing buffer")
        print(json.dumps({"status":"verified-buffer","buffer":payload["resumeBuffer"],"sha256":expected}))
        raise SystemExit(0)
    run(["program","deploy",str(binary),"--program-id",PROGRAM,"--upgrade-authority",paths["authority"],
         "--buffer",payload.get("resumeBuffer") or paths["buffer"],"--use-rpc","--max-sign-attempts","5"])
    final=json.loads(run(["program","show",PROGRAM,"--output","json"]))
    print(json.dumps({"program":PROGRAM,"authority":final.get("authority"),"slot":final.get("lastDeploySlot"),"dataLen":final.get("dataLen")}))
