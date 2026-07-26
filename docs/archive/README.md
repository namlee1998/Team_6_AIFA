# Tài Liệu Dự Án AIFA

Tài liệu này đóng vai trò là mục lục master để định hướng và tra cứu tất cả các tài liệu kỹ thuật, quy trình phát triển và lịch sử cải tiến của dự án AIFA.

---

## 📊 Tài liệu chính (Active)

Các tài liệu dưới đây mô tả kiến trúc hiện tại, cấu trúc codebase, quy chuẩn kiểm thử chất lượng và lịch sử phiên bản đang hoạt động:

| Tài liệu | Mô tả |
| :--- | :--- |
| [AIFA_V3_IMPLEMENTATION_SUMMARY.md](AIFA_V3_IMPLEMENTATION_SUMMARY.md) | Tổng hợp các tính năng đã được triển khai trong phiên bản AIFA v3, các thành phần chính và giới hạn hệ thống đã biết. |
| [architecture.md](architecture.md) | Kiến trúc runtime của hệ thống và luồng làm việc tự động qua các AI Agent (PO -> UX -> DEV -> QA). |
| [AIFA_NOTES.md](AIFA_NOTES.md) | Bản đồ cấu trúc codebase chi tiết dành cho lập trình viên để nắm bắt nhanh các thư mục và module chính. |
| [QUALITY_GATE_RULES.md](QUALITY_GATE_RULES.md) | Bộ quy tắc validation, chốt chặn rủi ro (Risk Gate) và chốt chặn kiểm thử chất lượng (QA Gate) trong chu trình SDLC. |
| [CHANGELOG.md](CHANGELOG.md) | Nhật ký thay đổi và lịch sử phát hành của nền tảng qua các phiên bản. |

---

## 🗄️ Tài liệu lưu trữ (Archive)

Các tài liệu dưới đây đã hoàn thành vai trò của chúng trong các giai đoạn trước, hoặc đã lỗi thời nhưng được giữ lại làm tài liệu tham khảo lịch sử:

| Tài liệu | Lý do lưu trữ |
| :--- | :--- |
| [archive/AIFA_INTEGRATION_PLAN.md](archive/AIFA_INTEGRATION_PLAN.md) | Kế hoạch tích hợp 7 ngày ban đầu của dự án. Ghi nhận Phase 1-3 đã hoàn thành (~85%), Phase 4 tạm hoãn. |
| [archive/TASK_GIANG_FE.md](archive/TASK_GIANG_FE.md) | Tasklist cá nhân của Giang (Frontend Developer) cho quá trình triển khai giao diện. |
| [archive/TASK_MINH_BE.md](archive/TASK_MINH_BE.md) | Tasklist cá nhân của Minh (Backend Developer) cho phần API và logic kiểm duyệt. |
| [archive/TASK_NAM_AGENT.md](archive/TASK_NAM_AGENT.md) | Tasklist cá nhân của Nam (Agent Developer) cho phần cấu hình Prompt và tích hợp Claude Code. |
| [archive/HANDOVER.md](archive/HANDOVER.md) | Tài liệu đặc tả Claude Agent SDK đời đầu, nay đã được thay thế bằng tài liệu V3 đầy đủ hơn. |
| [archive/CURRENT_WORKFLOW.md](archive/CURRENT_WORKFLOW.md) | Quy trình vận hành chi tiết trước đây, hiện đã trùng lặp và được tích hợp vào Implementation Summary. |
| [archive/AIFA_DEMO_1_WEEK_ROADMAP.md](archive/AIFA_DEMO_1_WEEK_ROADMAP.md) | Lộ trình chuẩn bị chạy bản Demo kéo dài 1 tuần trong quá khứ. |
| [archive/AIFA_REAL_DATA_3_WEEK_ROADMAP.md](archive/AIFA_REAL_DATA_3_WEEK_ROADMAP.md) | Lộ trình mở rộng dự án với dữ liệu thật kéo dài 3 tuần trong quá khứ. |
| [archive/design_prompt_1.md](archive/design_prompt_1.md) | Prompt gốc dùng để hướng dẫn AI generate và thiết kế giao diện dashboard đầu tiên. |
