# Buyback worker health

Release preparation installs Docker health checks for the standard and agency
buyback workers. Each worker writes a private record in its container's `/tmp`
after a completed cycle. Checks require the exact Devnet build, a live worker
PID and completion within three minutes. Failed cycles, missing records,
future timestamps and stale records fail the check. Docker checks every 30
seconds, with a 90-second startup grace and three retries.

This measures operational progress. An idle or funding-blocked completed cycle
can be healthy. Execution readiness still requires the existing application
heartbeat, current program and custody verification, funding and eligibility
checks. Docker health never grants permission to spend. Docker marks a stalled
worker unhealthy; its restart policy alone does not restart unhealthy processes.

Optional buyback history discovery uses a separate connection and a two-minute
deadline. The dashboard waits at most five seconds, then reports unavailable
history while the scan continues. Subsequent reads reuse that scan; completed
results and failures expire after 30 seconds. Current custody is verified
independently on every uncached dashboard scan. Previously verified receipts
remain visible if discovery is unavailable.
