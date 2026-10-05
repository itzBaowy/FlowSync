# Phase 4 — Kanban

Hoàn thành ngày 06/10/2026. Toàn bộ checks: 16 unit/security tests, 44 HTTP integration tests và 8 browser tests đạt; typecheck/lint/format/build đạt. API/web/migrator/worker đã build và chạy Docker, các browser flows được kiểm tra lại trên Linux containers.

Các lát triển khai: contracts/order constraints → board/column CRUD → task CRUD/move/versioning → assignment/labels/checklists/archive → web sortable board + task panel → concurrency/RBAC/browser verification. Commit và push sau mỗi lát đã kiểm tra.

Mọi mutation khóa organization → workspace → project → board và kiểm tra membership từ DB dưới lock. OWNER/ADMIN hoặc project owner quản lý board/column/labels. Project members tạo task; creator, assignees hoặc project manager được edit/move/checklist. Creator/manager được archive/delete. Assignee chỉ được chọn từ project members còn đủ parent memberships; labels phải thuộc đúng project.

Move chỉ trong cùng board, nhận beforeTaskId thay vì position từ client. Task expectedVersion và board expectedRevision là preconditions; stale request trả 409. Server xếp thứ tự dưới lock và dùng constraint UNIQUE deferrable trong transaction để tránh collision khi rebalance/reorder. Revision tăng sau mutation; chỉ publish realtime sau commit ở Phase 5.

Snapshot giới hạn 100 active tasks/column và có total count; list tasks có pagination/search/priority/assignee/archive filters. Không render toàn bộ bảng vô hạn. UI dùng dnd-kit, keyboard support và nút chuyển column tương đương; optimistic state rollback/refetch khi lỗi. Comments/attachments/activity đầy đủ thuộc Phase 6.

Tham khảo primary docs: [dnd-kit sortable](https://dndkit.com/legacy/presets/sortable/overview/) và [keyboard sensor](https://dndkit.com/legacy/api-documentation/sensors/keyboard/).

Ordering dùng Decimal(20,10): append cách 1024, insert tính midpoint; chỉ rebalance khi gap hết precision. Rebalance bao gồm cả archived tasks để giữ unique positions. UNIQUE constraints chuyển sang DEFERRABLE bằng migration SQL, chỉ defer trong mutation transaction. Board revision/task version tăng trong cùng transaction; lỗi permission/validation/version rollback toàn bộ, gồm revision.

Giới hạn: 50 columns/board, 10.000 tasks (active + archived)/column, 200 labels/project, 20 assignees/labels và 20 checklists/task, 100 items/checklist. Snapshot trả tối đa 100 active tasks/column với totalTasks; nút Browse all mở danh sách phân trang. Search/priority/column/archive dùng REST pagination. Label edits/deletes cập nhật mọi board revision trong project.

Browser test xác nhận tạo board/column/label/task, assignment/due date/checklist persistence, keyboard move vào cột trống, keyboard reorder, pointer move, archive/restore, responsive layout và giữ response 409 để quan sát optimistic state trước rollback. HTTP tests kiểm tra foreign scopes, creator/assignee permissions, concurrent edits/moves/reorders, exhausted fractional ranks, archived rank collision và child checklist IDs thuộc task khác. Swagger request bodies dùng trực tiếp Zod input schemas.
