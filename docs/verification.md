# Phase 1 verification — 05/10/2026

Đã hoàn thành phạm vi initial setup ở mục 35 của Requirements.md. Chưa hoàn thành toàn bộ MVP ở mục 34.

| Check                       | Kết quả                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| Prisma schema validation    | Pass, Prisma 7.10.0                                                  |
| Initial SQL migration       | Applied bằng migrate deploy; migration job trong Docker exit 0       |
| TypeScript strict typecheck | Pass cho contracts, API, web                                         |
| ESLint / Prettier           | Pass                                                                 |
| Production build            | Pass cho Next.js và NestJS                                           |
| Unit/security tests         | 6 pass: contracts, ENV, JWT và Origin guard                          |
| HTTP integration tests      | 7 pass trên PostgreSQL/Redis/MinIO thật                              |
| Browser test                | 1 pass trên local build và Linux Docker containers                   |
| Docker targets              | API, web, migrator và source-built MinIO đều build thành công        |
| Compose runtime             | API/PostgreSQL/Redis/MinIO healthy; web hoạt động; minio-init exit 0 |

HTTP tests kiểm tra Argon2id hash, public user serialization, duplicate email, unauthorized/forged tokens, refresh rotation, replay family revocation, simultaneous refresh, logout và Redis rate limit. Browser kiểm tra register, refresh sau reload, logout/login, dark mode, không tràn ngang trên mobile, menu đóng bằng Esc và focus quay về nút mở.

Screenshot thật ở [screenshots/](screenshots/). Test accounts được tạo với email duy nhất và xóa sau test; không seed credentials cho người dùng.

Stack hiện chạy ở web http://localhost:3100, API http://localhost:4000/api, Swagger http://localhost:4000/api/docs. Cổng riêng của Redis/MinIO là 16379 và 19000/19001 để không ảnh hưởng dự án khác. Các services nằm trong Compose project `flowsync`.

Sau khi khắc phục hết dung lượng, đã build lại Docker thành công. Image API giảm từ khoảng 1.57 GB xuống 892 MB nhờ chỉ cài runtime dependencies của backend/contracts. Ở lần kiểm tra cuối, ổ C còn khoảng 9.7 GB trống; không xóa cache, volumes hoặc container của dự án khác.

CI workflow đã được tạo; chưa chạy trên GitHub do repository chưa được kết nối remote. Chưa provision cloud deployment. Auth hardening còn cross-tab refresh coordination và password recovery/email verification, được ghi rõ trong architecture/deployment notes.
