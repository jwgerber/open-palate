# Easy Setup and Exploring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start with no settings, create the first admin without reading the log, copy sign-in links instead of emailing them, and load or remove sample data.

**Architecture:** Config generates and stores `SECRET_KEY` beside the SQLite file. A small `identity/setup_access.py` decides whether setup is open for a request (container flag, `SETUP_OPEN`, socket-peer + forwarded-client both private). Copy-link reuses the existing `signin` `LoginToken`. Sample rows carry an `is_sample` flag (migration 0005); loading and removal live in `tasting/sample_data.py`.

**Tech Stack:** Flask, SQLAlchemy 2, Alembic, pytest; React 19, MUI 7, Vitest.

**Spec:** `docs/specs/2026-11-18-easy-setup-design.md`

## Global Constraints

- Tests run on SQLite and on local Postgres only: `DATABASE_URL=postgresql://jwgerber@localhost:5432/open_palate_test TEST_DATABASE_URL=postgresql://jwgerber@localhost:5432/open_palate_test .venv/bin/python -m pytest`. Never any other database.
- No new runtime dependency (backend or frontend).
- Every new route goes through the existing access layer: `@require("admin")` for admin routes; the public auth routes are rate-limited like `request_link` (`@limiter.limit("5/minute")`, or a looser `"30/minute"` for the read-only status route).
- Never log or return a sign-in token, setup password or secret key except the one response that issues a link.
- The original app's name and any shop or staff names stay out of every file; `frontend/src/__tests__/noBannedStrings.test.js` and the backend name scan must pass.
- Sample roaster and coffee names are invented; no real company.
- **Ruling (route prefix):** the spec writes `/api/admin/...`; the admin blueprint's prefix is `/api/group`, so the new admin routes are `/api/group/members/<id>/signin-link` and `/api/group/sample-data`.
- Each task ends with the whole backend suite (`.venv/bin/python -m pytest -q`) and/or `cd frontend && npx vitest run` green, and one commit.

## Review Focus

1. A request from a public socket carrying `X-Forwarded-For: 127.0.0.1` must NOT open setup (Task 2 `test_spoofed_forwarded_for_from_public_peer_is_not_open`).
2. Two workers starting at once on an empty data folder must end with one key (Task 1 `test_existing_key_file_wins_over_a_second_create`).
3. A copied link for a member whose email already has a user signs in THAT user, and the user's older links stop working (Task 4 `test_link_reuses_existing_user_and_kills_older_links`).
4. A real tasting of a sample coffee survives "Remove sample data" (Task 7 `test_remove_keeps_sample_coffee_with_a_real_tasting`).
5. A group whose only coffees are archived refuses sample data (Task 7 `test_load_refused_when_only_archived_coffees`).

---

### Task 1: Settings: generated secret key, defaults, new switches

**Files:**
- Modify: `config.py`, `Dockerfile` (add `OPEN_PALATE_CONTAINER=1` to the `ENV` line), `.github/workflows/ci.yml` only if a job sets `SECRET_KEY` it no longer needs (leave otherwise)
- Test: `tests/test_config.py` (create)

**Interfaces:**
- Produces: `load_config(env=os.environ) -> dict` now returns also `SETUP_OPEN: bool`, `SETUP_PASSWORD: str | None`, `IN_CONTAINER: bool`; `resolve_secret_key(env, database_uri) -> str` in `config.py`.

- [ ] **Step 1: Write failing tests** in `tests/test_config.py`:
  - `test_env_secret_key_wins(tmp_path)`: `SECRET_KEY="x"` → `"x"`; no file written in `tmp_path`.
  - `test_sqlite_key_created_beside_db(tmp_path)`: `DATABASE_URL=f"sqlite:///{tmp_path}/t.db"`, no `SECRET_KEY` → key length ≥ 64, `(tmp_path/"secret_key").read_text().strip()` equals it, `stat().st_mode & 0o777 == 0o600`.
  - `test_key_is_stable_across_loads(tmp_path)`: two `load_config` calls return the same key.
  - `test_existing_key_file_wins_over_a_second_create(tmp_path)`: pre-write `secret_key` with `"abc"*20` → loaded key is that value (simulates the losing worker).
  - `test_unwritable_folder_fails_with_path(tmp_path)`: folder `chmod 0o500` → `RuntimeError` whose message contains the folder path and `SECRET_KEY` (skip when running as root).
  - `test_postgres_without_secret_key_fails()`: `DATABASE_URL="postgresql://u@h/db"` → `RuntimeError` mentioning `SECRET_KEY`.
  - `test_base_url_defaults_to_localhost(caplog)`: unset → `"http://localhost:8000"` and one WARNING containing `BASE_URL`.
  - `test_setup_switches`: `SETUP_OPEN="true"` → `True`; unset → `False`; `SETUP_PASSWORD=""` → `None`; `OPEN_PALATE_CONTAINER="1"` → `IN_CONTAINER True`.
  - `test_secret_never_logged(tmp_path, caplog)`: the generated key does not appear in `caplog.text`.
