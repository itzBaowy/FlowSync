Bạn là một Senior Fullstack Engineer + Software Architect. Hãy giúp tôi xây dựng một dự án portfolio production-ready tên là **FlowSync**.

## 1. Mục tiêu dự án

FlowSync là một nền tảng cộng tác nhóm theo thời gian thực, kết hợp các ý tưởng từ:

- Trello
- Slack
- Notion
- Linear

Mục tiêu không phải clone hoàn toàn các sản phẩm trên mà xây dựng một sản phẩm SaaS hoàn chỉnh để thể hiện kỹ năng Fullstack Engineer:

- Frontend architecture
- Backend architecture
- Authentication
- Authorization / RBAC
- PostgreSQL
- Redis
- BullMQ
- WebSocket
- Background jobs
- File upload
- Real-time collaboration
- AI integration
- Docker
- CI/CD
- Production deployment
- System design

Ứng dụng phải có giao diện hiện đại, responsive và đủ chất lượng để đưa trực tiếp vào portfolio.

---

# 2. Tech Stack

Ưu tiên sử dụng:

## Frontend

- Next.js latest stable version
- TypeScript
- App Router
- Tailwind CSS
- shadcn/ui
- TanStack Query
- Zustand nếu cần global client state
- React Hook Form
- Zod
- dnd-kit cho Drag & Drop
- Socket.IO Client

## Backend

- NestJS
- TypeScript
- REST API
- Socket.IO / WebSocket Gateway
- Swagger / OpenAPI

## Database

- PostgreSQL
- Prisma ORM

## Infrastructure

- Redis
- BullMQ
- Docker
- Docker Compose

## Storage

Ưu tiên abstraction để có thể dùng:

- MinIO ở local development
- S3 compatible storage ở production

## Authentication

Có thể dùng:

- JWT Access Token
- Refresh Token
- HttpOnly Cookie

Hỗ trợ:

- Email/password
- Google OAuth nếu phù hợp

## AI

Thiết kế abstraction để có thể sử dụng:

- OpenAI
- Gemini

Không hard-code provider vào business logic.

---

# 3. Kiến trúc tổng thể mong muốn

Thiết kế theo dạng:

```text
Browser
   │
   ▼
Next.js Frontend
   │
   ├──────── WebSocket ─────────────┐
   │                                │
   ▼                                ▼
NestJS REST API              WebSocket Gateway
   │                                │
   ├──────────────┬─────────────────┘
   │              │
   ▼              ▼
PostgreSQL       Redis
                   │
                   ▼
                 BullMQ
                   │
                   ▼
                 Worker
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
     Email Jobs           AI Jobs
```

Backend nên tổ chức modular, tránh viết toàn bộ logic trực tiếp trong controller.

Ưu tiên cấu trúc:

```text
modules/
  auth/
  users/
  organizations/
  workspaces/
  projects/
  boards/
  tasks/
  comments/
  notifications/
  realtime/
  files/
  ai/
  activity-log/
  queue/
```

Business logic phải nằm ở service/use-case thích hợp.

---

# 4. Core Domain

Hierarchy chính:

```text
User
 └── Organization
      └── Workspace
           └── Project
                └── Board
                     └── Column
                          └── Task
```

Một Organization có nhiều thành viên.

Một Workspace thuộc Organization.

Một Project thuộc Workspace.

Một Board thuộc Project.

Một Board có nhiều Column.

Một Column có nhiều Task.

---

# 5. Roles và Permission

Organization có các role:

```text
OWNER
ADMIN
MEMBER
```

OWNER:

- quản lý organization
- invite thành viên
- remove thành viên
- thay đổi role
- xóa organization

ADMIN:

- quản lý workspace
- quản lý project
- invite member nếu được phép

MEMBER:

- tham gia project
- tạo task
- comment
- update task nếu có permission

Không chỉ ẩn button ở frontend.

Backend phải luôn kiểm tra authorization.

Thiết kế RBAC reusable bằng Guards hoặc Permission system.

---

# 6. Authentication

Implement:

### Register

```http
POST /auth/register
```

### Login

```http
POST /auth/login
```

### Refresh token

```http
POST /auth/refresh
```

### Logout

```http
POST /auth/logout
```

### Current user

```http
GET /auth/me
```

Yêu cầu:

- Password hash bằng Argon2 hoặc bcrypt
- Refresh token rotation
- HttpOnly secure cookie
- Rate limiting login
- Validation
- Không expose password hash

---

# 7. Organization

User có thể:

- tạo organization
- update organization
- upload logo
- xem danh sách organization
- invite member bằng email
- remove member
- update role

Invitation flow:

```text
Owner
  ↓
Enter email
  ↓
Invitation created
  ↓
Background email job
  ↓
User receives invite
  ↓
Accept
  ↓
Join organization
```

