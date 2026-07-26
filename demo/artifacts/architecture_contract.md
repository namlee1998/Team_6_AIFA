# Feature Summary

Add a single **Login** button to the existing home page.

On click, navigate the browser to the route `/login`.

No authentication, no session, no API call, no persisted state.

Scope is intentionally limited to the UI entry point only.

# Repository Understanding

The repository is a two-tier web application.

- `frontend/` — a Vite + React 19 SPA using React Router 7 as the client-side router and Zustand for local state. Tailwind CSS is the styling layer. Existing routing and page modules live under `frontend/src/pages/`; shared UI primitives live under `frontend/src/components/`. Home page is reachable as the index route.
- `backend/` — an Express service backed by Prisma (SQLite for dev). Auth, quota, and membership layers are explicitly removed; there is no authentication module to integrate with.

The current home page has no login entry point, and no `/login` route is registered yet. There is no shared design-system button enforced across the app — buttons are written inline per page using Tailwind utilities.

# Technical Approach

1. **Route registration** — register a `/login` route in the existing React Router configuration so the URL resolves to a page component. The route uses the same lazy/import style already used by neighboring routes for consistency.
2. **Home page change** — add a single button to the home page with `onClick` that calls `navigate('/login')` (React Router 7 `useNavigate`). Render the button using the same Tailwind utility pattern already used on the home page. No new component file, no new dependency, no design-system extraction.
3. **Login page** — render a minimal placeholder page at `/login` that confirms the navigation works (e.g. a heading "Login" and a back-to-home link). No form, no submit handler, no API call.
4. **No backend change** — zero modifications to `backend/`. No new endpoint, no middleware, no Prisma model.
5. **No state change** — no new Zustand store, no localStorage, no cookies. The navigation is purely client-side.

# Boundaries

**Architecture**

Owns: routing topology, route registration location, navigation API choice (`useNavigate`).

Does not own: visual styling details (delegated to UX), button copy or placement (delegated to UX), backend endpoints (out of scope), test scaffolding (delegated to QA).

**PO**

Owns: feature scope interpretation, acceptance of "only UI entry, no auth implementation."

Does not own: technical implementation choices inside `frontend/`.

**UX**

Owns: button label, button placement on the home page, button styling (Tailwind utilities), the visual layout of the `/login` placeholder page.

Does not own: routing configuration (delegated to Architecture), backend behavior (out of scope).

**DEV**

Owns: implementing the button on the home page, registering the `/login` route, rendering the placeholder login page.

Does not own: writing tests (delegated to QA), styling decisions (delegated to UX), scope interpretation (delegated to PO).

**QA**

Owns: verifying the button is visible on the home page, verifying click navigates to `/login`, verifying the `/login` route renders without error.

Does not own: implementation, styling, scope.
