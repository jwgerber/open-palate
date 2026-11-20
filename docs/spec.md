# Tasting open-source fork — design

Date: 2026-11-18. Status: draft, pending owner approval. Builder check done.

## Intent

Release the original app's Tasting module as a standalone, open-source app. Two uses:

1. **A café runs its own copy** for its staff.
2. **A free hosted service for cuppers**, where a café's team has a private group
   and anyone can host an *open flight* shared by link.

This is a **one-time fork**: the new repo starts from a copy of today's Tasting code;
The original app keeps its own Tasting unchanged and the two drift apart. Nothing is
synced back.

## Goals

- One codebase serves both uses. A self-hosted café is simply one group.
- Keep what makes Tasting worth using, unchanged in behaviour:
  - blind is blind on the wire, host included, until close;
  - nobody sees anyone's scores until the flight closes (reveal 409s while open);
  - shared flights close by host or lazily after 24h (48h for CSV-uploaded flights);
  - coffee consensus and per-person reads need `CONSENSUS_THRESHOLD = 3`;
  - one person = one read per cup, across every way they can log in;
  - coffees are archived, never deleted; a tasting is deleted as one person's
    sitting.
- A café installs with one container and no database to manage.
- Guests join an open flight by typing a name; an account is optional and only
  adds a palate history.

## Non-goals

- Syncing with the original app in either direction, or migrating the original app's tasting history.
  (A café can bring its coffee list across with the existing coffee CSV export →
  import.)
- Fetco Settings (stays in the original app).
- The original app's schedule-based taster picking (`shift_identity`, `/kiosk/on-shift`).
- Payments, paid tiers, native apps.

## Anti-goals (failure even if it works)

- Any scores, tags or coffee identities leaking before close, through any route,
  for any kind of user (member, guest, shared device, host).
- Data from one group visible to another group.
- Shipping the flavor wheel or the Advanced form's layout publicly before the owner
  has permission (see Licensing).
- The original app's branding, data, the shop's names, or the original app's git history in the
  new repo.

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| **A** | Keep Flask + SQLAlchemy + React/MUI; own login; one Docker image serving API + built frontend; SQLite default, Postgres supported | Carries over ~4.4k backend, ~15k frontend, ~5.6k test lines. Login is new code we own | **Chosen** |
| B | Keep Supabase for auth + DB | Least auth code, easy hosted service; but every self-hosting café needs a Supabase project or Supabase's big self-host stack | Rejected: fights "cafés run it themselves" |
| C | Rewrite in TypeScript (e.g. Next.js) | Friendlier to contributors; throws away tested code and hard-won rules | Rejected: a rebuild, not a fork |

## What gets replaced (the original app's seams)

| Original app today | Fork |
|---|---|
| `payroll.models.Employee` | `Member` (per group roster row) |
| `models.Store`, `tasting_coffee_stores` | `Group`; the store tag on coffees is dropped |
| Supabase JWT, `auth.py`, `permissions/` keys | Own session auth + group roles (below) |
| `shift_identity` (pick a taster from published shifts) | Shared-device mode picks from the group's active members |
| `utils.utc_to_eastern` / `STORE_TZ` | Per-group IANA timezone (`Group.timezone`) |
| `documents.extract` model constants | A local `scan_models` setting |
| `search_registry.py` ⌘K entry, `AppSidebar`, the original app's layout | Dropped; the fork has its own small shell |
| `fetco/repository.py` → `TastingCoffee` | Nothing (Fetco not forked) |

## Data model

Every tasting table gains `group_id` (FK `groups.id`, NOT NULL) except rows that
hang off a flight, which inherit the flight's group. Every query is scoped by
group in the repository layer, never by the caller remembering to.

New tables (exact shape is the decision):

