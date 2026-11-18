# Tasting open-source fork — Phase 1 (café self-host) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, private repo containing Count's Tasting module as a standalone app
that one café can run with one Docker container. It has its own sign-in, a shared
tablet mode, and the Basic/Advanced forms.

**Architecture:** Copy (no git history) Count's `tasting/` backend, its tests and
`frontend/src/components/tasting/` into a fresh Flask + React/MUI repo. Replace
every Count seam with a small identity layer: users, groups, members, sessions and
device codes. One Flask process serves `/api/*` and the built Vite app. SQLite is
the default, Postgres is supported, and the Alembic chain builds from empty.

**Tech Stack:** Python 3.12, Flask, SQLAlchemy 2, Alembic, gunicorn, pytest. React 19,
MUI 7, Vite 7, Vitest. Docker, GHCR, Render blueprint.

**Spec:** `docs/superpowers/specs/2026-11-18-tasting-open-source-fork-design.md`
(Count repo; Task 1 copies it into the new repo).

**Where this runs:** In the NEW repo, not in Count. Count's files are read-only
sources: no task edits anything in Count.

## Global Constraints

- License **AGPL-3.0**. The repo and the GHCR image stay **private** until the owner has permission from SCA/WCR and Barista Hustle.
- No "Barista Hustle", "BH", "Count", "1369", "Central", "Inman" or shop staff names anywhere: code, UI, CSV headers, printed sheets or docs.
- Form names: `sheet` values are `basic` and `advanced`. Columns `bh_*` → `adv_*`, `bh_step` → `adv_step`, `bh_pass` → `adv_pass`.
- Behaviour kept exactly:
  - Blind is blind on the wire, host included, until close.
  - Reveal returns 409 while a flight is open.
  - Shared flights auto-close after 24h, or 48h for CSV-uploaded flights.
  - `CONSENSUS_THRESHOLD = 3`.
  - One person = one read per cup.
  - Coffees are archived, never deleted.
- Every query is scoped by `group_id` in the repository layer. Another group's id returns **404**, never 403.
- Sign-in links are single-use and expire after **15 min**.
- Session cookie: `httpOnly`, `SameSite=Lax`, **30-day rolling**. `Secure` follows the scheme of `BASE_URL`. Every non-GET needs a double-submit CSRF token.
- Every absolute link is built from `BASE_URL`, never from the request's host.
- Env vars: `SECRET_KEY` and `BASE_URL` (required); `DATABASE_URL` (unset → `sqlite:////data/tasting.db`); `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (optional); `ANTHROPIC_API_KEY` (optional; scan off without it); `ALLOW_SIGNUP` (default `false`); `PROXY_HOPS` (default `1`).
- Python deps pinned in `requirements.txt`; npm uses its lockfile.
- Package name `tasting` (backend). The repo name is the owner's choice (Task 1 gate).

## Review Focus

1. **A device session asking for a palate, the label key or host-only screens** must get 403. Task 6 adds `test_device_cannot_read_palate_or_label_key`.
2. **The same person logging through the tablet and then on their phone** must get the 409 duplicate, not a second read. Task 7b adds `test_device_then_phone_same_cup_conflicts`.
3. **Day boundaries in a group whose time zone is not UTC** (a flight opened at 11pm local) must bucket by the group's time zone. Task 7a adds `test_sessions_bucket_by_group_timezone`.
4. **Email case and whitespace** (`" Owner@Cafe.com"`) must resolve to one user, link the right member, and not open a duplicate account. Task 4 adds `test_email_normalized_on_request_and_member_link`.
5. **A deactivated member** must disappear from the tablet picker, and writes naming them are refused (422 `member_inactive`). Their past reads stay in consensus. Task 5 adds `test_inactive_member_not_pickable_reads_kept`.

---

### Task 1: New repo skeleton

**Gate:** the owner has chosen the repo/app name. Stop and ask if not.

**Files:**
- Create: `app.py` (factory `create_app(config: dict | None = None) -> Flask`), `config.py`, `extensions.py` (`db`), `utils.py`
- Create: `requirements.txt`, `pytest.ini`, `tests/conftest.py`, `LICENSE` (AGPL-3.0 full text), `.gitignore`
- Create: `docs/spec.md` (the spec copied verbatim), `docs/plan-phase1.md` (this plan)
- Test: `tests/test_app.py`

**Interfaces:**
- Produces:
  - `create_app(config)`.
  - `db`.
  - `utils.utc_now() -> datetime` (naive UTC), `utils.is_pg_int(v) -> bool`, `utils.csv_safe(s) -> str`, `utils.get_json_object() -> dict`, `utils.handle_db_errors` (decorator). Copy these five from Count's `utils.py` and nothing else.
  - Fixtures `app`, `db_session` and `client` in `tests/conftest.py`. They use SQLite in memory by default, or Postgres when `TEST_DATABASE_URL` is set.

- [ ] **Step 1:** `git init` a new private repo outside Count. Make the first commit with LICENSE, `.gitignore` and `docs/`.
- [ ] **Step 2: Write the failing test.** `test_create_app_requires_secret_key`: with `SECRET_KEY` unset, `create_app()` raises `RuntimeError` mentioning `SECRET_KEY`. `test_database_url_defaults_to_data_sqlite`: with `DATABASE_URL` unset, `app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:////data/tasting.db"`.
- [ ] **Step 3:** Run `pytest tests/test_app.py -v`. Expected: FAIL (no `app` module).
- [ ] **Step 4:** Implement the factory, config and the five utils. Wrap `app.wsgi_app` in `ProxyFix(x_for=PROXY_HOPS, x_proto=PROXY_HOPS)` when `PROXY_HOPS > 0`.
- [ ] **Step 5:** Run `pytest -v`. Expected: PASS.
- [ ] **Step 6:** Commit: `skeleton: app factory, config, AGPL license`.

