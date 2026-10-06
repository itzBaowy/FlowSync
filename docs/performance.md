# Bounded load smoke

```powershell
npm run test:load
```

This starts a compiled API on a random local port with test ENV, creates a unique account/organization/project and 25 real tasks through REST, then runs five concurrent clients. The measured workload is 50 authorized board snapshots and 15 optimistic task updates. Clients edit distinct tasks in the same board, exercising shared board/parent transaction locks. The final board revision must increase by 15 and all task versions/counts remain correct. Cleanup deletes only the generated fixture records and stops its API process.

The script refuses production ENV or a non-loopback database. It uses real local PostgreSQL/Redis/storage readiness, normal throttling and validated API responses. AI is disabled; no worker/provider request is made. The bounded profile stays below normal rate limits. Setup/warmup and cleanup are excluded from timing. A report is saved under ignored `.local/load-<id>.json`; CI runs this smoke after HTTP tests and restore verification.

Observed on 06/10/2026, Node 22.19.0, local Windows API + Docker PostgreSQL/Redis/MinIO:

| Metric   | Board reads | Task updates |
| -------- | ----------- | ------------ |
| Requests | 50          | 15           |
| p50      | 22.88 ms    | 134.85 ms    |
| p95      | 51.53 ms    | 243.78 ms    |
| Maximum  | 55.52 ms    | 243.78 ms    |

Measured interval: 749 ms, 86.78 requests/second, 0% HTTP errors. These are results for this small fixture and machine, not a production throughput/SLO claim. The CI smoke fails above p95 2 seconds or on any HTTP/data-integrity error; that generous threshold catches severe regressions while allowing slower shared runners.

Before production capacity planning, run a sustained workload against isolated staging with representative tenant sizes, task counts, attachment sizes, realtime rooms and worker queues. Measure saturation, database pool/lock waits, p95/p99, memory/CPU and recovery after dependency failures. Keep authorization/rate limiting enabled, use generated accounts and coordinate the traffic budget with the selected infrastructure. Existing HTTP tests separately cover concurrent conflicting moves/reorders; this profile measures normal successful updates.
