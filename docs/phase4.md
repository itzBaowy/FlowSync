# Phase 4 — Kanban

Các lát triển khai: contracts/order constraints → board/column CRUD → task CRUD/move/versioning → assignment/labels/checklists/archive → web sortable board + task panel → concurrency/RBAC/browser verification. Commit và push sau mỗi lát đã kiểm tra.

Mọi mutation khóa organization → workspace → project → board và kiểm tra membership từ DB dưới lock. OWNER/ADMIN hoặc project owner quản lý board/column/labels. Project members tạo task; creator, assignees hoặc project manager được edit/move/checklist. Creator/manager được archive/delete. Assignee chỉ được chọn từ project members còn đủ parent memberships; labels phải thuộc đúng project.

Move chỉ trong cùng board, nhận beforeTaskId thay vì position từ client. Task expectedVersion và board expectedRevision là preconditions; stale request trả 409. Server xếp thứ tự dưới lock và dùng constraint UNIQUE deferrable trong transaction để tránh collision khi rebalance/reorder. Revision tăng sau mutation; chỉ publish realtime sau commit ở Phase 5.

Snapshot giới hạn 100 active tasks/column và có total count; list tasks có pagination/search/priority/assignee/archive filters. Không render toàn bộ bảng vô hạn. UI dùng dnd-kit, keyboard support và nút chuyển column tương đương; optimistic state rollback/refetch khi lỗi. Comments/attachments/activity đầy đủ thuộc Phase 6.

Tham khảo primary docs: [dnd-kit sortable](https://dndkit.com/legacy/presets/sortable/overview/) và [keyboard sensor](https://dndkit.com/legacy/api-documentation/sensors/keyboard/).