```
users            id, email (unique, lower-cased), display_name, created_at, last_login_at
groups           id, name, timezone (IANA, default 'UTC'), is_personal (bool), created_at
members          id, group_id, display_name, email (nullable), user_id (nullable → users),
                 role ('admin'|'editor'|'member'), active (bool), created_at
                 -- one row = one person in one group, with their role. Staff without an
                 -- account are members with user_id NULL; unique (group_id, user_id)
login_tokens     id, user_id, token_hash, expires_at, used_at          -- email sign-in links
sessions         id, user_id NULL, device_group_id NULL, token_hash, kind ('user'|'device'),
                 created_at, last_seen_at, expires_at, revoked_at
device_codes     id, group_id, code_hash, created_by, expires_at, revoked_at
flight_links     id, flight_id, token_hash, created_at, revoked_at     -- open-flight links
```

Changes to existing tables:

- `TastingFlight`: `store_id` → `group_id`; `host_employee_id` → `host_member_id`;
  `host_user_id` → nullable FK `users.id` (NULL when a shared device hosts). New `is_open_link` (bool): an open flight
  joinable by link.
- `Tasting`: `employee_id` → `member_id`; `user_id` → FK `users.id`. The partial
  unique index on `(flight, coffee, employee_id)` becomes `(flight, coffee,
  member_id) WHERE member_id IS NOT NULL` plus `(flight, coffee, user_id) WHERE
  user_id IS NOT NULL`. `taster_key` forms: `user:<id>`, `member:<id>`,
  `guest:<random>`, `paper:member:<id>`, `paper:name:<name>`.
- `TastingCoffee`: `group_id`; `created_by` → FK `users.id`.
- **Rename the two forms.** `sheet` values `quick` → `basic`, the publisher-named sheet → `advanced`;
  columns take the `adv_` prefix (`adv_*`, `adv_step`, `adv_pass`).
  No cupping-sheet publisher's name or branding anywhere: code, UI, printed sheets, CSV
  headers, docs.

Migrations: a fresh Alembic chain that builds from empty (unlike the original app's
`create_all()` baseline). Tests run on SQLite and Postgres.

