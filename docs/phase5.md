# Phase 5 — Realtime

Hoàn thành ngày 06/10/2026. 16 unit/security tests, 52 HTTP integration cases và 9 browser flows đạt (HTTP suite 51 cases, sau đó thêm và chạy lại case Redis subscription recovery). Typecheck/lint/format/production builds đạt. API/web/migrator/worker đã rebuild và chạy Docker; 8 browser cases đạt trong suite Docker, Kanban case được sửa để chờ mutation trước khi drag và chạy lại đạt.

Socket.IO namespace `/realtime` chỉ nhận access JWT trong handshake auth, kiểm tra origin, expiry và user tồn tại. Không nhận room name do client tự chọn; board UUID và membership cha được kiểm tra khi join, trước board/presence delivery và trong heartbeat. Membership removal tăng board revisions, xóa assignments kèm task version và thu hồi room ngay. Access token hết hạn khiến connection đóng; web refresh rồi xác thực lại.

Redis adapter chia sẻ board events giữa API replicas. Mutation cập nhật version/revision trong transaction và chỉ publish sau commit; rollback không gửi event. Events chứa revision, không phát private task content. Client bỏ qua revision cũ, refetch khi nhận revision mới hoặc reconnect, và kiểm tra REST mỗi 30 giây để phục hồi event cuối bị mất. Redis fanout chưa có durable outbox.

Presence dùng Redis leases 45 giây, heartbeat 15 giây và WebSocket ping timeout để phát hiện mất mạng. Nhiều tab được gộp theo user; profiles và count lọc lại current membership. Connection cap 10/user, board subscriptions tối đa 5/connection và request/connect rate limits. Redis command errors không bị bỏ qua; join thất bại dọn partial subscription và có thể retry.

Task assignment/update tạo notifications trong cùng transaction, loại actor khỏi recipients, giữ dữ liệu khi offline rồi fanout tín hiệu riêng theo user. List/count/read endpoints chỉ trả notifications của chính user và task còn accessible. Bell có pagination, unread filter, read/unread/read-all và deep link mở task; hoạt động cả ngoài board. Comment/mention alerts được nối ở Phase 6; due-date jobs và các notification delivery nâng cao ở Phase 7.

Browser kiểm tra hai users thấy task changes và open panel updates, presence deduplication, offline/reconnect, dashboard notification delivery, read controls, task deep links và membership revocation. HTTP kiểm tra JWT/origin, expiry, hai API replicas, rollback, Redis fault injection, connection caps và private notification scope.
