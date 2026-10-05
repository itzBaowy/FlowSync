# Deployment notes

Phase 1 provides buildable images and CI, not a deployed cloud service. Choose hosting and inject actual secrets before rollout.

1. Use a private network for PostgreSQL/Redis/object storage. Local MinIO is built from tagged [upstream releases](https://github.com/minio/minio/releases); production may use managed S3. Use bucket-scoped storage credentials instead of MinIO root credentials.
2. Terminate TLS at a trusted proxy; set `NODE_ENV=production`, `WEB_URL=https://app.example.com`, distinct signing secrets, and `TRUST_PROXY_HOPS` to the actual proxy depth. Never trust arbitrary forwarded IPs. Route API on the same site for SameSite=Lax refresh cookies.
3. Set `NEXT_PUBLIC_API_URL` at web image build time; it is public configuration embedded in JavaScript. Keep backend secrets out of build arguments/frontend bundles.
4. Run migration as a separate release job using the `migrator` target and production DATABASE_URL. Do not run `prisma migrate dev`, schema push or seed demo accounts in production. Apply backward-compatible expand/contract migrations before rolling API replicas.
5. Run API and web images as non-root, expose only the proxy, and configure liveness/readiness probes. Readiness includes the storage bucket; create it before rollout. Keep Swagger private if it should not be public.
6. Collect JSON logs with request IDs; redact credentials; add latency/error/failed-job metrics as domain modules arrive. Set retention and alert thresholds. Rate limiting currently uses Redis and fails closed if Redis is unavailable.
7. Schedule database backups, object lifecycle/retention and restore rehearsals. Session cleanup should keep rotated records for at least the JWT refresh lifetime so replay can still revoke a family; scheduled maintenance is a later milestone.
8. Before broad production use, complete RBAC/domain MVP tests, cross-tab refresh coordination, access-token revocation policy, password recovery/email verification, upload scanning, security review and load tests. Add explicit token/session expiry policy (current refresh sessions are sliding seven-day sessions).

Local Docker Compose intentionally uses HTTP/development cookie settings and loopback ports. For production, deploy targets with production ENV or provide an explicit Compose override removing local credentials/ports and setting HTTPS origins. Do not publish the local Compose configuration to an untrusted network.
