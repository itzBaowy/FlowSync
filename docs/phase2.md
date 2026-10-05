# Phase 2 — Organization implementation plan

Triển khai từng lát nhỏ, kiểm tra rồi commit và push `main` ngay sau mỗi lát.

1. **RBAC contracts/policy:** permission enum, role policy, request guard xác minh resource membership. Không tin organization ID hoặc role từ client; role được đọc lại từ DB cho mỗi action.
2. **Organization CRUD:** create với OWNER membership trong transaction, list theo membership có pagination/sort/filter, detail/update/delete với permission thật. Delete chỉ organization rỗng; không cascade mất workspace/audit. Thêm cấu hình cho phép ADMIN invite và unique pending invitation.
3. **Membership:** danh sách profile công khai, đổi ADMIN/MEMBER role, remove member, chuyển ownership atomic. Khóa organization row trong transaction cho mọi mutation; owner không bị remove/demote qua endpoint member. Transfer kiểm tra target đã là thành viên và demote owner cũ thành ADMIN.
4. **Invitation + email:** opaque token một lần, chỉ lưu SHA-256, expiry và trạng thái. Owner hoặc ADMIN được phép invite; acceptance yêu cầu email khớp current user. Pending cùng email không được duplicate; revoke, expiry và acceptance cạnh tranh được serialize. Email qua BullMQ worker, retry/backoff, local Mailpit. Payload Redis mã hóa, job kiểm tra trạng thái trước gửi; SMTP không được dùng thật trong tests.
5. **Logo:** upload PNG/JPEG/WebP với kiểm tra magic bytes, giới hạn 2 MiB, authorization, private bucket, presigned URL ngắn hạn. Xóa object cũ best-effort; metadata commit trước cleanup.
6. **Web:** create/select organization, settings, members, role/owner controls, invitations và accept page. Hiển thị permission đúng; API vẫn kiểm tra độc lập. Không triển khai workspace/project/Kanban ở Phase 2.
7. **Verification/documentation:** adversarial cross-tenant/RBAC tests, ownership concurrency, invitation reuse/email mismatch/expiry/revoke, actual SMTP capture và browser flow; cập nhật roadmap/README.

Email delivery không thể bảo đảm exactly-once qua SMTP: retry có thể gửi trùng nếu worker crash sau send trước acknowledge. Invitation acceptance vẫn idempotent ở DB; job payload không chứa token plaintext. Một delivery outbox bền vững bảo đảm lời mời có thể enqueue lại sau lỗi Redis; token delivery encrypted, token acceptance chỉ lưu hash.

RBAC OWNER quản lý organization, role, owner transfer, delete. ADMIN chỉ invite khi organization cho phép; MEMBER đọc organization và members của chính tenant. Các scope workspace/project sẽ có policy riêng ở Phase 3.
