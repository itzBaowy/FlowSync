# Phase 8 verification — 06/10/2026

Đã hoàn thành implementation Phase 1–8 theo Requirements.md và luồng MVP ở mục 34. AI đã kiểm tra với provider fixtures; live provider smoke và production deployment đang tiếp tục.

| Check                       | Kết quả                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Prisma schema validation    | Pass, Prisma 7.10.0                                                                                        |
| SQL migrations              | 10 checked-in migrations applied, including durable AI jobs; Docker migration exit 0                       |
| TypeScript strict typecheck | Pass cho contracts, API, web                                                                               |
| ESLint / Prettier           | Pass                                                                                                       |
| Production build            | Pass cho Next.js và NestJS                                                                                 |
| Unit/security tests         | 28 pass: AI adapters, auth, RBAC, contracts, mention parsing, encryption and attachment content validation |
| HTTP integration tests      | 87 pass on real PostgreSQL/Redis/MinIO/Mailpit                                                             |
| Browser tests               | 10 verified on local builds and Linux Docker containers                                                    |
| Docker targets              | API, web, migrator, worker và source-built MinIO build thành công                                          |
| Compose runtime             | API/PostgreSQL/Redis/MinIO/Mailpit healthy; web/worker chạy; init exit 0                                   |

HTTP tests kiểm tra auth/rotation/replay/throttling, organization CRUD, cross-tenant isolation, role/owner protection, concurrent ownership transfer, invite duplicate/expiry/revoke/email mismatch/concurrent accept/reuse, email SMTP thật và ảnh giả MIME/oversize/private object. Browser kiểm tra auth/dark mode/mobile; create/settings/logo/delete organization; role/removal/transfer bằng hai tài khoản; email capture → matching-email registration → accept → replay rejection. Dialog dùng native focus trap/Escape và ID label riêng.

Screenshot thật ở [screenshots/](screenshots/). Test accounts được tạo với email duy nhất và xóa sau test; không seed credentials cho người dùng.

Stack hiện chạy ở web http://localhost:3100, API http://localhost:4000/api, Swagger http://localhost:4000/api/docs. Cổng riêng của Redis/MinIO là 16379 và 19000/19001 để không ảnh hưởng dự án khác. Các services nằm trong Compose project `flowsync`.

Sau khi người dùng khắc phục dung lượng ổ C, đã build và chạy lại các container Phase 2 thành công. Các build loại browser artifacts/screenshots khỏi context; runtime API chỉ cài dependencies backend/contracts. Không xóa volumes hoặc containers của dự án khác.

Repository đã kết nối [GitHub FlowSync](https://github.com/itzBaowy/FlowSync), branch `main`; commit/push theo từng lát. CI Linux của code Phase 2 ở commit `160d2bf` [đã xanh](https://github.com/itzBaowy/FlowSync/actions/runs/37342707321). Các commit mới tự chạy CI; run của `cd83d20` đang in progress tại lần kiểm tra. Chưa provision cloud deployment. Cross-tab refresh coordination, password recovery/email verification và full bucket reconciliation còn ở các milestone hardening.

Phase 3 verifies workspace/project CRUD, private memberships, persisted date invariants, ownership concurrency, public profiles, descendant cleanup, structural delete protection and actual overview data. Browser tests cover CRUD/mobile and two-account membership/owner transfer/access revocation. Delivery outboxes are isolated by NODE_ENV.

Phase 4 adds scoped board/column/task CRUD, multiple assignees, project labels, checklist versions, archive/restore and transactional fractional ranking. Browser verification covers pointer and keyboard moves, empty columns, persistent ordering, optimistic state before a held response, 409 rollback and mobile layout. API tests include concurrent moves/edits/reorders and private scope boundaries. Docker API/web/migrator/worker and the browser suite are verified at this milestone.

Phase 5 verifies authenticated Socket.IO, Redis fanout between API replicas, post-commit board events, immediate membership revocation, token expiry, distributed presence leases/caps, persisted recipient-scoped notifications and web reconnect/inbox/deep-link flows. See [Phase 5](phase5.md) for delivery limits and exact verification scope.

Phase 6 verifies scoped comments/mentions and version conflicts, transactional activity retention/rollback, private attachment upload/download/deletion/compensation, global search privacy, assignment scope and actual dashboard aggregates. The full browser suite passes on local production builds and Linux Docker containers. See [Phase 6](phase6.md).

Phase 7 verifies real SMTP failure/retry/restart, deduplicated reminders/email, notification permission checks at delivery, scoped workspace/project alerts, invalid payload failures, environment retention and safe file cleanup. Docker worker starts all queues; CLI status runs inside container and all 9 browser flows pass again. See [Phase 7](phase7.md).

Phase 8 verifies validated provider adapters, private bounded context, overdue priority sampling, durable queued requests, permission revocation, safe failure/retry, confirmation batch rollback and concurrent idempotency. All 10 browser flows pass on local builds and Docker; worker queue status is verified. No live LLM credentials were used. See [Phase 8](phase8.md).
