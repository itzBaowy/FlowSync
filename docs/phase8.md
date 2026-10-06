# Phase 8 — Private project assistant

Hoàn thành implementation ngày 06/10/2026: 28 unit tests, 87 HTTP integration tests và 10 browser flows đạt trên local production builds và Docker Linux. Migration `20261006000700_ai_jobs` lưu private conversation, durable request, lease và confirmation result. Worker container chạy thêm AI queue; status/retry CLI hỗ trợ queue này.

## Configuration

Assistant mặc định tắt. Chọn `AI_PROVIDER=openai` hoặc `gemini`, đặt `AI_MODEL` và key tương ứng `OPENAI_API_KEY` / `GEMINI_API_KEY`, rồi restart API/worker. Model phải được cấu hình rõ ràng; không có model mặc định. Provider disabled trả 503 trước khi tạo request. Không cần key để chạy ứng dụng hoặc test suite.

OpenAI dùng [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses); Gemini dùng [Interactions API](https://ai.google.dev/api/interactions-api). Native fetch chỉ gọi fixed official endpoints, không follow redirects, timeout 45 giây, giới hạn output và `store: false`. Không có tool calling hoặc provider-controlled database action. Kết quả luôn qua strict Zod validation, kể cả khi provider hỗ trợ JSON schema.

## Context and privacy

Summary, overdue analysis và meeting-note suggestions chỉ dùng project mà requester hiện còn quyền đọc. Request/history riêng từng user/project; project member khác không đọc được conversation. Worker kiểm tra lại memberships trước generation và trước khi lưu result.

Context gồm project metadata, tối đa 40 active tasks, 60 activity entries trong 24 giờ, 100 eligible member public profiles và column counts. Task descriptions cắt ở 500 ký tự, project description ở 1.000. Overdue mode ưu tiên open overdue tasks theo priority/deadline; completed tasks không chiếm sample. Counts và sampling flags giúp assistant nói rõ giới hạn. Không gửi member emails, credentials, attachments hoặc full comment bodies. Project content và meeting notes được đánh dấu là untrusted data trong instructions.

References chỉ được trỏ đến task IDs trong context; assignee IDs phải thuộc eligible members. Summary/overdue không được trả task suggestions. Provider refusals, incomplete responses, unknown fields hoặc fabricated IDs bị từ chối. Logs/job payload không chứa prompt, response, key hoặc provider error body.

## Durable requests and explicit confirmation

API ghi conversation/request trong cùng transaction, rồi worker nhận opaque run ID qua BullMQ. Giới hạn 3 pending/running requests và 100 requests/ngày cho từng user/project; endpoint có rate limit. AI queue retry 3 attempts, exponential backoff từ 30 giây. Atomic lease ngăn duplicate execution; stale worker không ghi đè result. Revoked access hủy run. Permanent validation/provider errors đánh dấu FAILED; transient failures có thể retry bằng operator CLI.

```powershell
npm run jobs:status
npm run jobs:retry -- ai <run-id>
```

Meeting notes chỉ tạo preview. User chọn suggestions, board và destination column, sau đó xác nhận dialog. API yêu cầu literal `confirmed: true`, rechecks current parent permissions và dùng cùng task creation transaction như Kanban. Toàn bộ selected tasks, assignments, reminders, notifications, activity và confirmation marker commit cùng nhau. Một suggestion không hợp lệ làm rollback cả batch. Concurrent confirmation tạo một batch; replay trả lại task IDs đã tạo.

Endpoints dưới `/api/projects/:projectId/ai`: `GET availability`, `GET/POST requests`, `GET requests/:id`, `POST requests/:id/confirm`. History có pagination; UI poll pending results, hỗ trợ mobile và luôn hiển thị lỗi an toàn.

## Verification limits

Provider adapters được kiểm tra bằng mocked HTTP responses. HTTP suite dùng provider fixture với real PostgreSQL/Redis queues để kiểm tra private scope, revocation, malformed results, retry, rollback và concurrent confirmation. Browser fixture thay generation response; confirmation vẫn gọi API thật và task hiện trên Kanban. Cancel dialog không tạo task. Screenshot ở [AI mobile](screenshots/ai-assistant-mobile.png).

Chưa gọi provider bằng live credentials và chưa kiểm tra chất lượng/cost trên model thực tế. Operator cần smoke test model được chọn trước production; không coi fixture output là bằng chứng về chất lượng AI. Storage/retention của upstream provider phải được đánh giá theo account policy của deployment, ngoài cấu hình `store: false` trong request.