Invitation nên có:

```text
token
expiresAt
status
```

Status:

```text
PENDING
ACCEPTED
EXPIRED
REVOKED
```

---

# 8. Workspace

Mỗi organization có nhiều workspace.

Workspace gồm:

- name
- description
- slug
- icon
- members
- projects

Có:

```http
POST   /workspaces
GET    /workspaces
GET    /workspaces/:id
PATCH  /workspaces/:id
DELETE /workspaces/:id
```

---

# 9. Project Management

Project gồm:

- name
- description
- status
- owner
- members
- startDate
- dueDate
- createdAt
- updatedAt

Status:

```text
PLANNING
ACTIVE
ON_HOLD
COMPLETED
ARCHIVED
```

Dashboard project hiển thị:

- số task
- task completed
- overdue
- members
- recent activities

---

# 10. Kanban Board

Đây là một trong những feature quan trọng nhất.

Board gồm các column:

```text
TODO
IN_PROGRESS
REVIEW
DONE
```

User có thể tự tạo column mới.

Task có thể drag & drop:

```text
TODO
  ↓
IN_PROGRESS
```

Khi User A kéo task:

```text
User A
 ↓
API
 ↓
Database update
 ↓
WebSocket Event
 ↓
User B
 ↓
UI update instantly
```

Không reload trang.

Implement optimistic UI nếu phù hợp.

---

# 11. Task

Task gồm:

```text
id
title
description
priority
status
position
dueDate
createdAt
updatedAt
createdBy
assignees
labels
attachments
comments
```

Priority:

```text
LOW
MEDIUM
HIGH
URGENT
```

Task hỗ trợ:

- create
- edit
- delete
- archive
- assign member
- multiple assignees
- labels
- due date
- checklist
- attachment
- comments
- task activity

Task detail nên mở bằng:

- dialog
hoặc
- side panel

giống Linear/Trello.

---

# 12. Checklist

Task có nhiều checklist item:

```text
[ ] Design database
[x] Create API
[ ] Implement UI
```

Hiển thị progress:

```text
1 / 3 completed
```

---

# 13. Comment

User có thể comment task.

Comment hỗ trợ:

- text
- @mention
- edit
- delete

Ví dụ:

```text
@john please review this API.
```

Khi mention user:

```text
Comment
 ↓
Mention parser
 ↓
Create notification
 ↓
WebSocket
 ↓
Notification appears
```

---

# 14. Real-time Notification

Notification types:

```text
TASK_ASSIGNED
TASK_UPDATED
TASK_COMMENT
MENTION
PROJECT_INVITE
WORKSPACE_INVITE
DUE_DATE
```

Notification UI:

```text
🔔 3
```

Dropdown hiển thị:

```text
John assigned you to "Fix login API"
Anna mentioned you in "Dashboard"
Task "Payment API" is due tomorrow
```

Notification phải xuất hiện realtime qua WebSocket.

---

# 15. Presence

Hiển thị thành viên đang online.

Ví dụ:

```text
John     ● Online
Anna     ● Online
David    ○ Offline
```

Dùng Redis để quản lý presence nếu cần.

Không phụ thuộc hoàn toàn vào in-memory state của một server.

---

# 16. Activity Log

Mỗi action quan trọng tạo activity:

```text
John created task "Login API"

Anna moved
"Login API"
TODO → IN_PROGRESS

David commented on
"Login API"

John assigned Anna
```

Activity log dùng cho:

- Project Activity
- Task Activity
- AI Summary

Thiết kế generic Activity entity nếu phù hợp.

---

# 17. File Upload

Task hỗ trợ attachment:

```text
image
pdf
docx
zip
```

Flow:

```text
Client
 ↓
Upload
 ↓
Object Storage
 ↓
Store metadata in PostgreSQL
```

Local:

```text
MinIO
```

Production:

```text
S3 compatible
```

Validate:

- MIME type
- maximum size
- permission

---

# 18. Search

Implement global search.

Search:

```text
tasks
projects
members
comments
```

Ví dụ:

```text
Search: payment

Results

Task
Payment API

Comment
Payment webhook failed
```

Bắt đầu bằng PostgreSQL Full Text Search hoặc ILIKE hợp lý.

Không thêm Elasticsearch ngay nếu chưa cần.

---

# 19. AI Project Assistant

Đây là feature quan trọng để portfolio hiện đại hơn.

Có một AI assistant trong mỗi project.

User có thể hỏi:

```text
"What happened today?"
```

AI dựa vào Activity Logs để trả lời.

Ví dụ:

```text
Today:
- 12 tasks were updated
- 4 tasks completed
- Payment API moved to review
- Login bug remains blocked
```

Hỗ trợ:

### Project Summary

```text
Summarize project progress
```

### Overdue Analysis

```text
Which important tasks are overdue?
```

