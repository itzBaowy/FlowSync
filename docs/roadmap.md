# Milestones và acceptance criteria

| Phase                               | Deliverable                                                                   | Kiểm tra trước khi đi tiếp                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 — Foundation (hoàn thành)         | npm monorepo, web/API, auth, DB schema, Docker, Swagger, ENV, CI              | Build/typecheck/lint; register → login → me → refresh → replay → logout; readiness services thật |
| 2 — Organization (hoàn thành)       | CRUD + logo, membership, owner transfer, RBAC, invitation email/accept/revoke | Cross-tenant/RBAC, concurrency, SMTP và browser flow đã kiểm tra                                 |
| 3 — Project management (hoàn thành) | Workspace/project CRUD + membership/transfer, overview                        | Private scopes, date PATCH, 2-account browser access revocation đã kiểm tra                      |
| 4 — Kanban (hoàn thành)             | Board/column/task CRUD, assignment, labels, checklist, archive, dnd-kit       | Thứ tự bền vững, cross-board move bị chặn, optimistic rollback, concurrency tests                |
| 5 — Realtime                        | Socket.IO auth + Redis adapter, board rooms, notification, presence           | Hai browser nhận update; reconnect/gap recovery; room permission + token expiry                  |
| 6 — Collaboration / MVP done        | Comments/mentions, activity, attachments, search, inbox, personal tasks       | Flow mục 34 chạy end-to-end; mention notifications, download permission, MIME/size checks        |
| 7 — Queue hardening                 | Worker deployment, retry/idempotency, email/maintenance/file jobs             | Duplicate delivery không duplicate side effect; retries/failure observability                    |
| 8 — AI                              | Provider abstraction, summary/overdue, meeting-note suggestions               | Validated JSON, context tenant scoped, confirmation trước task creation                          |
| 9 — Production                      | Staging/prod deploy, TLS, monitoring, backups, security review                | Restore rehearsal, migration rollback plan, load test, deployment smoke test                     |

Mỗi phase làm theo module, có migration khi thay đổi dữ liệu và giữ toàn bộ checks trước đó xanh. Phase 1 không expose endpoint CRUD cho domain còn lại chỉ vì schema đã có entity. Không tự động publish/deploy khi chưa có môi trường và cấu hình thật.