- [ ] **Step 2:** `.venv/bin/python -m pytest tests/test_config.py -v` → FAIL.
- [ ] **Step 3: Implement** `resolve_secret_key(env: Mapping, database_uri: str) -> str` in `config.py`: env value if non-empty; SQLite (`sqlite:///<path>`, use the folder of `<path>`) → read `secret_key` if present, else `os.open(path, O_WRONLY|O_CREAT|O_EXCL, 0o600)` and write `secrets.token_urlsafe(48)`; on `FileExistsError` read the file; on `OSError` raise `RuntimeError(f"Can't read or write {path}. Set SECRET_KEY, or make that folder writable.")`; Postgres → `RuntimeError("Set SECRET_KEY: with Postgres there is no data folder to keep a generated key in.")`. `load_config` stops requiring `SECRET_KEY`/`BASE_URL`, calls it after building the DB URI, defaults `BASE_URL` with the warning, and adds the three new keys.
- [ ] **Step 4:** the new tests and the full backend suite pass.
- [ ] **Step 5: Commit** `Settings: generate SECRET_KEY beside SQLite, default BASE_URL, setup switches`.

### Task 2: Who may create the first admin (backend)

**Files:**
- Create: `identity/setup_access.py`
- Modify: `identity/auth_routes.py` (`setup`, new `setup_status`), `identity/accounts.py` (`log_setup_link_if_needed` text + `SETUP_OPEN` warning)
- Test: `tests/identity/test_setup_open.py` (create)

**Interfaces:**
- Consumes: Task 1 config keys `SETUP_OPEN`, `SETUP_PASSWORD`, `IN_CONTAINER`, `PROXY_HOPS`.
- Produces: `is_private(addr: str | None) -> bool`; `is_local_request() -> bool`; `setup_is_open() -> bool`; `setup_password_ok(value) -> bool` in `identity/setup_access.py`. Route `GET /api/auth/setup-status`.

- [ ] **Step 1: Write failing tests** (build the app with explicit config dicts; set the socket peer with `environ_base={"REMOTE_ADDR": ...}` and the forwarded client with an `X-Forwarded-For` header):
  - `test_is_private_ranges`: true for `127.0.0.1`, `::1`, `10.1.2.3`, `172.16.0.1`, `172.31.255.255`, `192.168.1.5`, `fd00::1`, `fe80::1`; false for `172.32.0.1`, `8.8.8.8`, `2001:4860::1`, `None`, `"garbage"`.
  - `test_local_peer_without_proxy_header_is_open` (not in container, `PROXY_HOPS=1`, peer `192.168.1.5`, no header) → `POST /api/auth/setup` with name+email and no token → 200, an admin exists.
  - `test_spoofed_forwarded_for_from_public_peer_is_not_open`: peer `203.0.113.9`, header `X-Forwarded-For: 127.0.0.1` → 400 `invalid_token`.
  - `test_proxy_with_public_client_is_not_open`: peer `10.0.0.2`, header `198.51.100.7` → 400.
  - `test_container_is_never_open_without_switch`: `IN_CONTAINER=True`, peer `127.0.0.1` → 400.
  - `test_setup_open_switch_opens_anywhere`: `SETUP_OPEN=True`, `IN_CONTAINER=True`, peer `203.0.113.9` → 200.
  - `test_setup_password`: `SETUP_PASSWORD="hunter22"`, public peer: wrong value → 400 `invalid_token`; right value in `setup_password` → 200.
  - `test_token_still_works_from_public_peer` → 200 with `new_setup_token()`.
  - `test_status_before_admin`: public peer, password set → `{"needed": True, "open": False, "password": True}`; local peer, no password → `{"needed": True, "open": True, "password": False}`.
  - `test_status_after_admin_says_only_not_needed` → exactly `{"needed": False}`.
  - `test_setup_after_admin_is_409_even_when_open` → 409 `setup_done`.
  - `test_password_never_logged(caplog)`: neither `"hunter22"` nor the submitted value appears in `caplog.text`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `is_local_request()`: peer = `request.environ.get("werkzeug.proxy_fix.orig", {}).get("REMOTE_ADDR") or request.environ.get("REMOTE_ADDR")`; client = `request.remote_addr`; both `is_private`. `setup_is_open()`: `SETUP_OPEN` → True; `IN_CONTAINER` → False; else `is_local_request()`. `setup_password_ok`: `hmac.compare_digest` on UTF-8 bytes, False when unset or not a string. In `setup()`: accept when `setup_token_valid(token) or setup_password_ok(data.get("setup_password")) or setup_is_open()`; keep the `admin_exists()` → 409 check FIRST so a finished install answers 409 regardless. `setup_status()` (`@limiter.limit("30/minute")`). Log line: `"No admin yet. Open the app from this machine, or create the first admin within 15 minutes: %s"`; when `SETUP_OPEN` and no admin: one WARNING `"SETUP_OPEN is on: anyone who can reach this app can create the first admin."`.