### Meeting Note → Tasks

User paste:

```text
Tomorrow we need to finish login,
fix payment webhook and update dashboard UI.
Anna handles dashboard.
David handles payment.
```

AI tạo suggestion:

```text
1. Finish Login
2. Fix Payment Webhook
   Assigned: David
3. Update Dashboard UI
   Assigned: Anna
```

User phải confirm trước khi AI thực sự tạo tasks.

Không cho AI tự ý mutate database mà không có confirmation.

Architecture:

```text
User
 ↓
AI Request
 ↓
AI Service
 ↓
Context Builder
 ↓
LLM Provider
 ↓
Structured JSON
 ↓
Validation
 ↓
Preview
 ↓
User Confirm
 ↓
Execute Action
```

Dùng Zod hoặc JSON schema validate AI output.

---

# 20. BullMQ

Sử dụng BullMQ cho những job không cần xử lý synchronous.

Ví dụ:

```text
EMAIL_QUEUE
NOTIFICATION_QUEUE
AI_QUEUE
FILE_QUEUE
```

Jobs:

```text
send invitation email

send notification email

generate AI project summary

process uploaded file

cleanup expired invitation
```

Flow:

```text
NestJS API
 ↓
queue.add()
 ↓
Redis
 ↓
BullMQ Worker
 ↓
Execute Job
```

Có:

- retries
- exponential backoff
- failed jobs
- logging

Không dùng queue cho những thứ không cần thiết.

---

# 21. Dashboard

Dashboard chính hiển thị:

```text
Good morning, Long

4 Active Projects
28 Open Tasks
7 Tasks Due Soon
3 Overdue

Recent Projects

Recent Activities

My Tasks
```

Có chart đơn giản:

- Task completion
- Project progress
- Task by priority

Không over-design chart.

---

# 22. UI/UX Direction

Phong cách:

```text
Linear
Notion
Vercel
Raycast
```

Yêu cầu:

- clean
- professional
- minimalist
- dark/light mode
- responsive
- skeleton loading
- empty states
- error states
- toast
- keyboard friendly

Sidebar:

```text
FlowSync

Home

Workspace
 ├ Project Alpha
 ├ Project Beta

My Tasks
Inbox
AI Assistant

Settings
```

Không sử dụng giao diện quá nhiều gradient hoặc animation không cần thiết.

---

# 23. Database

Thiết kế Prisma schema cẩn thận.

Các entity tối thiểu:

```text
User
Account
RefreshToken

Organization
OrganizationMember
Invitation

Workspace
WorkspaceMember

Project
ProjectMember

Board
Column

Task
TaskAssignee
TaskLabel
Label
Checklist
ChecklistItem

Comment
Mention

Attachment

Notification

Activity

AIConversation
AIMessage
```

Quan hệ phải rõ ràng.

Sử dụng:

- indexes
- unique constraints
- foreign keys
- cascade hợp lý

Không cascade delete bừa bãi.

---

# 24. API conventions

Response thành công thống nhất.

Ví dụ:

```json
{
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Invalid input",
  "errors": []
}
```

Có:

- pagination
- sorting
- filtering

Ví dụ:

```http
GET /tasks?page=1&limit=20&priority=HIGH
```

---

# 25. Security

Implement những thứ phù hợp:

- CORS
- Helmet
- rate limit
- secure cookies
- validation
- sanitization
- authorization
- file validation
- environment validation
- secrets thông qua ENV
- refresh token security

Không hard-code secrets.

---

# 26. Logging

Backend cần structured logging.

Có thể sử dụng:

- Pino

Log:

```text
requestId
userId
route
status
duration
```

Error phải có stack trace ở development.

Không log password/token.

---

# 27. Docker

Local development cần:

```text
frontend
backend
postgres
redis
minio
```

Docker Compose:

```bash
docker compose up -d
```

phải có thể khởi động infrastructure dễ dàng.

Có healthcheck cho:

- PostgreSQL
- Redis
- MinIO

---

# 28. Environment

Tạo:

```text
.env.example
```

Ví dụ:

```text
DATABASE_URL=

REDIS_HOST=
REDIS_PORT=

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=

OPENAI_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Không commit `.env`.

---

# 29. Testing

Không cần test 100% toàn bộ project ngay từ đầu.

Ưu tiên test business critical:

- Auth
- RBAC
- Task creation
- Task move
- Invitation
- AI structured output validation

Backend:

- unit tests
- integration tests
- e2e cho flow quan trọng

---

# 30. README

README phải đủ tốt để recruiter đọc.

Bao gồm:

```text
# FlowSync

Overview

Features

Screenshots

Architecture

Tech Stack

Database Design

Getting Started

Environment Variables

Docker Setup

API Documentation

System Design Decisions

Challenges

