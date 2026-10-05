# Phase 6 — Collaboration MVP

Hoàn thành ngày 06/10/2026. 24 unit/security tests, 65 HTTP integration tests và 9 browser flows đạt. Strict typecheck/lint/format và production builds đạt. API/web/migrator/worker được rebuild, chạy Docker và đạt lại toàn bộ browser suite.

Comments: mọi project member còn đủ parent memberships có thể bình luận, kể cả không được assigned. Author sửa comment; author/project manager được xóa. Comment version tách khỏi task version để comments không gây conflict với task editing; stale edits trả 409. Foreign task/comment IDs và forged author IDs bị chặn. Archived tasks chỉ đọc comments. Text giới hạn 10.000 ký tự, tối đa 1.000 comments/task và 20 mentions/comment.

Mention picker chèn `@[Display name](user UUID)`, server chỉ chấp nhận current project members còn workspace/organization membership. Parser cũng nhận full `@email` hoặc tên một từ duy nhất như `@John`; ambiguous names yêu cầu chọn member/full email. Mentions được deduplicate và edits chỉ báo người mới được thêm. Mention alerts và comment alerts của creator/assignees nằm trong transaction với comment; actor không tự nhận, người đã mất scope không được tạo notification. Browser xác nhận live comment/edit/delete, moderation và mention notification.

Activity lưu cùng transaction với board/task/comment/attachment actions; failed mutations không để lại lịch sử. Task moves lưu from/to status và assignment IDs. Xóa task giữ history ở project, bỏ FK task đã xóa và giữ identifier trong metadata. Project/task feeds có pagination, public actor profile và current scope checks. Structural deletes không tự xóa retained project history.

Attachments: PNG/JPEG/WebP/PDF/DOCX/ZIP, tối đa 10 MiB/file và 20 files/task. Images được decode với giới hạn pixels; PDF kiểm tra header/trailer; ZIP kiểm tra cấu trúc, entry limits, tên đường dẫn, encryption và declared expansion; DOCX yêu cầu package markers và từ chối macros. Đây không phải malware scanner. Storage không public; API kiểm tra quyền trước khi cấp URL 5 phút với forced attachment disposition. URL đã cấp còn hợp lệ tới expiry. Uploader, task creator hoặc manager được xóa; phải remove attachments trước khi delete task.

Upload reservation bảo vệ khoảng giữa object write và metadata commit. Metadata rollback dọn object; remove tạo durable cleanup record cùng transaction. Cleanup thử ngay, giữ failure và retry time khi storage lỗi. Background retries/pump được hoàn thiện ở Phase 7. Các quyết định dựa trên [yauzl](https://github.com/thejoshwolfe/yauzl) và [S3 GetObject response overrides](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

Global search dùng PostgreSQL case-insensitive matching với pagination theo tasks/projects/members/comments. Tasks/comments chỉ trong project còn accessible; member results giới hạn shared organizations. My Tasks kiểm tra lại parent memberships ngay cả khi có assignment cũ. Dashboard lấy số liệu thật, không mock counts; completed/archive tasks không làm sai overdue counts. Simple completion/priority charts, recent project progress và activity hỗ trợ overview.

MVP mục 34 đã có luồng register → organization/workspace/project/board → assign/move tasks → realtime update → comment → notification. AI và production deployment tiếp tục sau queue hardening.