### Task 2: Identity tables and a from-empty Alembic chain

**Files:**
- Create: `identity/models.py`, `migrations/` (`alembic init`), `migrations/versions/0001_identity.py`
- Test: `tests/test_migrations.py`, `tests/identity/test_models.py`

**Interfaces:** Produces models `User`, `Group`, `Member`, `LoginToken`, `Session`, `DeviceCode` with exactly these columns:

```
users         id, email (unique, stored lower-cased+stripped), display_name, created_at, last_login_at
groups        id, name, timezone (IANA, default 'UTC'), is_personal (bool, default false), created_at
members       id, group_id FK, display_name, email NULL, user_id NULL FK users, role CHECK IN
              ('admin','editor','member'), active (default true), created_at;
              UNIQUE (group_id, user_id); partial UNIQUE (group_id, lower(email)) WHERE email IS NOT NULL
login_tokens  id, user_id FK, token_hash (sha256 hex, unique), purpose CHECK IN ('signin','setup'),
              expires_at, used_at NULL
sessions      id, user_id NULL, device_group_id NULL FK groups, token_hash unique, kind CHECK IN
              ('user','device'), created_at, last_seen_at, expires_at, revoked_at NULL;
              CHECK ((kind='user' AND user_id IS NOT NULL AND device_group_id IS NULL)
                  OR (kind='device' AND device_group_id IS NOT NULL AND user_id IS NULL))
device_codes  id, group_id FK, code_hash unique, created_by FK users, expires_at, revoked_at NULL
```

`flight_links` is Phase 2; do not create it.

- [ ] **Step 1: Write failing tests.**
  - `test_upgrade_head_from_empty`: run `alembic upgrade head` against a fresh SQLite file, then inspect that all six tables exist.
  - Same test parametrized for Postgres when `TEST_DATABASE_URL` is set.
  - `test_downgrade_base_then_upgrade`: round trip.
  - `test_session_kind_shape_check`: a `device` session that has a `user_id` raises `IntegrityError`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the models and migration `0001`. `env.py` reads the app's `SQLALCHEMY_DATABASE_URI`. Tests build schema with Alembic, never `create_all`.
- [ ] **Step 4:** Run. Expected: PASS on SQLite (and Postgres if set).
- [ ] **Step 5:** Commit: `identity tables + from-empty migration chain`.

### Task 3: Port the tasting tables (group-scoped, Basic/Advanced)

