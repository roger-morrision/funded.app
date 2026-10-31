"""Bounded V3 Devnet upgrade. Signer input is never printed or retained."""
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
PROGRAM="9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm"
AUTHORITY="7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y"
GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
CLI="/home/tuan/.local/share/solana/install/active_release/bin/solana"
payload=json.load(sys.stdin)
binary=Path(sys.argv[1]); expected=sys.argv[2]
if hashlib.sha256(binary.read_bytes()).hexdigest()!=expected: raise SystemExit("Candidate binary hash differs")
rpc="https://api.devnet.solana.com"
with tempfile.TemporaryDirectory(prefix="funded-v3-upgrade-") as folder:
    paths={}
    for role in ("authority","buffer"):
        values=payload[role]
        if len(values)!=64 or any(type(n)!=int or n<0 or n>255 for n in values): raise SystemExit("Invalid signer input")
        path=Path(folder)/f"{role}.json";path.write_text(json.dumps(values));os.chmod(path,0o600);paths[role]=str(path)
    def run(args):
        result=subprocess.run([CLI,*args,"--url",rpc,"--keypair",paths["authority"],"--commitment","finalized"],capture_output=True,text=True)
        if result.returncode: raise RuntimeError("Devnet CLI failed; reconcile the recorded buffer and program before retrying")
        return result.stdout
    if run(["genesis-hash"]).strip()!=GENESIS: raise SystemExit("Not Devnet")
    prior=json.loads(run(["program","show",PROGRAM,"--output","json"]))
    if prior.get("programId")!=PROGRAM or prior.get("authority")!=AUTHORITY: raise SystemExit("Program identity or authority changed")
    run(["program","deploy",str(binary),"--program-id",PROGRAM,"--upgrade-authority",paths["authority"],
         "--buffer",paths["buffer"],"--use-rpc","--max-sign-attempts","5"])
    final=json.loads(run(["program","show",PROGRAM,"--output","json"]))
    print(json.dumps({"program":PROGRAM,"authority":final.get("authority"),"slot":final.get("lastDeploySlot"),"dataLen":final.get("dataLen")}))