- [ ] **Step 4:** tests + full suite pass.
- [ ] **Step 5: Commit** `Setup: open from the local network, SETUP_OPEN, SETUP_PASSWORD, setup-status`.

### Task 3: Setup flow in the frontend

**Files:**
- Modify: `frontend/src/auth/AuthContext.jsx` (fetch setup status), `frontend/src/App.jsx` (redirect), `frontend/src/auth/SetupPage.jsx`
- Test: `frontend/src/auth/__tests__/SetupPage.test.jsx`, `frontend/src/__tests__/App.auth.test.jsx`

**Interfaces:**
- Consumes: `GET /api/auth/setup-status` (Task 2); `POST /api/auth/setup` body `{display_name, email, token?, setup_password?}`.
- Produces: `useAuth().setup` = `{needed, open, password} | null`.

- [ ] **Step 1: Write failing tests:**
  - App: status `{needed: true, open: true}` at `/log` → lands on `/setup` and shows the name/email form with no token in the URL.
  - App: status `{needed: false}` → `/setup` with no token shows "Setup is already done" and a link to sign in (existing behavior kept).
  - SetupPage: `{needed: true, open: false, password: true}` → shows a "Setup password" field; submit sends `setup_password`.
  - SetupPage: `{needed: true, open: false, password: false}`, no token → no form; text contains "setup link" and "SETUP_PASSWORD".
  - SetupPage: valid `?token=` still shows the form whatever `open` says.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** AuthContext loads `/auth/setup-status` alongside `/auth/me` before marking `loading` false; App sends every route except `/setup` to `/setup` while `setup.needed`. Copy for the closed page: "Setup isn't open from here. Open the app on the server's own network, use the setup link printed in the server log, or set SETUP_PASSWORD. Trying it on your own computer with Docker? Set SETUP_OPEN=true."
- [ ] **Step 4:** `npx vitest run` passes; `npm run build` succeeds.
- [ ] **Step 5: Commit** `Setup page: open, password and closed states`.

### Task 4: Copy a sign-in link (backend)

**Files:**
- Modify: `identity/accounts.py`, `identity/admin_routes.py`
- Test: `tests/identity/test_signin_link_copy.py` (create)

