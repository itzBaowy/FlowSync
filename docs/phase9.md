# Phase 9 — Production tooling và kiểm chứng

Đã triển khai và kiểm chứng tooling production tại máy ngày 06/10/2026. Phase 1–8 tiếp tục qua toàn bộ regression tests. Rollout staging/production công khai chưa thực hiện vì chưa có server, domain và credentials; không coi local TLS là bằng chứng deploy cloud.

| Requirement       | Implementation và bằng chứng                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker production | Compose riêng, Caddy HTTPS, app non-root/read-only, dropped capabilities, private external database/Redis/storage, migration trước API; runtime đã kiểm tra trong stack riêng                                        |
| CI/CD             | CI chạy types/lint/build/tests/audit/restore/load/TLS; workflow manual publish API/web/migrator lên GHCR chỉ nhận commit `main` có CI thành công, action pin SHA, tag riêng theo domain/run/attempt, provenance/SBOM |
| Security review   | Production audit 0 findings; nâng dependency, test refresh giữa ba tab, HTTPS/Secure cookie/private file/Origin checks; 5 high findings ở lint tooling vẫn được ghi nhận                                             |
| Logging và health | JSON request logs redacted secrets/query, fixed worker failures, bounded Docker logs; readiness gộp concurrent probes và cache 2 giây, worker heartbeat 10 giây/expiry 30 giây                                       |
| Backup/recovery   | PostgreSQL exported snapshot + binary custom archive + SHA-256; restore vào database tạm, đối chiếu 31 bảng/migrations/constraints, xóa riêng database tạm; hướng dẫn PITR/object backup/rollback                    |
| Performance       | 5 concurrent clients, 50 board reads và 15 task updates; 0 lỗi, kiểm tra versions/revision; p95 local 51.53 ms/read và 243.78 ms/update                                                                              |
| Deployment smoke  | 16 checks trên stack `NODE_ENV=production` riêng, HTTPS với CA local được tin cậy và certificate verification bật; teardown riêng project/volumes                                                                    |
| README            | Architecture, tính năng, setup, ENV, API, kiểm thử, screenshot thật và hướng dẫn production đã cập nhật                                                                                                              |

## Kết quả kiểm tra

- Strict typecheck, lint/format và production builds đạt.
- 31 unit tests; 87 HTTP integration tests trên PostgreSQL/Redis/MinIO/Mailpit thật; 10 browser tests trên app local và Linux Docker containers.
- Docker API và worker healthy; worker health command exit 0, CLI kiểm tra đủ năm queue.
- Production TLS smoke đạt readiness, HTTP redirect, frontend, hidden Swagger, hostile Origin rejection, Secure/HttpOnly/SameSite/HSTS, refresh rotation, Bearer profile, scoped resource creation, upload, signed HTTPS download, anonymous download rejection, private WebSocket subscription, logout revocation, worker heartbeat và read-only/capability settings.
- Archive sai hash hoặc đường dẫn vượt thư mục backup bị từ chối trước khi tạo database restore. Load test kiểm tra dữ liệu cuối cùng, không chỉ HTTP status.

Browser AI dùng inference fixtures nhưng tạo task qua confirmation API thật. Mailpit kiểm chứng SMTP/queue tại máy; chưa kiểm chứng sender/service production. Xem [verification](verification.md) để biết commit/CI đã xác nhận.

## Chạy lại

```powershell
npm run audit:production
npm run verify:backup
npm run test:load
npm run test:production
docker compose exec -T worker node dist/worker-health.js
docker compose exec -T worker node dist/jobs-cli.js status
```

Restore/load tools chỉ nhận local/test database; production smoke tự tạo credentials và hạ tầng tạm. Reports/backups/config ở `.local` được Git ignore. Backup chứa dữ liệu nhạy cảm và không được đưa lên public artifact. Không chạy integration/browser fixtures trên database production.

## Rollout còn lại

Cần chọn host cùng domain, provision PostgreSQL/Redis/S3 riêng, SMTP và secret storage. Sau đó chạy CI thành công cho release commit, build/publish image với public API URL đúng domain, lưu digests, migrate và rollout theo [deployment](deployment.md). Kiểm tra public DNS/TLS renewal, cookie/realtime/private download, production SMTP và model/provider với key thật; cấu hình external alerts và off-host encrypted backups/PITR rồi diễn tập restore theo RPO/RTO mong muốn.

Workflow GHCR chưa được dispatch; chưa publish image hay mở cổng internet trên máy này. Docker health không tự restart container unhealthy. Database backup chưa bao gồm S3 object bodies, Redis, role definitions hoặc secrets. Chỉ số load nhỏ tại máy không phải công suất production. Các giới hạn và hướng dẫn chi tiết nằm trong [security](security.md), [backups](backups.md) và [performance](performance.md).
