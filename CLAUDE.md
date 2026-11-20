# Open Palate

A standalone tasting app for coffee teams: flights, blind cupping, a flavor wheel, consensus scores. It began as a one-time fork of a private café app's Tasting module. Licensed AGPL-3.0.

- Backend: Flask + SQLAlchemy + Alembic. SQLite by default (`/data/tasting.db`), Postgres when `DATABASE_URL` is set. `identity/` holds accounts, sessions, devices and setup; `tasting/` holds flights, coffees, palate and paper entry.
- Frontend: React 19 + MUI 7 + Vite in `frontend/`. Flask serves the built `frontend/dist`.
- Ships as one Docker image (`Dockerfile`, `docker-entrypoint.sh`, `start.sh`). `render.yaml` is the Render blueprint.
- Design and history: `docs/spec.md`, `docs/plan-phase1.md`, `docs/specs/`, `docs/plans/`. The Phase 1 build ledger is `.superpowers/sdd/plan-phase1/progress.md` (git-ignored, local only).

## Commands

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest                      # backend; TEST_DATABASE_URL=postgresql://... also runs Postgres
cd frontend && npm ci && npx vitest run   # frontend tests
cd frontend && npm run build              # build the SPA Flask serves
```

Run locally, as the README describes: `alembic upgrade head`, then `flask run --port 8000`, with `npm run dev` for the frontend. With no `DATABASE_URL`, the app wants `/data`, which doesn't exist on a Mac. Pass an absolute SQLite URL such as `sqlite:////path/to/file.db` (a relative one lands in `instance/`). Docker isn't installed on this Mac, so the image has never been built locally.

CI (`.github/workflows/ci.yml`) runs both suites on SQLite and Postgres. `image.yml` publishes `ghcr.io/jwgerber/open-palate` only on a `v*` tag.

## Rules

- **The flavor-wheel lexicon (`content/lexicon.json`) stays identical to the original app's.** Do not edit terms, order or structure.
- **No names of the original app, shop or flavor-wheel publishers in the code or docs**, except the attribution in the README's Flavor wheel section. `tests/tasting/test_content.py` scans for them using sha256 hashes. Never write the banned names into source to make the scan pass.
- **The repo is private, so don't make it public or push anywhere new** until owner permission from the flavor-wheel and cupping-sheet publishers is in hand.
- One-way fork: nothing here is synced back to the original app, and nothing there is pulled in.
- Invariants from the spec that must not regress:
  - Blind stays blind on the wire, host included, until close.
  - No scores and no coffee identities leak before close, by any route (reveal returns 409 while a flight is open).
  - Coffee consensus needs `CONSENSUS_THRESHOLD = 3`.
  - One person gets one read per cup, however they signed in.
- Device (shared tablet) checks branch on `actor.kind`, never on `user_id is not None`, because a device pick of a linked member carries a `user_id`.
- Gunicorn and werkzeug logs must not record query strings, because sign-in links carry `token=`.
