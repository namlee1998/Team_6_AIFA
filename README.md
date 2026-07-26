# AIFA — AI Factory Autonomy

**AIFA** là orchestrator kiểm soát AI agent theo mức rủi ro trong quy trình phát triển phần mềm. Hành động an toàn được tự động hóa; hành động rủi ro phải qua human gate. Demo chạy end-to-end trên mock data với flow `PO → UX → DEV → QA → Final Release`.

> Hướng dẫn cho AI coding assistant: xem [CLAUDE.md](CLAUDE.md)

---

## 1. Cấu Trúc Dự Án

```text
.
├── agents/          Python FastAPI — dispatch worker (PO, UX, DEV, QA)
├── backend/         Node.js + Express API gateway + Prisma/SQLite
├── frontend/        React + Vite dashboard (SDLC Control Center)
├── docs/            Tài liệu kiến trúc và quy tắc
├── mock-data/       Artifact mẫu cho local demo
├── sandbox/         E2B runtime (thử nghiệm)
├── docker-compose.yml
└── pytest.ini
```

---

## 2. Cài Đặt

### Yêu Cầu

| Công cụ    | Phiên bản |
|------------|-----------|
| Node.js    | 18+       |
| Python     | 3.10+     |
| Git        | 2.x+      |

### Tạo File Môi Trường

**PowerShell:**
```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item agents\.env.example agents\.env
Copy-Item frontend\.env.example frontend\.env
```

**Bash:**
```bash
cp backend/.env.example backend/.env
cp agents/.env.example agents/.env
cp frontend/.env.example frontend/.env
```

Các biến quan trọng cần chú ý:

| File              | Biến quan trọng              | Giá trị mặc định |
|-------------------|------------------------------|------------------|
| `backend/.env`    | `USE_MOCK_AGENTS`            | `true`           |
| `backend/.env`    | `MOCK_LOW_CONFIDENCE_STAGE`  | `dev-agent`      |
| `frontend/.env`   | `VITE_USE_MOCK`              | `true`           |

- `VITE_USE_MOCK=true` — chạy frontend hoàn toàn client-side (không cần backend)
- `USE_MOCK_AGENTS=true` — bỏ qua LLM call thật, dùng mock data

### Cài Đặt Dependencies

**PowerShell:**
```powershell
python -m pip install -r agents\requirements.txt

Set-Location backend
npm.cmd ci
npx.cmd prisma db push

Set-Location ..\frontend
npm.cmd ci

Set-Location ..
```

---

## 3. Chạy Ứng Dụng

Mở 3 terminal từ thư mục gốc:

```powershell
# Terminal 1 — Agents
Set-Location agents && python main.py

# Terminal 2 — Backend
Set-Location backend && npm run dev

# Terminal 3 — Frontend
Set-Location frontend && npm run dev
```

Truy cập <http://localhost:5173>. Không cần đăng nhập — hệ thống tự động bypass auth và vào thẳng Dashboard.

### Quick Start Demo

1. Tạo project bằng nút `+` trong sidebar
2. Click **New Feature Request**
3. Nhập tên feature (vd: `add google login`) rồi **Send directly to PO**
4. Theo dõi flow `PO → UX → DEV → QA` tự động chạy
5. Tại QA: review output, click **Approve & hand off**
6. Tại Final Release: click **Approve release** → `RELEASED`

Để xem các nhánh khác (low confidence, blocker, escalation), đặt `MOCK_LOW_CONFIDENCE_STAGE` trong `backend/.env`:

```env
MOCK_LOW_CONFIDENCE_STAGE=po-agent   # hoặc ux-agent, dev-agent
```

---

## 4. Chạy Tests

```powershell
# Python agents
python -m pytest

# Backend (Jest)
Set-Location backend && npm.cmd test

# Frontend (Vitest)
Set-Location frontend && npm.cmd test
```

---

## 5. API Tổng Quan

Backend lắng nghe tại cổng `3000` (mặc định).

| Prefix                  | Mục đích                              |
|-------------------------|---------------------------------------|
| `GET /health`           | Health check                          |
| `/api/v1/projects`      | Quản lý project (tạo, xoá, liệt kê)  |
| `/api/v1/sdlc`          | Workflow chính (PO → UX → DEV → QA)  |

Endpoints SDLC chính:

| Endpoint                                          | Mục đích                        |
|---------------------------------------------------|---------------------------------|
| `POST /api/v1/sdlc/run-po-agent`                 | Bắt đầu workflow                |
| `GET /api/v1/sdlc/status/:task_id`               | SSE task status stream          |
| `POST /api/v1/sdlc/tasks/:task_id/decision`      | Submit HITL decision            |
| `GET /api/v1/sdlc/workflow-status?project_id=…`  | Trạng thái workflow hiện tại    |
| `POST /api/v1/sdlc/projects/:id/release-decision`| Approve/reject release cuối     |
| `GET /api/v1/sdlc/audit-trail/:project_id`       | Audit events + phase transitions|

---

## 6. Tài Liệu

Xem [docs/README.md](docs/README.md) để biết toàn bộ tài liệu.

Tài liệu chính:

| File                                                                   | Mô tả                              |
|------------------------------------------------------------------------|-------------------------------------|
| [docs/AIFA_V3_IMPLEMENTATION_SUMMARY.md](docs/AIFA_V3_IMPLEMENTATION_SUMMARY.md) | Tổng kết tính năng & giới hạn |
| [docs/architecture.md](docs/architecture.md)                           | Kiến trúc runtime                   |
| [docs/QUALITY_GATE_RULES.md](docs/QUALITY_GATE_RULES.md)               | Quy tắc validation & gate           |
| [docs/AIFA_NOTES.md](docs/AIFA_NOTES.md)                               | Bản đồ codebase cho developer       |
| [docs/CHANGELOG.md](docs/CHANGELOG.md)                                 | Lịch sử thay đổi                    |

---

## 7. Quy Tắc Đóng Góp

- Không commit file `.env` hoặc API key
- Giữ workflow chính dưới `/api/v1/sdlc`
- Thư mục `workspace/` là artifact được tạo tự động — không commit
- Chạy `npm test` (backend) + `python -m pytest` (agents) trước khi mở pull request
- Cập nhật README này khi thay đổi lệnh setup hoặc test

---

## License

MIT. Xem [LICENSE](LICENSE).
