# Phase 3 — Workspace and project management

Đã triển khai API và UI `/workspaces`, `/projects` với CRUD, scope members, project ownership và overview. Unit contracts/policy, 9 HTTP workspace/project cases và 2 browser flows (CRUD/mobile + 2-account membership/transfer/revocation) đã chạy thành công.

Triển khai theo lát: shared contracts + scope policy → workspace CRUD/membership → project CRUD/membership/overview → web → verification. Mỗi lát có tests, commit và push `main` riêng.

OWNER/ADMIN organization được quản lý mọi workspace/project trong organization. MEMBER chỉ đọc workspace đã được thêm vào và project đã được thêm vào trong workspace đó; membership organization không tự mở private scope. Project owner có thể quản lý project nếu vẫn có cả organization/workspace/project membership. Roles luôn đọc từ DB.

Mutations khóa organization trước, rồi workspace và project theo thứ tự cố định; recheck authorization dưới lock. Parent IDs không được đổi qua update. Add member chỉ nhận người thuộc organization (và workspace khi add vào project). Không remove project owner qua member endpoint; transfer sang thành viên hiện hữu trước. Workspace member removal cũng remove project memberships/assignments trong workspace và bị chặn nếu người đó còn sở hữu project.

Delete workspace bị chặn nếu còn project; delete project bị chặn nếu còn board, label, activity hoặc AI history. Không cascade xóa công việc. Project date updates kiểm tra ngày hiện có cùng patch để không bỏ qua invariant start ≤ due. Overview lấy số task/completed/overdue/members và recent activity thật, empty state khi chưa có dữ liệu.

Frontend dùng các endpoint thật, paginated/filter/sort listings, forms có validation, confirmation cho delete/remove/transfer. Workspace/project UI chưa giả lập Kanban hoặc realtime của các phase sau.