Future Improvements
```

Có Mermaid diagram cho architecture nếu phù hợp.

---

# 31. Git workflow

Sử dụng Conventional Commits:

```text
feat(auth): implement login
feat(task): add task assignment
fix(board): prevent duplicate task position
refactor(auth): extract token service
docs(readme): add architecture diagram
```

---

# 32. Development Strategy

Không cố xây toàn bộ hệ thống trong một lần.

Chia thành phases.

## Phase 1 — Foundation

Implement:

- monorepo/project structure
- frontend
- backend
- PostgreSQL
- Redis
- Docker
- Prisma
- environment validation
- Swagger
- authentication base

Sau Phase 1, project phải chạy được.

---

## Phase 2 — Organization

Implement:

- Organization
- Member
- Role
- Invitation
- RBAC

---

## Phase 3 — Project Management

Implement:

- Workspace
- Project
- Project members

---

## Phase 4 — Kanban

Implement:

- Board
- Column
- Task
- Drag & Drop
- Task ordering

---

## Phase 5 — Realtime

Implement:

- WebSocket
- Board realtime update
- Notification
- Presence

---

## Phase 6 — Collaboration

Implement:

- Comment
- Mention
- Attachment
- Activity Log

---

## Phase 7 — Queue

Implement:

- BullMQ
- email jobs
- notification jobs
- retry handling

---

## Phase 8 — AI

Implement:

- AI abstraction
- project summary
- overdue analysis
- meeting notes → task suggestions

---

## Phase 9 — Production

Implement:

- Docker production
- CI/CD
- security review
- logging
- deployment
- README

---

# 33. Cách bạn phải làm việc

Quan trọng:

Không được bắt đầu viết hàng chục file một cách ngẫu nhiên.

Trước tiên hãy:

1. Phân tích requirements.
2. Đề xuất architecture.
3. Đề xuất folder structure.
4. Thiết kế database schema.
5. Xác định MVP.
6. Xác định những phần có thể phát triển sau.
7. Sau đó mới bắt đầu implement.

Khi implement:

- làm từng module
- không tạo abstraction quá sớm
- không over-engineer
- code production-quality
- code dễ đọc
- dùng TypeScript strict
- tránh `any`
- validate tất cả input từ bên ngoài
- giải thích architectural decision quan trọng

Nếu repository hiện tại đã có code:

**Hãy đọc và phân tích codebase trước khi thay đổi bất kỳ thứ gì.**

Không tự ý rewrite toàn bộ project nếu chưa cần.

Nếu gặp một architectural decision:

Hãy ưu tiên:

```text
Simple
↓
Maintainable
↓
Scalable
```

thay vì:

```text
Complex
↓
Enterprise-looking
↓
Unnecessary abstraction
```

---

# 34. Definition of Done cho MVP

MVP được xem là hoàn thành khi user có thể:

```text
Register
↓
Login
↓
Create Organization
↓
Create Workspace
↓
Create Project
↓
Create Board
↓
Create Columns
↓
Create Tasks
↓
Assign Member
↓
Drag Task between Columns
↓
Other connected users see update realtime
↓
Comment
↓
Receive notification
```

Sau MVP mới bắt đầu AI và các advanced feature.

---

# 35. Yêu cầu bắt đầu ngay bây giờ

Bây giờ hãy bắt đầu với:

## STEP 1

Phân tích toàn bộ yêu cầu trên và đưa ra:

### A. System Architecture

Giải thích từng component và trách nhiệm.

### B. Repository Structure

Đề xuất cấu trúc project production-ready.

### C. Database Design

Đề xuất Prisma entities và relationships.

### D. Authentication Design

Mô tả Access Token + Refresh Token flow.

### E. RBAC Design

Mô tả cách bảo vệ Organization, Workspace, Project và Task.

### F. Realtime Architecture

Mô tả event flow khi một task bị di chuyển.

### G. BullMQ Architecture

Xác định queue nào thực sự cần thiết.

### H. MVP Roadmap

Chia thành các milestone nhỏ có thể implement tuần tự.

### I. Risks

Liệt kê những bài toán kỹ thuật có khả năng khó nhất:

- concurrent task movement
- ordering
- permissions
- realtime sync
- token security
- background jobs
- AI actions

### J. Initial Setup

Sau khi phân tích xong, hãy bắt đầu tạo foundation của project.

Không implement AI trước.

Ưu tiên hoàn thiện:

```text
Infrastructure
↓
Authentication
↓
Organization
↓
Workspace
↓
Project
↓
Board
↓
Task
↓
Realtime
```

trước.

Mỗi bước phải đảm bảo project vẫn có thể chạy và build thành công.

Mục tiêu cuối cùng là tạo ra một project đủ tốt để một Fullstack Developer có thể đưa vào portfolio và giải thích architecture/system design trong buổi phỏng vấn.