**One person = one read per cup** (builder's call made explicit): every write
stamps both `member_id` and `user_id` when known. A signed-in user logging in a
group gets `member_id` from their member row in that group; a device picking a
member gets `user_id` from that member's `user_id`. Both partial unique indexes
then catch the device-plus-phone double read.

**Linking a roster member to an account:** an admin puts an email on the member
row (Phase 1). The first time that email signs in, `members.user_id` is set.
Their earlier device reads join their palate, because the palate is read
through member rows as well as `user_id`.

**Personal groups** exist only where sign-up is open (`ALLOW_SIGNUP=true`, the
hosted service): every new account gets one (`is_personal`), so a solo cupper
with no café can still host and keep coffees. On a self-hosted install with
sign-up off there are no personal groups; Phase 1 has one group and every route
uses it.

## Identity and access

Four ways in:

1. **Account (email sign-in link).** `POST /auth/request-link` emails a single-use
   link (15 min). Opening it creates a `user` session (httpOnly, `Secure`,
   `SameSite=Lax` cookie, 30-day rolling). CSRF: double-submit token on every
   non-GET.
2. **Shared device.** A group admin creates a device code; a tablet enters it
   once and gets a `device` session for that group (no user). Tasters pick
   their name from the group's active members. Replaces the original app's store iPad /
   `tasting.kiosk`. A device can never see a palate, a label key, or host-only
   screens.
3. **Guest on an open flight.** Opening a flight link and typing a name gives a
   guest cookie scoped to that flight (`guest:<random>`); the same browser can
   resume. A guest name must be unique within the flight (case-insensitive,
   409 `name_taken`). Guests see only that flight, its reveal after close, and
   nothing else.
4. **Signed-in user on an open flight.** Same link; the read is stored under
   their `user:<id>` and counts toward their palate.

Group roles replace the original app's permission keys:

| Original app key | Fork |
|---|---|
| `tasting.view`, `tasting.edit` | any member of the group (user or device session) |
| `tasting.self` | a user session (a person) |
| `tasting.kiosk` | a device session |
| `tasting.manage` (edit/archive coffees, CSV import/export, others' reads) | group `editor` or `admin` |
| `tasting.close_any` | group `admin` |
| — | group `admin`: members, roles, device codes, group settings |

The **host** of a flight keeps today's host powers (close, edit cups, timer,
label key on the account door only) regardless of role. On an open flight the
host may also remove a guest's read and revoke the link.

**Who can host** (my call): a user session or a shared device. On a device the
host is the member picked (`host_member_id`, `host_user_id` NULL); host powers
then belong to that member on any device of the group, or to their account if
linked. This keeps solo logs, café cuppings and paper entry working on the
tablet with no email at all. Paper entry and scan: the host (either door) or a
group editor/admin. **An open-link flight needs an account host**, since a
public link must have someone who can close it and revoke the link from their
own phone.

**Outsiders on an open flight** (owner decision): guests, and signed-in users
who are not members of the host's group, see their own scores and that flight's
reveal and summary like anyone in it. Their reads **never** count toward the host
group's coffee consensus, averages, shared terms or coffee-page sessions; those
read only reads by the group's own members. An outsider's palate lists the
coffee names and their own scores from flights they joined, never the group's
averages or anyone else's read.

**`request-link` for an unknown email**, or a known email with sign-up off and
no member row: answers the same "check your email" and sends nothing (no
account enumeration).

## Content as data (licensing)

- The flavor lexicon (`tasting/lexicon.py` TREE + enums) and both form
  definitions (Basic scales; Advanced categories, scale steps, D/Q and vote
  rules) move to data files under `content/` (JSON), loaded at startup and
  served to the frontend from one endpoint. The Python → JS generator and its
  drift test are replaced by that endpoint plus a schema test on the files.
- Today's content is the 2020 flavor wheel credited in the README (adopted
  word for word on 2026-11-20, see `docs/specs/2026-11-20-2020-wheel-design.md`)
  and the Advanced form. **The repo stays private until the owner hears back**
  from the wheel's publisher and the cupping-sheet publisher. With a yes, it goes public as-is. With a no on the
  lexicon, that file is replaced with original content and nothing else
  changes.
- **The Advanced form keeps fixed columns** (owner decision): ten `adv_*` score
  columns, 7.0 = D/Q, 7.5–10, required bar vote, as today. The content file
  carries its labels and wording only. A no from the cupping-sheet publisher therefore means
  a migration plus code changes to scoring, entry, print and scan, accepted as
  the cost of a much smaller port now.

## License

**AGPL-3.0** (owner decision), so anyone hosting a modified version must
publish their changes. The app's name is still to be chosen by the owner
before the repo is created.

## Optional features

- **Paper-sheet scan**: ships, off unless `ANTHROPIC_API_KEY` is set. Photos are
  never stored or logged (unchanged rule). Off on the hosted service at launch.
- **Printing** (sheets, label key, front page): ships unchanged except the rename.
- **Email**: needed only for accounts. A self-hosted café with no SMTP still
  works: the first admin is created by `flask create-admin <email>` which prints
  a one-time sign-in link to the console, and staff use the shared device.

## Deployment

- One Docker image: Flask (gunicorn) serves `/api/*` and the built Vite frontend.
- `DATABASE_URL` unset → SQLite at `/data/tasting.db` (mount a volume).
  Set → Postgres.
- Env: `SECRET_KEY` (required), `BASE_URL`, `SMTP_*` (optional),
  `ANTHROPIC_API_KEY` (optional), `ALLOW_SIGNUP` (default false for self-host:
  only admins invite).
- Migrations run on container start.
- Hosted service: same image on Render with Postgres, `ALLOW_SIGNUP=true`,
  rate limits on `request-link`, guest joins and flight creation.

## Self-hosting

Who it's for: a café with someone comfortable following a README. Cafés without
one are expected to use the hosted service (Phase 3).

