# Production deployment

Phase 9 provides a separate `compose.production.yaml`, Caddy TLS proxy, non-root application images, production dependency audit and backup/restore tooling. Cloud infrastructure and public DNS are not provisioned. Choose a server and isolated PostgreSQL/Redis/S3 services before running this configuration.

## Prepare the environment

Copy `.env.production.example` to an ignored `.env.production` on the server and replace every placeholder. Use a secret manager or restrict file permissions. Set `FLOWSYNC_DOMAIN` to the public hostname, `WEB_URL=https://<hostname>` and `NEXT_PUBLIC_API_URL=https://<hostname>/api`. Keep distinct signing secrets and retain the invitation encryption key. API and worker must share environment/database/Redis/bucket and AI provider configuration.

Provision a private PostgreSQL 17 database, password-protected Redis and a private S3-compatible bucket. Use bucket-scoped storage credentials. `MINIO_ENDPOINT` may use an internal network URL; `MINIO_PUBLIC_ENDPOINT` must use browser-reachable HTTPS for signed downloads. Production validates this requirement. Configure authenticated SMTP with TLS and sender verification; Mailpit belongs only to local development. AI remains disabled until a model and provider key are configured and smoke tested.

Point DNS at the host and open only ports 80/443. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) obtains/renews certificates and redirects HTTP. Preserve its data volume across releases. API/web have no published host ports; the proxy handles `/api/*`, Socket.IO `/socket.io/*` and frontend routes on one origin. Swagger is disabled in production. Query strings are not access-logged because signed URLs may contain credentials. HSTS applies to this hostname without forcing other subdomains.

This configuration assumes one Caddy proxy directly in front of API and sets `TRUST_PROXY_HOPS=1`. If a CDN/load balancer is added, explicitly configure trusted proxy CIDRs and actual hop depth; do not trust arbitrary forwarded headers. Keep API inaccessible outside the private application network.

## Build and release

From a checkout of a verified commit on the server:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build api migrate web
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build
docker compose --env-file .env.production -f compose.production.yaml ps
```

Set `FLOWSYNC_RELEASE` to the commit SHA so image tags identify the release. Frontend public API configuration is embedded at build time; it is not a runtime secret. Production Compose has no database/Redis/MinIO/Mailpit services: inject the actual private service endpoints rather than exposing local credentials/ports. Read-only app filesystems have ephemeral writable caches, dropped Linux capabilities, bounded container logs and PID-1 signal handling.

The migrator is a release job using `prisma migrate deploy`. Never use migrate dev/schema push on production. Both an explicit migration command and the dependency job can run; deploy is idempotent. Container startup waits for successful migrations and API readiness. Readiness checks PostgreSQL, Redis and the configured bucket; web has its own HTTP probe. Worker operator commands run inside its container:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec -T worker node dist/jobs-cli.js status
docker compose --env-file .env.production -f compose.production.yaml exec -T worker node dist/jobs-cli.js retry ai <run-id>
```

## Rollout, monitoring and recovery

CI checks contracts, strict types, lint/format, builds, unit/HTTP/browser tests, production advisory audit and a real isolated database restore. Before serving users, verify HTTPS, Secure/HttpOnly/SameSite refresh cookies, login/refresh/logout, same-origin mutation protection, private downloads, Socket.IO reconnect and SMTP delivery on the target infrastructure. Fixtures do not verify production SMTP/provider credentials or public certificate issuance.

Collect API JSON logs with request IDs, user ID, path, status and response duration. Authorization/cookies are redacted and query strings/body contents are omitted. Collect fixed-message queue failures and monitor pending outbox age, failed-job counts, queue delays, disk capacity, health probes, p95 latency and error rate. Docker health status alone does not restart unhealthy containers; an external monitor/orchestrator must alert or replace them. Set thresholds from measurements, not assumed capacity.

Worker container liveness checks a local heartbeat written every 10 seconds after both workers start, and fails when it is older than 30 seconds. This detects a stopped/stalled process; it does not certify SMTP/provider availability or completed queue delivery. Use API readiness, queue status and pending/failed-job monitoring for dependency health. Run one worker process per container. Heartbeat files live in ephemeral `/tmp` and are removed during graceful shutdown.

Use expand/contract migrations for rolling releases. Record the last healthy image SHA and a verified backup before migration. Rollback application images only if the schema remains backward compatible. Destructive SQL has no automatic safe undo: use a reviewed forward repair or restore into a separate database, validate it, then switch traffic/connections during a maintenance window. Never restore over the live database to experiment. Keep workers stopped during restoration/reconciliation to avoid duplicate SMTP or AI requests.

[Backup operations](backups.md) describe local binary-safe archives and restore rehearsals; production needs encrypted off-host database/PITR and object backups with measured RPO/RTO. Preserve server secrets separately. [Security review](security.md) records the dependency findings and remaining work. Password recovery/email verification, malware scanning and independent security testing remain future improvements. SMTP remains at-least-once; stable Message-ID and invitation single-use checks cannot guarantee exactly-once email.

Local `compose.yaml` remains an HTTP development environment on loopback ports. Do not publish it on an untrusted network. Production Compose/Caddy syntax is validated locally; an actual cloud rollout awaits the chosen host, domain and credentials.
