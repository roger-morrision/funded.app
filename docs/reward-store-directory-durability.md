# Linux ledger publication fence

MN001/MN006 adds a filesystem namespace fence to the existing exact-byte store.
On Linux, a transaction now finishes temporary-file/lock cleanup and then syncs
the canonical ledger directory and its same-filesystem ancestor chain before
its promise can resolve successfully. This includes byte-identical transactions
and first-use recursive directory creation. Existing mounted filesystem roots
and configured symlink namespaces must be provisioned by infrastructure; the
walk stops before a parent on a different device. It resolves the real directory
and reaches the filesystem root if no device boundary intervenes. Directory
open, stat, sync and close failures are errors, never a silent Linux bypass.

The [Linux fsync manual](https://man7.org/linux/man-pages/man2/fsync.2.html)
distinguishes syncing file data/inode metadata from syncing the directory entry.
The retained ext4 baseline observed file sync, rename and caller return with no
directory sync. This was a missing observed fence, not reproduced power-loss
data loss. The new code implements that API-level fence; these tests do not
establish physical device/cache behavior during host power failure.

Only byte-identical existing ledger data avoids temporary-file publication.
Bootstrap, v1-to-v2 migration and changed signed wire/proof/status still serialize,
file-sync and rename. Additional directory flushes do not count as Solana
transactions or financial fee savings. Public read/cache APIs, queue, drain,
work limits, entitlement and receipt rules remain unchanged.

A failed fence after rename can leave the new canonical file visible. The cache
is invalidated when publication happens, and a second store sees that state.
The caller receives an error and its dependent action is suppressed. The code
does not undo a journal, expire a lock automatically, promote an orphan or
authorize a new financial attempt. An actual synthetic payout-journal case proves
the signed prepared attempt survives while broadcast stays zero; recovery cannot
request a replacement blockhash or signature.

Primary mutation/publication failures and secondary close/cleanup/fence failures
are retained together as AggregateError causes. Single failures retain their
original identity. Numeric HTTP status/statusCode survive aggregation. A failed
lock close retains its marker for investigation, as before. All cleanup attempts
needed by the existing protocol still run, and queue/drain tracking includes the
durability completion. No caller option or runtime flag can disable the fence.

Windows retains its previous file-sync behavior because this API does not supply
the directory-descriptor fence there. Windows tests are compatibility evidence,
not Linux directory durability. The Linux-specific checked command rejects an
unsupported platform and missing/zero/skipped required coverage:

```text
node scripts/check-reward-store-directory.mjs
node scripts/check-reward-store-persistence.mjs
```

Ten required Linux cases cover nested bootstrap/ancestors, no-op inode retention,
migration, post-rename visibility/cache/second-store state, open/close failures,
combined primary/sync/close errors, retained failed-close marker and actual
signed-journal suppression. The same ten bodies against the exact prior store
produce nine failures; the existing failed-lock-close control already passes.
The correction passes 10/10. The independently authored nested-bootstrap probe
is copied unchanged and now finds all three required directory fences. The
existing affected store/journal inventory passes 288/288 on both Node 24 Windows
and Linux, with zero fail/skip/TODO. No unrelated healthy UI/build/chain replay
or contract binary change is needed for this slice.

Source layout matters: the Docker image provisions `/app/data`; preview/reward
worker Compose mounts a dedicated ledger volume at `/app/data/automatic-rewards`
with `ledger.json` directly inside. The Devnet release also supports a broader
volume mounted at `/app/data`, with a newly created `automatic-rewards` child.
Explicit store paths and the default `data/automatic-rewards.json` remain
supported. The same-device ancestor walk covers new child entries in these
layouts; release verification must still bind the actual mount and permissions.

Controlled ext4 observations compare the unchanged marker-only benchmark body
against the prior and current store under the same local 0.75 CPU/512 MiB limits.
They retain 32 unresolved interfaces, 33 recovery store transactions and two
ledger replacements writing 3,786,064 bytes. The directory-sync observer includes
fixture bootstrap, fresh selection and recovery, rather than attributing all
flushes to recovery. Its extra counter and existing JSON/stat observers add cost;
single local timings are not an SLA or provider/financial throughput measurement.
Across fixture bootstrap, fresh selection and recovery, the current run observed
105 directory syncs versus zero before (35 transactions across three directories).
Recovery elapsed was 1,302.46 ms before and 1,290.25 ms after in this single local
comparison; this does not establish a speedup. Peak RSS was 131,064/126,324 KiB,
which also does not establish production headroom or lower memory usage.
Full application/normal worker load, production backup and host power-loss
acceptance remain open, together with original archive/live28, operational roles
and final funding. Cap 1,000 and the Contract9713/3f8/Loader packet are unchanged.