**Setup a café follows** (the README walks through exactly this):

1. Pick a host with HTTPS: Render / Fly.io / Railway, or a box in the shop
   behind Caddy or a Cloudflare Tunnel. HTTPS is required (Secure cookies, QR
   links opened on phones).
2. Run the image with a volume on `/data`, `SECRET_KEY` and `BASE_URL`.
3. Create the first admin (below), sign in, set the group name and time zone,
   add staff, make a device code.
4. On the shop iPad: open the URL, enter the device code, Add to Home Screen.
5. Optional: `SMTP_*` (staff sign in on their own phones), `ANTHROPIC_API_KEY`
   (scan).

**First admin without a shell** (my call): on start, if the install has no
admin, the app logs a one-time setup link (15 min, regenerated each start until
an admin exists). This works on hosts where the only access is the log viewer.
`flask create-admin <email>` stays for people with a shell.

**Behind a proxy** (my call): every absolute link (sign-in emails, flight QR
codes, setup link) is built from `BASE_URL`, never from the request's host or
scheme, so a proxy that terminates HTTPS can't produce `http://` links. Client
IP for rate limits comes from `X-Forwarded-For` via Werkzeug's `ProxyFix`, with
`PROXY_HOPS` (default 1, as every supported host has one proxy; 0 when exposed
directly). The `Secure` cookie flag follows `BASE_URL`'s scheme, so
`http://localhost` development still works.

**Backups**:
- SQLite: `flask backup [dir]` writes a consistent copy with SQLite's online
  backup API (safe while the app runs) to `/data/backups/tasting-<date>.db` and
  keeps the newest 14. The README gives a host cron line that runs it nightly
  via `docker exec`, and says to copy `/data/backups` off the machine. The app
  does not schedule backups itself (nothing unattended in-process).
- Postgres: the database host's own backups; the README says so.
- Restore: stop the container, put the backup at `/data/tasting.db`, start.

**One-click Render deploy** (revised 2026-11-20, see
`docs/specs/2026-11-20-render-trial-access-design.md`): the "Deploy to Render"
button in the README deploys `render.yaml`, a free trial: one web service built
from the Dockerfile plus a free Render Postgres database, `SECRET_KEY` and
`SETUP_PASSWORD` generated, `BASE_URL` taken from Render's `RENDER_EXTERNAL_URL`,
health check `/healthz`. `render.paid.yaml` is the real deployment: the published
image, a 1 GB disk on `/data` (needs a paid instance; the README states the cost),
`SECRET_KEY` generated, `BASE_URL` prompted.

**Image and updates**: published to GitHub Container Registry with a version
tag and `latest`. Update = pull and restart; migrations run on start. The
README tells people to take a backup first and to pin a version tag if they
want to choose when they update.

**`/healthz`**: returns 200 when the app can reach its database; no auth, no
data.

## Phasing

Each phase ships on its own.

1. **Café self-host.** New repo; strip the original app's seams; groups/members/roles; email
   sign-in + `create-admin` + logged setup link; shared device; Basic/Advanced
   rename; content files; SQLite + Postgres; Docker image on GHCR; proxy
   handling; `flask backup`; `/healthz`; `render.yaml` + Deploy button; README
   with the self-hosting walkthrough. One group per install is enough to ship,
   but the data model is already multi-group.
2. **Open flights and many groups.** Flight links, guests, a person in several
   groups, group switcher, personal palate across groups, invite by email.
3. **Hosted service.** Sign-up, rate limits, terms + privacy page, data export
   and account deletion, Render deploy.

## Left to the builder

- Frontend shell and routing (keep `/f/<id>`-style links working for open flights).
- Exact session/CSRF library choice (or hand-rolled, kept small).
- How tests are ported (carry over the original app's tasting tests, rewrite identity
  fixtures to the new model).
- Which of the original app's frontend helpers are copied vs. rewritten (`apiError`,
  `ConfirmDialog`, `storeTime`).
