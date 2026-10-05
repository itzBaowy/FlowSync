# Phase 4 verification — 06/10/2026

Đã hoàn thành Phase 1–4 theo Requirements.md, gồm organization/logo/invitations và private workspace/project CRUD, members, project owner transfer, status/date validation và overview. Chưa hoàn thành toàn bộ MVP ở mục 34; Realtime/collaboration ở các phase sau.

| Check                       | Kết quả                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Prisma schema validation    | Pass, Prisma 7.10.0                                                                               |
| SQL migrations              | Foundation + organization policy + invitation outbox/environment applied; Docker migration exit 0 |
| TypeScript strict typecheck | Pass cho contracts, API, web                                                                      |
| ESLint / Prettier           | Pass                                                                                              |
| Production build            | Pass cho Next.js và NestJS                                                                        |
| Unit/security tests         | 16 pass: auth, RBAC, scope policy, PATCH omission, encryption and Kanban contracts                |
| HTTP integration tests      | 44 pass on real PostgreSQL/Redis/MinIO/Mailpit                                                    |
| Browser tests               | 8 pass on local builds and Linux Docker containers                                                |
| Docker targets              | API, web, migrator, worker và source-built MinIO build thành công                                 |
| Compose runtime             | API/PostgreSQL/Redis/MinIO/Mailpit healthy; web/worker chạy; init exit 0                          |

HTTP tests kiểm tra auth/rotation/replay/throttling, organization CRUD, cross-tenant isolation, role/owner protection, concurrent ownership transfer, invite duplicate/expiry/revoke/email mismatch/concurrent accept/reuse, email SMTP thật và ảnh giả MIME/oversize/private object. Browser kiểm tra auth/dark mode/mobile; create/settings/logo/delete organization; role/removal/transfer bằng hai tài khoản; email capture → matching-email registration → accept → replay rejection. Dialog dùng native focus trap/Escape và ID label riêng.

Screenshot thật ở [screenshots/](screenshots/). Test accounts được tạo với email duy nhất và xóa sau test; không seed credentials cho người dùng.

Stack hiện chạy ở web http://localhost:3100, API http://localhost:4000/api, Swagger http://localhost:4000/api/docs. Cổng riêng của Redis/MinIO là 16379 và 19000/19001 để không ảnh hưởng dự án khác. Các services nằm trong Compose project `flowsync`.

Sau khi người dùng khắc phục dung lượng ổ C, đã build và chạy lại các container Phase 2 thành công. Các build loại browser artifacts/screenshots khỏi context; runtime API chỉ cài dependencies backend/contracts. Không xóa volumes hoặc containers của dự án khác.

Repository đã kết nối [GitHub FlowSync](https://github.com/itzBaowy/FlowSync), branch `main`; commit/push theo từng lát. CI Linux của code Phase 2 ở commit `160d2bf` [đã xanh](https://github.com/itzBaowy/FlowSync/actions/runs/37342707321). Các commit mới tự chạy CI. Chưa provision cloud deployment. Cross-tab refresh coordination, password recovery/email verification, dead-letter tooling và orphan object reconciliation còn ở các milestone hardening.

Phase 3 verifies workspace/project CRUD, private memberships, persisted date invariants, ownership concurrency, public profiles, descendant cleanup, structural delete protection and actual overview data. Browser tests cover CRUD/mobile and two-account membership/owner transfer/access revocation. Delivery outboxes are isolated by NODE_ENV.

Phase 4 adds scoped board/column/task CRUD, multiple assignees, project labels, checklist versions, archive/restore and transactional fractional ranking. Browser verification covers pointer and keyboard moves, empty columns, persistent ordering, optimistic state before a held response, 409 rollback and mobile layout. API tests include concurrent moves/edits/reorders and private scope boundaries. Docker API/web/migrator/worker and the browser suite are verified at this milestone.
