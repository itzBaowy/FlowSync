# Phase 7 — Durable background jobs

Hoàn thành ngày 06/10/2026. 24 unit/security tests, 75 HTTP integration tests và 9 browser flows đạt. Browser suite đạt cả trên local production builds và Docker Linux. API/web/migrator/worker đã rebuild; worker chạy invitation, notification, due reminder và file cleanup queues. `jobs:status` đã kiểm tra từ host và worker container.

Task assignment/mention, workspace/project membership alerts và due reminders lưu delivery outbox trong transaction với mutation. Redis chỉ giữ opaque record IDs và reminder version; không đưa email, comment text, meeting notes hoặc credentials vào job payloads. Invitation tokens vẫn mã hóa trong PostgreSQL và xóa sau delivery.

Due reminder chạy trong 24 giờ trước deadline cho current assignees còn đủ parent memberships. Deadline change, completion/archive và restore tăng version hoặc hủy/reschedule; worker kiểm tra lại task state dưới cùng parent locks. Notification dedupe key theo user/task/deadline ngăn tạo trùng khi retry. Task mutation có due date sẽ tạo/cập nhật schedule; tasks có trước upgrade cần được lưu lại để có schedule. Không gửi reminder cho deadline đã qua.

Email gửi cho assignment, mention, due date và workspace/project alerts; không gửi email cho mọi task update/comment. Trước SMTP, worker kiểm tra lại resource visibility và bỏ qua notification đã đọc hoặc đã mất quyền. Deep links mang đúng parent scope. Email đã gửi được đánh dấu để duplicate queue execution không gửi lại. SMTP có khoảng crash giữa send và commit delivered marker: delivery là at-least-once, stable Message-ID hỗ trợ downstream deduplication nhưng không bảo đảm exactly-once email.

Queues retry tối đa 5 attempts với exponential backoff; email/reminder bắt đầu 1 giây, file cleanup 5 giây. Invalid payloads là unrecoverable. Infrastructure exceptions được thay bằng fixed error text trước khi BullMQ ghi failure, tránh lưu provider/SMTP secrets. Failed delivery/reminder có trạng thái FAILED trong DB; file cleanup giữ error name và next retry time. Failed Redis jobs được giữ tối đa 7 ngày/1.000 jobs mỗi queue; completed jobs giữ 1 giờ/1.000. Pending outbox được pump lại sau restart hoặc Redis recovery.

File cleanup dùng durable reservation, lease và atomic claim. Worker dọn abandoned/deleted objects và luôn kiểm tra committed attachment trước khi xóa. Storage failures giữ record để retry. Cleanup thất bại sau hết attempts cần operator retry; nếu Redis job đã hết retention, CLI tạo lại từ DB. Completed bookkeeping được prune theo NODE_ENV sau 7 ngày; failed work vẫn giữ. Production worker cũng dọn refresh-token rows đã hết hạn hơn 7 ngày; replay markers không bị xóa sớm.

```powershell
npm run jobs:status
npm run jobs:retry -- email <notification-id>
npm run jobs:retry -- reminders <reminder-id>-<version>
npm run jobs:retry -- files <cleanup-id>
npm run jobs:retry -- invitations <outbox-id>
docker compose exec -T worker node dist/jobs-cli.js status
```

CLI chỉ dành cho operator có quyền truy cập ENV/server. Retry kiểm tra queue environment, DB record/current version và failed job state; không có public administration endpoint. Logs có queue/job ID/attempt count, không có payload. Worker graceful shutdown chờ active jobs, pump và failure bookkeeping rồi đóng Redis/DB/SMTP.

Tests dùng Redis, Mailpit và MinIO thật: duplicate reminder/email, private realtime worker → API invalidation, stale deadline/environment isolation, revoked/read recipients, malformed payload, SMTP failure + manual retry sau restart, scoped retention, private workspace/project alerts và preservation of committed attachment objects. Realtime invalidation dùng Redis pub/sub; inbox REST polling 30 giây vẫn phục hồi khi tín hiệu bị mất. Đây chưa phải durable event stream.

Retry quyết định dựa trên [BullMQ retry/backoff documentation](https://docs.bullmq.io/guide/retrying-failing-jobs). Phase 8 triển khai provider abstraction, context scoping, validated suggestions và explicit confirmation; cloud deployment tiếp tục Phase 9.
