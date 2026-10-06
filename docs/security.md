# Dependency and application security review

Review date: 06/10/2026. `npm audit --omit=dev` reports **0 vulnerabilities** after the Phase 9 dependency changes. CI runs `npm run audit:production` and rejects moderate/high/critical production findings. This is a registry advisory check, not a penetration test or a guarantee against undisclosed vulnerabilities.

## Dependency changes

- Nodemailer 10.0.15 replaces 7.x; real invitation/notification SMTP and retry tests pass. See [upstream releases](https://github.com/nodemailer/nodemailer/releases).
- Vitest 5.0.3 replaces 3.x and removes affected Vitest/Tinypool versions. Supported project Node engines are 22.12+ or 24 LTS; see [migration guidance](https://vitest.dev/guide/migration/).
- Node native watch mode replaces nodemon, reducing the development dependency graph.
- Scoped overrides pin `@nestjs/swagger > js-yaml` to 5.4.3, `prisma > mysql2` to 3.24.5 and `@prisma/config > deepmerge-ts` to 8.0.2. These parents pin older versions, so ordinary updates cannot resolve the advisories. Prisma schema validation, generation, migration deploy and HTTP integration tests verify the override compatibility. Application data uses PostgreSQL; the MySQL driver is a Prisma CLI dependency.

Relevant advisories: [js-yaml](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm), [mysql2](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3), [deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). Remove overrides when parent packages ship patched constraints, then rerun the same checks.

Full `npm audit` still reports **5 high findings** on the development chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. They represent one upstream issue and its affected parents. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched braces release. The lint configuration supplies fixed repository-owned glob patterns; application requests do not reach this tooling. API production dependencies omit it and web standalone output contains only traced runtime dependencies. Builder/migrator images retain development tooling and must not serve requests. Keep monitoring upstream; this finding is documented rather than silently suppressed or resolved by downgrading the framework.

## Application boundaries reviewed

Current tests exercise tenant scoping, membership revocation, privileged role/ownership changes, refresh rotation/replay, origin checks, rate limits, private downloads, upload content validation, optimistic version conflicts, queue deduplication, provider validation and explicit AI confirmation. Logs redact authorization/cookies; queue errors use fixed messages. Secrets, generated artifacts and local backups are ignored by Git.

Production uses secure HttpOnly refresh cookies, HTTPS origins, explicit trusted proxy hops and exact CORS. Deploy only isolated production database/Redis/bucket credentials. There is no public job recovery API. Operator status/retry commands require server access.

Web refresh/login/register/logout share an exclusive [Web Lock](https://w3c.github.io/web-locks/) per API origin. Tabs read the newly rotated cookie only after the previous response completes; access tokens stay in tab memory. Auth fetches timeout after 15 seconds so a stalled request releases its lock. Browser verification holds real refresh requests while three tabs reload, asserts one active request and checks subsequent reloads remain authenticated. Browsers without Web Locks retain per-tab single-flight; cross-tab coordination is not guaranteed in that fallback. Direct external clients must serialize their own refresh calls.

Remaining work includes account recovery/email verification, upstream lint advisory remediation, malware scanning beyond file content validation, live provider model verification and independent security testing. Already-issued access tokens remain valid up to their 15-minute expiry after logout; all domain actions still recheck current membership. Review SMTP/provider/account policies and off-host backup encryption as part of the deployment.
