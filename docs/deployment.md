# Deployment notes

Phase 2 provides buildable API/web/worker images and CI. Cloud hosting is not provisioned. Choose hosting and inject actual secrets before rollout.

1. Use a private network for PostgreSQL/Redis/object storage. Local MinIO is built from tagged [upstream releases](https://github.com/minio/minio/releases); production may use managed S3. Use bucket-scoped storage credentials instead of MinIO root credentials.
2. Terminate TLS at a trusted proxy; set `NODE_ENV=production`, `WEB_URL=https://app.example.com`, distinct signing secrets, and `TRUST_PROXY_HOPS` to the actual proxy depth. Never trust arbitrary forwarded IPs. Route API on the same site for SameSite=Lax refresh cookies.
3. Set `NEXT_PUBLIC_API_URL` at web image build time; it is public configuration embedded in JavaScript. Keep backend secrets out of build arguments/frontend bundles.
4. Run migration as a separate release job using the `migrator` target and production DATABASE_URL. Do not run `prisma migrate dev`, schema push or seed demo accounts in production. Apply backward-compatible expand/contract migrations before rolling API replicas.
5. Run API and web images as non-root, expose only the proxy, and configure liveness/readiness probes. Readiness includes the storage bucket; create it before rollout. Keep Swagger private if it should not be public.
6. Collect JSON logs with request IDs; redact credentials; add latency/error/failed-job metrics as domain modules arrive. Set retention and alert thresholds. Rate limiting currently uses Redis and fails closed if Redis is unavailable.
7. Schedule database backups, object lifecycle/retention and restore rehearsals. Session cleanup should keep rotated records for at least the JWT refresh lifetime so replay can still revoke a family; scheduled maintenance is a later milestone.
8. Before broad production use, complete RBAC/domain MVP tests, cross-tab refresh coordination, access-token revocation policy, password recovery/email verification, upload scanning, security review and load tests. Add explicit token/session expiry policy (current refresh sessions are sliding seven-day sessions).

Phase 2 email deployment:

- Run `node dist/worker.js` from the API image in a separate process/container. Match API/worker `NODE_ENV`, database, Redis and `EMAIL_ENCRYPTION_KEY`; the queue name is environment-specific.
- Configure `SMTP_URL`, `EMAIL_FROM`, sender authentication and SMTP credentials through a secret manager. Production requires TLS; local Mailpit is a development capture service.
- Preserve the 64-character encryption key for pending outbox payloads. Key rotation requires migrating or draining those payloads first. Redis jobs contain only an outbox ID; tokens are never plaintext in Redis.
- Monitor worker startup, `email.failed`, `email.outbox_retry`, SMTP delivery and pending outbox age. Five failed attempts retain the job for seven days; automatic infinite retries are intentionally absent. Operational retry/dead-letter tooling is Phase 7.
- SMTP cannot guarantee exactly-once delivery after a worker crash. Stable Message-ID helps trace duplicates; the invitation can only be accepted once.

Logo deployment: `MINIO_ENDPOINT` is the internal API storage URL; `MINIO_PUBLIC_ENDPOINT` must be reachable by the browser and match the public S3 signing origin. Keep the bucket private. Logo responses are signed for five minutes; the organization screen refreshes metadata every four minutes. PNG/JPEG/WebP inputs are decoded, size/pixel bounded and re-encoded without metadata. Storage deletion is best-effort after DB commit; orphan reconciliation and malware scanning remain hardening work.

Local Docker Compose intentionally uses HTTP/development cookie settings and loopback ports. For production, deploy targets with production ENV or provide an explicit Compose override removing local credentials/ports and setting HTTPS origins. Do not publish the local Compose configuration to an untrusted network.
