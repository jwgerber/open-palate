# Multi-group Phase 1a (Backend Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One install holds many groups: each request names its group with `X-Group`, an owner runs the install, the owner makes teams, anyone can make a personal space, and today's clients keep working unchanged.

**Architecture:** `_resolve_actor()` in `identity/access.py` stays the only place a request's group is decided; it reads `X-Group` and falls back to today's behaviour when the header is absent. A new `signed_in` level serves routes with no group. Owner and install settings are new columns/tables (migration 0007). A new `identity/groups_routes.py` blueprint holds team, personal-space and owner routes. One helper (`identity/address.py`) gives the app's address.

**Tech Stack:** Flask, SQLAlchemy 2, Alembic, pytest. No frontend changes in 1a (that's 1b).

**Spec:** `docs/specs/2026-11-20-multi-group-and-setup-design.md` (sections "How a request picks its group", "Owner", "Setup gate", "Install settings and the app's address", "Groups", "Migrations: Phase 1a").

## Global Constraints

- Tests run on SQLite and on local Postgres only: `DATABASE_URL=postgresql://jwgerber@localhost:5432/open_palate_test TEST_DATABASE_URL=postgresql://jwgerber@localhost:5432/open_palate_test .venv/bin/python -m pytest`. Never any other database.
- No new runtime dependency.
- Blind stays blind and nothing leaks before close, **per group**: a request acting in group A never reads or writes group B. Wrong-group answers are **404**, never 403.
- Device checks branch on `actor.kind` / `session.kind`, never on `user_id`.
- Being owner gives **no** access inside a group.
- Never log or return a token except in the one response that issues it.
- No names of the original app, shop or flavor-wheel publishers; the name scan must pass.
- Each task ends with the whole backend suite (`.venv/bin/python -m pytest -q`) green and one commit.

## Review Focus

1. A user in groups A and B sends `X-Group: A` with a flight id from B → 404, on every route (Task 6 sweep).
2. A device session sends `X-Group` naming another group → 404, not a silent switch (Task 2 `test_device_header_other_group_404`).
3. An existing single-group install upgrades and its admin keeps working with no header (Task 1 `test_upgrade_backfills_owner`, Task 2 `test_no_header_one_group_unchanged`).
4. A personal space created before setup must not close the setup gate (Task 3 `test_personal_space_refused_while_setup_needed`).
5. `X-Group: abc` / `X-Group: 99999999999` / empty header → 404 `group_not_found`, never a 500 (Task 2 `test_bad_header_values_404`).

---

### Task 1: Migration 0007 — owner, install settings, personal groups

**Files:**
- Create: `migrations/versions/0007_multi_group.py`
- Modify: `identity/models.py` (User, Group; new `InstallSettings`)
- Test: `tests/test_migrations.py`, `tests/identity/test_models.py`

**Interfaces:**
- Produces: `User.is_owner: bool` (default False); `Group.personal_user_id: int | None` (FK users, unique when not null); `InstallSettings` (table `install_settings`, columns `id` PK fixed at 1, `public_url: str | None`).

The schema shape is the decision:

```python
# users
sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.false())
# groups
sa.Column("personal_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)
sa.Index("uq_groups_personal_user", "personal_user_id", unique=True,
         sqlite_where=sa.text("personal_user_id IS NOT NULL"),
         postgresql_where=sa.text("personal_user_id IS NOT NULL"))
sa.CheckConstraint("(is_personal AND personal_user_id IS NOT NULL) OR "
                   "(NOT is_personal AND personal_user_id IS NULL)", name="ck_groups_personal_user")
# install_settings: id INTEGER PK CHECK (id = 1), public_url VARCHAR(255) NULL; insert row id=1
```

Owner backfill (data step in `upgrade()`): among active `admin` members of the lowest-id group with `is_personal = false`, pick the one with a `user_id`, earliest `created_at`, ties lowest `members.id`; else any active admin member with a user, same ordering, in any non-personal group. Set that user's `is_owner = true`. Print which member id was chosen (Alembic logger). None found → do nothing.

`downgrade()` drops all three (use `batch_alter_table` for SQLite, as 0005 does).

- [ ] **Step 1: Write failing tests** in `tests/test_migrations.py` (use the existing `fresh_url` fixture, both dialects):
  - `test_upgrade_backfills_owner`: upgrade to 0006, insert a group, admin A (`created_at` older), admin B, member C, all with users; upgrade to 0007 → only A's user has `is_owner`.
  - `test_owner_backfill_skips_admin_without_user`: earliest admin has `user_id NULL` → the next admin with a user is owner.
  - `test_owner_backfill_none_when_no_admin_user`: no admin with a user → no owner, upgrade succeeds.
  - `test_install_settings_row_exists`: exactly one row, `id = 1`, `public_url NULL`.
  - `test_personal_user_unique`: two personal groups for the same user → `IntegrityError`; a non-personal group with `personal_user_id` set → `IntegrityError`.
  - `test_0007_downgrade_roundtrip`: upgrade → downgrade to 0006 → upgrade again succeeds.
- [ ] **Step 2:** run `.venv/bin/python -m pytest tests/test_migrations.py -k "0007 or owner or install_settings or personal_user" -v` → FAIL.
- [ ] **Step 3:** write the migration and the model fields.
- [ ] **Step 4:** the tests above and the full suite pass on SQLite and Postgres.
- [ ] **Step 5: Commit** `Migration 0007: owner flag, install settings, personal groups`.

### Task 2: Group from `X-Group`, and the `signed_in` level

**Files:**
- Modify: `identity/access.py`
- Test: `tests/identity/test_access.py`

**Interfaces:**
- Consumes: Task 1 models.
- Produces:
  - `require("signed_in")`: user sessions only; device → 403 `forbidden`; no session → 401. Builds no Actor; routes read the user with `current_user() -> User` (new, in `identity/access.py`; raises `RuntimeError` outside a `signed_in` route).
  - `GROUP_HEADER = "X-Group"`.
  - `_resolve_actor()` rules (exact codes from the spec):
    - header present, valid int, active member row for `(session.user_id, header)` → Actor for it;
    - header present but not a valid id, or no active row → 404 `group_not_found`;
    - header absent: one active row → that group; several → **400** `group_required`; none → 403 `no_group`;
    - device session: header absent or equal to `device_group_id` → device Actor; otherwise 404 `group_not_found`.
  - `ambiguous_group` is removed.

- [ ] **Step 1: Write failing tests** in `tests/identity/test_access.py` (reuse `stub_app`; add a `signed_in` stub route returning `current_user().id`):
  - `test_no_header_one_group_unchanged`: today's `test_level_matrix` still passes untouched.
  - `test_header_picks_group`: user in A (member) and B (admin); `X-Group: B` on the stub admin route → 200 with `group_id == B.id`; `X-Group: A` → 403 `forbidden`.
  - `test_two_groups_no_header_400`: → 400, `{"error": "group_required"}` (replaces `test_two_active_memberships_are_ambiguous`).
  - `test_header_not_member_404` and `test_header_inactive_row_404`: → 404 `group_not_found`.
  - `test_bad_header_values_404`: `"abc"`, `""`, `"99999999999"`, `"-1"` → 404, never 500 (use `utils.is_pg_int`).
  - `test_device_header_same_group_ok`, `test_device_header_other_group_404`.
  - `test_signed_in_no_group_ok`: user with no member rows → 200 on the `signed_in` stub.
  - `test_signed_in_refuses_device`: device session → 403; no session → 401.
- [ ] **Step 2:** run `.venv/bin/python -m pytest tests/identity/test_access.py -v` → FAIL.
- [ ] **Step 3:** implement in `identity/access.py`. `"signed_in"` joins `Level`/`LEVELS`; its wrapper skips `_resolve_actor()` and stores the `User` in `request.environ` under its own key (cleared per request, like `_ACTOR_KEY`).
- [ ] **Step 4:** access tests and the full suite pass.
- [ ] **Step 5: Commit** `Access: pick the group from X-Group; signed_in level`.

### Task 3: Setup gate, owner on setup, server commands

**Files:**
- Modify: `identity/accounts.py` (`admin_exists`, `more_than_one_admin`, `ensure_admin`, `log_setup_link_if_needed`), `identity/auth_routes.py` (`setup`, `setup_status`), `identity/cli.py`, `app.py` (register new commands)
- Test: `tests/identity/test_auth.py`, `tests/identity/test_setup_open.py`, `tests/identity/test_cli.py`

**Interfaces:**
- Produces in `identity/accounts.py`:
  - `setup_needed() -> bool`: no user with `is_owner` AND no group with `is_personal = false`. Replaces every use of `admin_exists()` (setup route, status route, start-up log); `admin_exists` is deleted.
  - `more_than_one_owner() -> bool` replaces `more_than_one_admin()` in the race check.
  - `ensure_admin(email, display_name)` also sets `user.is_owner = True`.
  - `find_user_by_ref(ref: str) -> User | None`: all digits → by id, else by normalized email.
- Produces CLI (`identity/cli.py`):
  - `flask create-admin <email|user-id> [--name]`: user id must exist (else exit 1 "No user with id N"); an email creates the user if missing. Sets `is_owner`. Only when **no non-personal group exists** does it also create the first group and an admin member row (today's `ensure_admin` path). Prints a sign-in link as today.
  - `flask remove-owner <email|user-id>`: clears `is_owner`; refuses (exit 1, "Can't remove the last owner") when it's the last.
  - `flask signin-link <email|user-id>`: prints a one-time sign-in link via `issue_signin_link`; changes nothing else; unknown → exit 1.

- [ ] **Step 1: Write failing tests:**
  - `test_setup_sets_owner` (`test_auth.py`): open setup → the new user has `is_owner`.
  - `test_setup_status_after_owner`: owner exists → `{"needed": false}`.
  - `test_setup_needed_false_with_group_but_no_owner`: a non-personal group, no owner → not needed (upgraded install with no admin user).
  - `test_setup_needed_ignores_personal_groups`: only a personal group exists → `setup_needed()` is True.
  - `test_race_counts_owners` (monkeypatch `more_than_one_owner` → True) → 409 `setup_done`, nothing committed.
  - `test_cli.py`: `test_create_admin_by_user_id_sets_owner_without_new_group`, `test_create_admin_unknown_id_exits_1`, `test_create_admin_empty_install_makes_first_group`, `test_remove_owner_refuses_last`, `test_remove_owner_ok_with_two`, `test_signin_link_prints_link_changes_nothing` (no member rows or flags change), `test_signin_link_unknown_exits_1`.
- [ ] **Step 2:** run the three test files → FAIL.
- [ ] **Step 3:** implement. Keep `test_create_admin_reuses_user_and_group` passing.
- [ ] **Step 4:** full suite passes.
- [ ] **Step 5: Commit** `Setup gate keyed on owner; owner on setup; remove-owner and signin-link commands`.

### Task 4: The app's address, relative redirect, `Secure` from the request

**Files:**
- Create: `identity/address.py`
- Modify: `identity/accounts.py:83` (`issue_signin_link`), `identity/accounts.py:182` (start-up setup link), `identity/auth_routes.py:86-111` (`consume`), `identity/sessions.py:40-42` (`secure_cookies`)
- Test: `tests/identity/test_address.py` (create), `tests/identity/test_auth.py`

**Interfaces:**
- Consumes: Task 1 `InstallSettings`.
- Produces: `app_address() -> str` in `identity/address.py`: `InstallSettings.public_url` read from the database on every call, else `current_app.config["BASE_URL"]`; no trailing slash. (Start-up logging runs outside a request: it keeps using `BASE_URL` if the table can't be read, logging nothing extra.)

- [ ] **Step 1: Write failing tests:**
  - `test_app_address_falls_back_to_base_url`; `test_app_address_uses_public_url` (set the row to `http://192.168.1.40:8000`).
  - `test_signin_link_uses_public_url`: `issue_signin_link` link starts with the `public_url`.
  - `test_consume_redirects_relative`: successful consume → `Location` is `/`; expired → `/signin?error=expired`. Neither contains a host.
  - `test_secure_cookie_follows_request`: `BASE_URL=https://x` but a plain-http request → session cookie has no `Secure`; `wsgi.url_scheme="https"` (or `X-Forwarded-Proto: https` with `PROXY_HOPS=1`) → `Secure`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement. `secure_cookies()` returns `request.is_secure`.
- [ ] **Step 4:** full suite passes (update existing redirect assertions that expected an absolute `BASE_URL`).
- [ ] **Step 5: Commit** `One address helper; relative sign-in redirect; Secure follows the request`.

### Task 5: Teams, personal spaces, owner routes, `/me`

**Files:**
- Create: `identity/groups_routes.py` (blueprint `groups_bp`, prefix `/api`), register in `app.py`
- Modify: `identity/auth_routes.py` (`me`, `_group_dict`), `identity/admin_routes.py` and `identity/device_routes.py` (personal-space 404s), `tasting/sample_data.py` callers in `admin_routes.py` (same)
- Test: `tests/identity/test_groups.py` (create), `tests/identity/test_auth.py`

**Interfaces:**
- Consumes: Task 2 `require("signed_in")`, `current_user()`; Task 3 `setup_needed()`; Task 4 `app_address()`.
- Produces routes:

| Route | Access | Behaviour |
|---|---|---|
| `POST /api/groups` `{name, timezone}` | `signed_in` + owner | 201 `{id, name, timezone, role: "admin", is_personal: false}`; creates the group and an admin member row for the owner (display name from the user). Not owner → 403 `forbidden`. Setup needed → 409 `setup_needed`. Name 1–120 chars, timezone valid (reuse the zoneinfo check from `admin_routes.py`) → else 400 with `field`. |
| `POST /api/groups/personal` | `signed_in` | 201 with the new group, or 200 with the existing one. `is_personal=true`, `personal_user_id=user.id`, name "My tastings", timezone of the user's first group or `UTC`; one admin member row. Concurrent second insert hits the unique index → return the existing group (catch `IntegrityError` in a nested transaction). Setup needed → 409. |
| `GET /api/install` | `signed_in` + owner | `{public_url, address}` (`address` = `app_address()`). |
| `PATCH /api/install` `{public_url}` | `signed_in` + owner | `null` clears; otherwise must parse as `http`/`https` with a host and no path, query or fragment → else 400 `{"error": ..., "field": "public_url"}`; stored without trailing slash. |
| `GET /api/install/groups` | `signed_in` + owner | `[{id, name, member_count}]` for non-personal groups, active members only. Nothing else about any group. |

- `/api/auth/me` keeps its own session handling (no `require`, since it also answers devices): adds `"is_owner"` to `user` and `"is_personal"` to each group; the device branch is unchanged.
- In a personal space, these return 404 `not_found`: every `/api/group/members*` route, `/api/group/device-codes*`, `/api/group/sample-data`, and `POST /api/device/enter` for codes of a personal group (none can exist, but guard it).

- [ ] **Step 1: Write failing tests** in `tests/identity/test_groups.py`:
  - `test_owner_makes_team_and_is_admin`; `test_non_owner_cannot_make_team_403`; `test_make_team_refused_while_setup_needed_409`; `test_make_team_validates_name_and_timezone`.
  - `test_personal_space_created_once` (second call 200, same id); `test_personal_space_refused_while_setup_needed`; `test_personal_space_works_with_no_groups`.
  - `test_personal_space_has_no_roster_or_codes`: with `X-Group: <personal>` → 404 on `GET /api/group/members`, `POST /api/group/device-codes`, `POST /api/group/sample-data`.
  - `test_owner_routes_refuse_non_owner_403` and `test_owner_routes_refuse_device_403`.
  - `test_install_groups_lists_names_and_counts_only`: response keys exactly `{"id","name","member_count"}`; personal groups absent.
  - `test_owner_without_membership_gets_404_inside_group`: owner, not a member of B, `X-Group: B` on `GET /api/group` → 404.
  - `test_patch_install_rejects_bad_urls`: `"ftp://x"`, `"http://"`, `"http://x/path"`, `"http://x?q=1"` → 400; `"http://192.168.1.40:8000/"` → stored as `http://192.168.1.40:8000`.
  - `test_me_reports_owner_and_personal` (in `test_auth.py`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** full suite passes.
- [ ] **Step 5: Commit** `Teams, personal spaces, owner install routes`.

### Task 6: Cross-group sweep

**Files:**
- Create: `tests/test_cross_group.py`
- Modify: any route the sweep shows filtering by id without `actor.group_id` (expected: none; fix in place if found)

**Interfaces:**
- Consumes: Tasks 2 and 5.

Build two groups. Group B gets: a coffee, an open blind advanced flight with two coffees and one tasting, a closed flight with a tasting, a member, a device code. User U is an **admin of A** and an **admin of B**; a second user V is admin of A only. A device session is bound to A.

- [ ] **Step 1: Write the sweep:**
  - Enumerate `app.url_map` rules under `/api/tasting`, `/api/group`, `/api/device` with at least one `<int:...>` argument. Fill each argument with the matching id from **B** (map by argument name: `flight_id`, `coffee_id`, `member_id`, `code_id`, `tasting_id`; an unknown name fails the test with the rule printed, so new routes can't slip past).
  - For every method on the rule (skip `HEAD`/`OPTIONS`): call as V with `X-Group: A`, as U with `X-Group: A`, and as the device → status must be **404** (never 2xx, never 403). Send `{}` JSON with CSRF for writes.
  - `test_sweep_covers_routes`: the enumerated list is non-empty and includes the label-key, reveal and tasting-entry routes by endpoint name.
  - `test_blind_open_flight_from_other_group`: U with `X-Group: A` asks for B's open blind flight's summary and label key → 404, and the body contains no coffee name from B.
- [ ] **Step 2:** run `.venv/bin/python -m pytest tests/test_cross_group.py -v`. Any non-404 is a real leak: fix the route by adding the `actor.group_id` filter, with a focused regression test beside the route's existing tests.
- [ ] **Step 3:** full suite passes on SQLite and Postgres.
- [ ] **Step 4: Commit** `Cross-group sweep over every id route`.

### Task 7: Docs

**Files:** Modify `README.md` (server commands; "Groups and the owner" section), `CLAUDE.md` (Rules: group comes from `X-Group` via `_resolve_actor`; wrong group is 404; `signed_in` never accepts devices), `docs/spec.md` only if it states "one group per install" (point to the new spec).

- [ ] **Step 1:** README lists `create-admin`, `remove-owner`, `signin-link` with one line each, and says header-less API clients keep working on single-group installs.
- [ ] **Step 2:** `.venv/bin/python -m pytest -q` passes (name scan included).
- [ ] **Step 3: Commit** `Docs: owner, groups, server commands`.

## Ship Checklist

- [ ] Migration: `0007` — runs on start via `start.sh`. Check a fresh SQLite install, a copy of a real 0006 database (owner backfilled, admin still signs in with no header), and Postgres.
- [ ] Env vars: none new.
- [ ] Third-party config: none.
- [ ] Smoke (local, browser, unchanged frontend): start on an upgraded 0006 database → sign in as the admin → coffees, a blind flight, reveal and palate all work exactly as before (no `X-Group` sent). Then `curl` with the session cookie: `POST /api/groups/personal` → 201; `GET /api/auth/me` → two groups; any `/api/tasting/...` call with no header → 400 `group_required`. **Expected:** the 1a frontend breaks for users with two groups until 1b ships, so don't make personal spaces on a real install until 1b is merged.
- [ ] Docs: README and CLAUDE.md (Task 7); update memory `project-status.md` with phase 1a status.
