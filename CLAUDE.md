# AI Guidelines (Claude / Cursor / Gemini)

When interacting with this repository, AI Coding Assistants MUST follow these strict rules:

1. **Do NOT break SSE Streaming**: The `stream_` functions in Python Agents rely on `astream_events` to pipe tokens to the UI. Do not aggressively refactor these to use OpenAI Function Calling (`with_structured_output`) unless you have specifically handled the JSON Delta reconstruction for streaming.
2. **Respect the Hybrid Router**: The `_get_llm(model_config)` function signature is mandatory. Do not revert it to `model=None`.
3. **Frontend UI Overlaps**: When modifying `sdlc.css`, be extremely careful with CSS Grid vs Flexbox. The `sdlc-pipeline` uses Flexbox to prevent connector arrows and phase cards from wrapping onto multiple lines.
4. **Auth Bypassed**: All auth, quota, admin, and membership controls are deleted. Do not attempt to import or reference `MembershipService`, `QuotaService`, or `AuthService`. The backend uses an inline stub in `DocumentService.js` and a dummy local user request interceptor.
5. **No Legacy Agents**: `agent_1`, `agent_2`, and `agent_3` are strictly forbidden and have been deleted. Do not attempt to import them into `main_pipeline.py`.

## Build, Install & Test Commands

### Backend Commands
- **Install**: `npm install`
- **Run dev**: `npm run dev`
- **Verify schema / DB sync**: `npx prisma db push`
- **Test**: `npm run test` (runs Jest tests)

### Frontend Commands
- **Install**: `npm install`
- **Run dev**: `npm run dev`
- **Typecheck**: `npx tsc --noEmit`
- **Test**: `npm run test` (runs Vitest tests)

---
For migration details, read [UPGRADE_TO_SINGLE_USER.md](file:///c:/Users/Admin/Desktop/AI_thucchien/group_project_2/Team_6_AIFA/UPGRADE_TO_SINGLE_USER.md) in the project root.