**Files:**
- Create: `tasting/models.py` (from Count's), `migrations/versions/0002_tasting.py`
- Test: `tests/tasting/test_models.py` (from Count's `test_tasting_models.py`)

**Interfaces:**
- Consumes: `Group`, `Member`, `User` (Task 2).
- Produces the same model classes as Count, with these changes:
  - `TastingCoffee.group_id` (NOT NULL); `created_by` FK `users.id` NULL. `tasting_coffee_stores` and its relationship are dropped.
  - `TastingFlight`: `group_id`; `host_member_id` FK `members.id` NULL; `host_user_id` FK `users.id` NULL. New `is_open_link` bool, default false (unused until Phase 2).
  - `Tasting`: `member_id` FK `members.id` NULL; `user_id` FK `users.id` NULL. Rows that hang off a flight get their group through the flight.
  - Partial unique indexes `uq_tasting_flight_coffee_member (flight_id, coffee_id, member_id) WHERE member_id IS NOT NULL` and `uq_tasting_flight_coffee_user (flight_id, coffee_id, user_id) WHERE user_id IS NOT NULL`. The existing `(flight_id, coffee_id, taster_key)` unique constraint is kept.
  - `SHEETS = ("basic", "advanced")`. `BH_CATEGORIES` → `ADV_CATEGORIES`. All `bh_*` columns and check names → `adv_*`.
  - `taster_key` forms: `user:<id>`, `member:<id>`, `paper:member:<id>`, `paper:name:<name>`. The `guest:` form is Phase 2.
  - `TastingFlight.created_at`-style columns stay naive UTC.

- [ ] **Step 1:** Copy Count's model tests and rewrite their fixtures to the new FKs. Add:
  - `test_member_and_user_unique_indexes`: two `Tasting` rows with the same `(flight, coffee, member_id)` and different `taster_key`s raise `IntegrityError`. Same for `user_id`.
  - `test_no_bh_identifiers`: walk `Base.metadata` and assert that no table, column, index or constraint name contains `bh`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Port the models and write migration `0002` (SQLite: partial indexes via `sqlite_where`, Postgres: `postgresql_where`).
- [ ] **Step 4:** Run `pytest tests/tasting/test_models.py tests/test_migrations.py`. Expected: PASS.
- [ ] **Step 5:** Commit: `tasting tables: group scope, member/user identity, Basic/Advanced`.

### Task 4: Accounts — email sign-in, sessions, CSRF, first admin

**Files:**
- Create:
  - `identity/tokens.py`: `new_token() -> tuple[str, str]` returning `(raw, sha256_hex)`; `hash_token(raw) -> str`.
  - `identity/mail.py`: `send_signin_email(to: str, link: str) -> None`. Uses SMTP when `SMTP_HOST` is set, otherwise logs the link at INFO.
  - `identity/sessions.py`
  - `identity/auth_routes.py` (blueprint `/api/auth`)
  - `identity/cli.py`
- Test: `tests/identity/test_auth.py`, `tests/identity/test_cli.py`

**Interfaces:**
- Produces:
  - `sessions.start_user_session(user) -> Response-cookie setter`.
  - `sessions.current_session() -> Session | None`. This checks rolling expiry and bumps `last_seen_at` and `expires_at` at most once an hour.
  - Cookie names `tasting_session` (httpOnly) and `tasting_csrf` (readable by JS). The client echoes the CSRF value in header `X-CSRF-Token`.
- Routes:
  - `POST /api/auth/request-link {email}` → always 200 `{"status":"sent"}`. It sends only when the email belongs to a `User`, or matches an active `Member.email` (in which case it creates the `User`), or `ALLOW_SIGNUP` is true.
  - `GET /api/auth/consume?token=` → sets the cookie and redirects to `BASE_URL + "/"`. If the token is used or expired, it redirects to `/signin?error=expired`.
  - `POST /api/auth/logout`.
  - `GET /api/auth/me` → `{user, groups:[{id,name,role,timezone}], kind}` or 401.
- **Member linking:** on consume, set `Member.user_id` on every member row whose `lower(email)` matches the user's email and whose `user_id` is NULL.
- CLI: `flask create-admin <email>` creates or gets the `User`. If the install has no group, it creates `Group(name="My café", timezone="UTC")`. It creates an `admin` member row and prints `BASE_URL/api/auth/consume?token=…` (purpose `signin`).
- **Startup setup link:** in `create_app`, when no `members.role='admin'` row exists, log a one-time `setup` token link at WARNING. On consume, a `setup` token takes an email and display name (`POST /api/auth/setup {token, email, display_name}`) and creates the first admin plus the default group. It has the same 15-min TTL and is regenerated on each start. Skip this while `TESTING`, unless a test enables it.

- [ ] **Step 1: Write failing tests.**
  - `test_request_link_unknown_email_sends_nothing_same_reply`
  - `test_link_single_use_and_15_min_expiry` (freeze time at +15m+1s)
  - `test_session_rolls_30_days`
  - `test_secure_flag_follows_base_url_scheme` (https → Secure; `http://localhost` → no Secure)
  - `test_non_get_without_csrf_header_403`
  - `test_email_normalized_on_request_and_member_link`
  - `test_consume_links_roster_member`
  - `test_signin_link_uses_base_url_not_host_header` (send `Host: evil.example`; the emailed link starts with `BASE_URL`)
  - `test_create_admin_prints_link`
  - `test_setup_link_logged_until_admin_exists`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Rate-limit `request-link` to 5/min per IP with Flask-Limiter in memory.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `accounts: email sign-in, rolling sessions, CSRF, first admin`.

### Task 5: Shared device mode and group admin

**Files:**
- Create: `identity/device_routes.py`, `identity/admin_routes.py` (both under `/api/group`)
- Test: `tests/identity/test_device.py`, `tests/identity/test_admin.py`

**Interfaces:**
- Admin routes (group `admin` only):
  - `GET|PATCH /api/group` (`name`, `timezone`, validated with `zoneinfo`; 422 `bad_timezone`).
  - `GET|POST /api/group/members` and `PATCH /api/group/members/<id>` (`display_name`, `email`, `role`, `active`). The last active admin cannot be demoted or deactivated (409 `last_admin`).
  - `POST /api/group/device-codes` returns 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown once, with a 7-day expiry until used.
  - `DELETE /api/group/device-codes/<id>` revokes the code and every device session it created.
- Device routes:
  - `POST /api/device/enter {code}`: when the code is valid, starts a `device` session for that group (expires after 365 days, rolling). The code is single-use; 10/min per IP.
  - `GET /api/device/members` lists the active members `[{id, display_name}]` sorted by name. This replaces Count's `/kiosk/on-shift`.

- [ ] **Step 1: Write failing tests.**
  - `test_device_code_single_use`
  - `test_revoking_code_ends_device_sessions`
  - `test_inactive_member_not_pickable_reads_kept` (needs Task 7b for the reads half; until then, assert only the picker half and add the reads half in 7b)
  - `test_last_admin_cannot_be_demoted`
  - `test_bad_timezone_422`
  - `test_member_cannot_reach_admin_routes_403`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `shared device mode and group admin`.

### Task 6: Access layer replacing permission keys

**Files:**
- Create: `identity/access.py`
- Test: `tests/identity/test_access.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class Actor:
    kind: Literal["user", "device"]
    group_id: int
    user_id: int | None          # user sessions; for devices, set from the picked member's user_id
    member_id: int | None        # user: their member row here; device: the picked member
    role: Literal["admin", "editor", "member"] | None   # None on a device
    display_name: str

def require(level: Literal["member", "self", "device", "manage", "admin"]):  # route decorator
def current_actor() -> Actor          # valid inside a decorated route
def actor_for_pick(member_id: int) -> Actor   # device writes: 422 member_inactive / 404 other group
```

Level mapping: `member` = any session in the group (`tasting.view`/`.edit`); `self` = user session only (`tasting.self`); `device` = device session only (`tasting.kiosk`); `manage` = editor or admin (`tasting.manage`); `admin` = `tasting.close_any` and group admin.

In Phase 1 the group comes from the session: the single member row for a user, or `device_group_id`. A user with no member row gets 403 `no_group`.

- [ ] **Step 1: Write failing tests.**
  - The full matrix: each level × {user-member, user-editor, user-admin, device, no session}. The expected status for each cell comes from the mapping above.
  - `test_device_cannot_read_palate_or_label_key`. Write it against stub routes here and re-point it at the real routes in Task 7b.
  - Mutation-prove the matrix: loosen one level and see a test fail; tighten one and see a test fail.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `access layer: actors and levels replace permission keys`.

### Task 7a: Port coffees, coffee CSV, sessions and lexicon content

**Files:**
- Create:
  - `tasting/repository.py`: the coffee half of Count's file. Split it, with flights going to `tasting/flights_repository.py` in 7b, keeping each under ~600 lines.
  - `tasting/coffee_csv.py`, `tasting/coffee_sessions.py`
  - `tasting/content.py`
  - `content/lexicon.json`, `content/forms.json`, `content/schema/*.json`
  - `tasting/routes.py`: the coffee routes and `GET /api/content`
- Test: ported `test_tasting_coffee_csv.py`, `test_tasting_coffee_sessions.py`, `test_tasting_lexicon.py` → `tests/tasting/test_content.py`, plus the coffee cases from `test_tasting_routes.py`

**Interfaces:**
- Every repository function that took `store_id`, `employee_id` or a Count `user_id` string now takes `group_id: int` and/or `actor: Actor`. `TasterIdentity` is rebuilt from `Actor` (`key()` emits the Task 3 forms).
- `content.load() -> Content`, read once at startup. `Content` has `lexicon` (Count's `TREE` and enums, unchanged) and `forms` (`basic`: scales and labels; `advanced`: category labels, step wording and vote wording). Scores, D/Q 7.0, the 7.5–10 range and the required bar vote stay in code (spec: fixed columns).
- `GET /api/content` (`member` level) returns `Content` as JSON with an `ETag`.
- `coffee_sessions` buckets days with `utils.to_group_local(dt, tz: str) -> datetime` (add it to `utils.py`), replacing `utc_to_eastern`.
- The coffee CSV drops the store column. Importing a file that has a `stores` header ignores that column and reports a warning `ignored_column: stores`.

- [ ] **Step 1:** Port the tests, swapping identity fixtures for `Actor` factories (`make_actor(role=..., kind=...)` in `tests/factories.py`). Add:
  - `test_sessions_bucket_by_group_timezone` (group `America/Los_Angeles`, flight at 06:30 UTC → the previous local day)
  - `test_coffee_in_other_group_404`
  - `test_content_files_match_schema`
  - `test_content_has_no_brand_strings` (no "Barista Hustle" or "BH" in `content/`)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Port. Generate `content/lexicon.json` once from Count's `tasting/lexicon.py` with a throwaway script; do not commit the script.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `coffees, coffee CSV, sessions, content files`.

### Task 7b: Port flights, tastings, reveal, palate, paper, scan and flight CSV

**Files:**
- Create: `tasting/flights_repository.py`, `tasting/cupping.py`, `tasting/flight_edit.py`, `tasting/flight_csv.py`, `tasting/scan.py`. Add the remaining routes to `tasting/routes.py` and split them into `tasting/flight_routes.py` if the file passes ~600 lines.
- Test: ported `test_tasting_repository.py`, `test_tasting_cupping.py`, `test_tasting_flight_csv.py`, `test_tasting_flight_edit.py`, `test_tasting_scan.py`, the flight half of `test_tasting_routes.py`, and `tests/tasting/test_blind_on_wire.py` (new)

**Interfaces:**
- Consumes: `Actor`, `require`, `actor_for_pick` (Task 6); `to_group_local` (7a).
- Routes keep Count's paths (minus `/kiosk/on-shift`), with levels as in Count's keys mapped by Task 6.
- Device writes send `member_id` in the body. Writes stamp both `member_id` and `user_id` (from the member's `user_id`). A user write stamps `user_id` and their own `member_id`.
- **Host rules:**
  - A user or a device can host. On a device, `host_member_id` is the picked member and `host_user_id` is NULL.
  - Host powers belong to the matching `host_member_id` on any device of the group, or to the matching `host_user_id`, or to that member's linked user.
  - The label key is never served to a device session.
- **Paper entry and scan:** the host (either door) or `manage`.
- **Palate:** `self` level. It reads rows where `user_id = me` OR `member_id IN (my member rows)`.
- **Scan:** `scan_models` comes from config (default: Count's `FALLBACK_MODELS` values, copied). `POST …/paper/scan` returns 404 `scan_disabled` when `ANTHROPIC_API_KEY` is unset. Photos are never stored or logged.
- Printed sheets, CSV headers and flight-CSV columns use the `adv_` / Advanced names.

- [ ] **Step 1:** Port the tests. Add:
  - `test_device_then_phone_same_cup_conflicts` (409)
  - `test_device_cannot_read_palate_or_label_key` (re-pointed at the real routes)
  - `test_blind_on_wire`: for each of user, device, host and editor, while a blind flight is open, walk every GET under `/api/tasting` that takes the flight, and assert that the JSON has no other taster's scores, no tags and no coffee identity
  - `test_reveal_409_while_open`
  - `test_auto_close_24h_and_48h_csv`
  - `test_flight_in_other_group_404`
  - `test_palate_includes_device_reads_after_link`
  - `test_scan_disabled_without_key`
  - The reads half of `test_inactive_member_not_pickable_reads_kept`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Port.
- [ ] **Step 4:** Run the full `pytest`, on SQLite and with `TEST_DATABASE_URL` on Postgres. Expected: all PASS.
- [ ] **Step 5:** Commit: `flights, tastings, reveal, palate, paper, scan`.

### Task 8: Frontend shell and the ported Tasting UI

**Files:**
- Create: `frontend/` (Vite + React 19 + MUI 7 + Vitest; lockfile committed)
  - `src/main.jsx`, `src/App.jsx`, `src/api.js`
  - `src/auth/AuthContext.jsx`, `src/auth/SignInPage.jsx`, `src/auth/DeviceCodePage.jsx`, `src/auth/SetupPage.jsx`
  - `src/admin/GroupSettingsPage.jsx` (group, members, device codes)
- Copy: `frontend/src/components/tasting/**` from Count to `src/tasting/**`. **Exclude** `fetco/`. Rename `bh/` → `advanced/` and every `Bh`/`bh` identifier and label to Advanced.
- Copy and adapt: `utils/apiError.js`, `common/ConfirmDialog.jsx`. Replace `utils/storeTime` with `src/time.js` taking the group time zone. Drop `AppContext` uses (stores) and `lexicon.generated.js`.
- Test: the ported `__tests__` (minus fetco), plus `src/auth/__tests__/*.test.jsx`

**Interfaces:**
- `api.js`: an axios instance with `withCredentials`. It reads the `tasting_csrf` cookie into `X-CSRF-Token` on non-GET requests. A 401 sends the browser to `/signin`.
- `AuthContext` exposes `{kind, user, group, role, refresh}` from `/api/auth/me`.
- `useTastingIdentity()` keeps its return shape: `isPerson` = `kind === 'user'`; `canManage` = role ∈ editor/admin; `canKiosk` and `isSharedDevice` = `kind === 'device'`; `canCloseAny` = admin.
- `useContent()` fetches `/api/content` once and replaces the `lexicon.generated` imports.
- Routes: `/signin`, `/device`, `/setup`, `/admin` (admin only), and `/*` → `TastingPage`. Keep `/f/<id>`-style flight links working.

- [ ] **Step 1:** Port the tests. Rewrite the auth mocks to `AuthContext`. Add:
  - `SignInPage` shows the same message for any email
  - `DeviceCodePage` stores nothing in `localStorage`
  - `api.js` sends `X-CSRF-Token` on POST
  - `test_no_bh_strings`: grep `src/` for `/\bbh\b|Barista|Hustle/i` → none
- [ ] **Step 2:** Run `npx vitest run`. Expected: FAIL.
- [ ] **Step 3:** Port.
- [ ] **Step 4:** Run `npx vitest run` and `npm run build`. Expected: PASS, build OK.
- [ ] **Step 5:** Commit: `frontend shell and ported Tasting UI`.

### Task 9: Packaging — Docker, backup, health, Render, README

**Files:**
- Create:
  - `Dockerfile`: multi-stage. A node stage builds `frontend/dist`; a python:3.12-slim stage runs gunicorn on `:8000` as a non-root user, with `VOLUME /data`.
  - `start.sh`: `alembic upgrade head`, then `exec gunicorn`.
  - `tasting_cli.py`: `flask backup [dir]`.
  - The `/healthz` route.
  - `render.yaml`, `.github/workflows/ci.yml` (pytest on SQLite and on a Postgres service; vitest; build)
  - `.github/workflows/image.yml`: pushes to GHCR on a version tag, tagged `vX.Y.Z` and `latest`. The package stays private.
  - `README.md`
- Test: `tests/test_backup.py`, `tests/test_health.py`, `tests/test_static.py`

**Interfaces:**
- `flask backup [dir=/data/backups]`:
  - Uses `sqlite3.Connection.backup` into `tasting-YYYY-MM-DD.db`, overwriting the same day's file.
  - Keeps the newest 14 and prints the path.
  - On Postgres it exits with status 2 and the message `use your database host's backups`.
- `GET /healthz` → 200 `{"ok":true}` after `SELECT 1`. Returns 503 `{"ok":false}` on a database error. No auth, no other data.
- Flask serves `frontend/dist`, falling back to `index.html` for non-`/api` paths.
- `render.yaml`:
  - A web service from the image, with a 1 GB disk at `/data`.
  - `SECRET_KEY: generateValue`, `BASE_URL` prompted (`sync: false`), `healthCheckPath: /healthz`, and a paid plan named.
- README sections, in order: What it is; Quick start (docker run); First admin (setup link in the logs, or `create-admin`); The shop tablet; Email and scan (optional); Behind a proxy (`BASE_URL`, `PROXY_HOPS`); Backups and restore (host cron line `0 3 * * * docker exec tasting flask backup`, copy off the machine); Updating (back up first, pin a tag); Deploy to Render (button and cost); Development; License.

- [ ] **Step 1: Write failing tests.**
  - `test_backup_consistent_while_writing` (open a write transaction, back up, and the copy opens and has the committed rows)
  - `test_backup_keeps_14`
  - `test_backup_postgres_refuses`
  - `test_healthz_ok_and_503`
  - `test_spa_fallback_not_for_api` (`/api/nope` → 404 JSON, `/coffees/3` → index.html)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pytest`. Then run `docker build -t tasting . && docker run --rm -e SECRET_KEY=x -e BASE_URL=http://localhost:8000 -p 8000:8000 -v tdata:/data tasting`. Expected: the log shows the setup link, and `curl localhost:8000/healthz` returns `{"ok":true}`.
- [ ] **Step 5:** Commit: `packaging: docker, backup, healthz, render blueprint, README`.

### Task 10: Whole-branch review and clean-room check

- [ ] **Step 1:** Run `requesting-code-review` over the whole repo, with the anti-goals from the spec as the brief. Fix critical and high findings.
- [ ] **Step 2:** Clean-room grep over the repo, case-insensitive, for `count|1369|central|inman|barista hustle|\bbh_|supabase|employee|store_id|shift_identity|fetco`. Expected: no hits outside `docs/spec.md` and `docs/plan-phase1.md`.
- [ ] **Step 3:** Run `git log --format=%B | grep -i count` to check commit messages. Expected: none.
- [ ] **Step 4:** Commit any fixes: `review fixes`.

## Ship Checklist

- [ ] **Owner:** repo/app name chosen (Task 1 gate).
- [ ] **Repo:** created **private** on GitHub with Actions enabled. No push to a public remote until SCA/WCR and Barista Hustle permission is in hand.
- [ ] **Migration:** None in Count. The new repo's `0001`/`0002` run on container start.
- [ ] **Env vars:** none on Count's Render. The new app's are listed in the README.
- [ ] **Third-party config:** GHCR package visibility left **private**. The `image.yml` workflow uses `GITHUB_TOKEN` (`packages: write`).
- [ ] **Smoke 1 (local Docker):**
  1. Run the Task 9 command and open the setup link from the log.
  2. Create an admin and set the time zone. Add 3 members, one with your email.
  3. Make a device code and enter it in a second browser profile.
  4. Host a blind flight on the "device" and log reads as two members.
  5. Check: no scores are visible in DevTools responses before close. After close, the reveal shows both.
  6. `docker exec <c> flask backup` prints a path.
- [ ] **Smoke 2 (Render, private):** deploy from `render.yaml` (paid plan + disk); read the setup link from Render's logs and sign in; `/healthz` returns 200; redeploy and the data survives; delete the service afterwards.
- [ ] **Docs:** README complete per Task 9. Count's spec status line updated to "Phase 1 built in <repo>". No Count CLAUDE.md change (Count is unchanged).