**Interfaces:**
- Produces: `ADMIN_LINK_TTL = timedelta(hours=24)`; `issue_signin_link(user, ttl=LINK_TTL, supersede=False) -> tuple[str, datetime]` (link, expires_at) (supersede marks the user's other unused `signin` tokens `used_at=now`); route `POST /api/group/members/<int:member_id>/signin-link` → `{"link": str, "expires_at": iso}`.

- [ ] **Step 1: Write failing tests:**
  - `test_admin_gets_a_24h_link`: response 200; the `LoginToken` row has `purpose == "signin"`, `expires_at - now` within 24h ± 1 min; `GET` the link → redirect to `/` with a session cookie.
  - `test_link_works_once`: second consume → redirect `/signin?error=expired`.
  - `test_link_creates_user_even_when_signup_off`: `ALLOW_SIGNUP=False`, member with email and no user → a `User` with that email exists and `member.user_id` is set.
  - `test_link_reuses_existing_user_and_kills_older_links`: user exists with an emailed unused token → after copy, the old token's consume redirects to `expired`; the new one signs in the same `user.id`.
  - `test_refusals`: non-admin member → 403; other group's member id → 404; member without email → 409 `{"error": "no_email"}`; inactive → 409 `member_inactive`. (The sample-member refusal is tested in Task 6, which adds the flag.)
  - `test_link_not_logged(caplog)`: the raw token is absent from `caplog.text`; an INFO record names both member ids.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** in `admin_routes.py` with `@require("admin")`, CSRF as the other POSTs, `get_or_create_user(member.email, member.display_name)`, `link_roster_members(user)`, commit, log `logger.info("Sign-in link copied", extra={"admin_member_id": ..., "target_member_id": ..., "expires_at": ...})`.
- [ ] **Step 4:** pass + full suite.
- [ ] **Step 5: Commit** `Admins can copy a 24-hour sign-in link`.

### Task 5: Copy link button (frontend)

**Files:**
- Modify: `frontend/src/admin/GroupSettingsPage.jsx`
- Test: `frontend/src/admin/__tests__/GroupSettingsPage.test.jsx`

- [ ] **Step 1: Write failing tests:**
  - Member with email: "Copy sign-in link" posts to `/group/members/<id>/signin-link`, writes the link with `navigator.clipboard.writeText`, then shows "Copied. Works once, for 24 hours."
  - Clipboard rejects → a read-only text field holds the link, with "Copy it from here."
  - Member without email → button disabled; helper text "Add an email first".
  - Inactive member → no button.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (the link lives in component state only; cleared when the row closes or the page unmounts). **Step 4:** vitest passes, build succeeds. **Step 5: Commit** `Group settings: Copy sign-in link`.

### Task 6: Sample flag (migration 0005) and hiding sample tasters

**Files:**
- Create: `migrations/versions/0005_sample_flags.py`
- Modify: `identity/models.py` (`Member.is_sample`), `tasting/models.py` (`TastingCoffee.is_sample`, `TastingFlight.is_sample`), `identity/device_routes.py:57`, `identity/access.py:122`, `tasting/paper_routes.py:48`, `identity/admin_routes.py` (`_member_dict` adds `is_sample`; `patch_member` and the Task 4 route refuse sample members with 409 `sample_member`)
- Test: `tests/test_migrations.py` (extend), `tests/identity/test_sample_members.py` (create)

**Member query ledger** (every `Member` query outside tests/migrations):

| Site | Rule |
|---|---|
| `device_routes.py:57` device picker | filter `is_sample = false` |
| `access.py:122` `actor_for_pick` | filter → sample id is 404 |
| `paper_routes.py:48` paper taster | filter → 404 |
| `admin_routes.py:80` settings list | exception: shown, `is_sample` in the dict |
| `admin_routes.py:137` patch member | 409 `sample_member` |
| `admin_routes.py:123`, `accounts.py:53,61,77,79,91,106`, `access.py:59`, `auth_routes.py:162`, `flight_routes.py:382` | exception: keyed on email, user or role; sample members have none of those |

- [ ] **Step 1: Write failing tests:**
  - migration: `0005` upgrades from empty after 0004 and downgrades; the three columns are `NOT NULL` with default false (existing rows read false).
  - `test_device_members_hide_sample`, `test_device_cannot_pick_sample_member` (404), `test_paper_cannot_name_sample_member` (404), `test_admin_list_marks_sample`, `test_patch_sample_member_409`, `test_signin_link_for_sample_member_409` (`sample_member`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (`server_default=sa.false()`; batch mode for SQLite as 0003/0004 do). **Step 4:** pass on SQLite and Postgres. **Step 5: Commit** `Sample flag on members, coffees and flights; hide sample tasters`.

### Task 7: Load and remove sample data (backend)

**Files:**
- Create: `tasting/sample_data.py`
- Modify: `identity/admin_routes.py` (two routes)
- Test: `tests/tasting/test_sample_data.py` (create)

**Interfaces:**
- Consumes: `is_sample` columns (Task 6); `create_coffee`, `create_flight`, `_write_tastings` or the same validation path the tasting routes use, so sample reads obey every real rule.
- Produces: `load_sample_data(group_id: int, admin: Actor) -> dict`; `remove_sample_data(group_id: int) -> dict` (counts removed and kept); `has_sample_data(group_id) -> bool`; routes `POST /api/group/sample-data` (201 + counts), `DELETE /api/group/sample-data` (200 + counts), and `sample_data: bool` added to `GET /api/group`.

- [ ] **Step 1: Write failing tests:**
  - `test_load_adds_the_set`: 5 coffees, 3 members named `Sample · Robin`, `Sample · Sam`, `Sample · Jo` (no email, role `member`), 1 flight: shared, blind, basic, closed, host = the admin's member, 4 cups, 3 reads per cup, every row `is_sample`.
  - `test_coffee_pages_show_consensus`: `GET /api/tasting/coffees/<id>` for a flight coffee returns a consensus with `n == 3`.
  - `test_load_refused_when_not_empty` (409 `not_empty`); `test_load_refused_when_only_archived_coffees` (409 `not_empty`); `test_load_twice_409_already_loaded`.
  - `test_remove_deletes_only_sample_rows`: a real coffee and a real member survive; nothing flagged remains.
  - `test_remove_keeps_sample_coffee_with_a_real_tasting`: a real member logs a solo flight of a sample coffee → after remove the coffee exists with `is_sample False` and the tasting exists.
  - `test_sample_reads_not_in_admin_palate`: admin's `GET /api/tasting/palate` shows no reads.
  - `test_routes_admin_only`: editor → 403; device → 403.
  - `test_load_is_atomic`: force a failure mid-load (monkeypatch the flight step to raise) → no sample rows remain.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; coffee data is a module-level tuple in `sample_data.py` (invented roasters, real origins and processes from the enums, flavors from current lexicon keys). **Step 4:** pass on SQLite and Postgres. **Step 5: Commit** `Load and remove sample data`.

### Task 8: Sample data in the frontend

**Files:**
- Create: `frontend/src/tasting/bits/SampleDataCard.jsx`
- Modify: `frontend/src/tasting/log/LogTab.jsx`, `frontend/src/tasting/coffees/CoffeesTab.jsx`, `frontend/src/admin/GroupSettingsPage.jsx`
- Test: `frontend/src/tasting/__tests__/SampleDataCard.test.jsx` (create), `frontend/src/admin/__tests__/GroupSettingsPage.test.jsx`

- [ ] **Step 1: Write failing tests:**
  - Admin, no coffees → card "Explore with sample data" with the line "Adds 5 example coffees and a finished blind flight tasted by three sample tasters. Remove it any time in Group settings." and a Load button that posts to `/group/sample-data`, then reloads the tab.
  - Non-admin, or a group with coffees → no card.
  - Load answers 409 → the card shows the server's message, no crash.
  - Group settings with `sample_data: true` → "Remove sample data" opens a confirm ("Removes the sample coffees, tasters and flight. Real tastings stay.") and sends `DELETE /group/sample-data`.
  - Sample members in the list carry a "Sample" chip and no edit or copy-link actions.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** vitest + build pass. **Step 5: Commit** `Sample data card and removal`.

### Task 9: README and deploy docs

**Files:** Modify `README.md` (Quick start, First admin, Behind a proxy, Deploy to Render), `render.yaml` (comment only if needed)

- [ ] **Step 1:** Quick start leads with the laptop command `docker run -p 127.0.0.1:8000:8000 -v open-palate-data:/data -e SETUP_OPEN=true ghcr.io/jwgerber/open-palate:latest` and says it is safe only because the port is bound to `127.0.0.1`.
- [ ] **Step 2:** First admin lists the three ways (open setup, `SETUP_PASSWORD`, the log link) and when each applies, including that Docker on a server never opens setup by itself.
- [ ] **Step 3:** Behind a proxy adds: "Set PROXY_HOPS to the exact number of proxies. A higher number lets a visitor fake their address, which can open setup."
- [ ] **Step 4:** Settings table adds `SECRET_KEY` (generated beside SQLite when unset; required with Postgres), `BASE_URL` default, `SETUP_OPEN`, `SETUP_PASSWORD`.
- [ ] **Step 5:** `.venv/bin/python -m pytest -q` and `cd frontend && npx vitest run` pass (name scan included). **Commit** `README: no-settings start, first admin, proxy warning`.

## Ship Checklist

- [x] Migration: `0005` (sample flags) — runs on start via `start.sh`; check a fresh SQLite install and an upgraded dev DB both start. Done 2026-11-20 (fresh install and a 0004 copy both start).
- [x] Env vars: none required. New optional `SETUP_OPEN`, `SETUP_PASSWORD`; Dockerfile sets `OPEN_PALATE_CONTAINER=1`.
- [x] Third-party config: none.
- [x] Smoke (local, browser): delete `dev.db` and `secret_key`, start with no `SECRET_KEY`/`BASE_URL` → `/` goes to `/setup` with the form; create the admin; Group settings → Copy sign-in link for a member, open it in a private window → signed in as that member; Log → Load sample data → coffee page shows 3 reads; Remove sample data → gone. Done 2026-11-20 on a fresh SQLite file (dev.db left in place); the upgraded-DB check used a copy of a 0004 dev DB.
- [ ] Smoke (Docker, first real build): `docker build` then the README laptop command → setup form shows; without `SETUP_OPEN` → the closed page.
- [ ] Docs: README (Task 9); memory note `project_open_palate_fork.md` updated.
