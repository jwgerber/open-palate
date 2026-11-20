# Multi-group access and getting in: design

Date: 2026-11-20 · Status: draft for owner approval · Tier: Full (auth, permissions, migrations)

Mockups: the "Getting in" row (screens A–F) of the Open Palate Wine design canvas
(claude.ai/artifact/Hxdt2PrjHJ137xSnXoQZTu). They show intent, not exact copy or layout.

## Why

Open Palate is self-hosted: one person installs it on a web host or a box at the shop, and
everyone else uses it from their phone. Today an install holds exactly one group, so a person
can't be in a coffee team and a wine team, a restaurant can't run a managers' group beside
its floor team, and nobody can taste alone. Getting people in still leans on email or on an
admin copying sign-in links one at a time, and phones on shop Wi-Fi need an address like
`http://192.168.1.40:8000` that nobody can type.

This is the foundation for wine: wine is built after this ships, as its own spec.

## Goals

1. **Many groups per install.** A person can belong to several groups, switch between them,
   and act in exactly one group per request.
2. **An owner** (the installer) runs install-wide settings and decides who may start teams.
3. **Anyone can make a personal space** for solo tasting.
4. **Joining without email.** A group link or QR code lets people straight in; a personal
   invite signs one roster person in; a signed-in phone can sign in another phone.
5. **A first-run wizard** in the browser that ends with a QR code the team can scan.
6. **Existing installs keep working** with no action: today's group becomes the first group
   and its earliest admin becomes the owner.

## Non-goals

- Wine, and the install's "what do you taste" setting. The wine spec adds the drink to the
  wizard and to groups; this spec leaves a slot for it in the wizard (between "who are you"
  and "first group").
- A hosted service, sign-ups from the internet, billing, or anything run by the author.
- Passwords or passkeys. (Passkeys may come later on HTTPS installs; nothing here blocks them.)
- Moving a person or data between groups, merging groups, deleting groups.
- Email settings in the app. SMTP stays in server configuration, as today.

## Anti-goals (a failure even if it works)

- **Any cross-group leak**: a request acting in group A reads or writes anything of group B,
  by any route, header, link or id. The blind and no-leak invariants hold per group.
- A score lands in a different group than the screen it was entered on.
- The owner can see inside a group they don't belong to (names and counts only).
- A join link, invite, hand-off code or setup password appears in a log, in a response other
  than the one that issues it, or in browser storage.
- An existing install loses access, data, or a working sign-in after upgrading.

## Approaches considered

Every route already gets its group from one place (`_resolve_actor()` → `actor.group_id`,
about 90 uses across 50 routes). The choice was how a request names its group:

1. **Group sent with each request** (`X-Group` header, group in frontend URLs). **Chosen.**
   No route rewrites; each tab or phone can be in a different group; missing header with one
   group still works.
2. **Group in every API path** (`/api/g/:gid/...`). Equally safe, but rewrites all 50 routes and
   every frontend call for the same single membership check.
3. **Current group stored on the session.** Smallest change, rejected: all tabs share a session,
   so a second tab switched to another group would silently send scores to the wrong group.

## Decided

### How a request picks its group (approach 1)

- Frontend URLs carry the group: `/g/:groupId/...`. The API client sends `X-Group: <id>` on
  every request made from a group screen.
- `identity/access.py::_resolve_actor()` stays the single choke point. For a user session it
  loads the active member row for `(session.user_id, X-Group)`:
  - header present, member row found → Actor for that group;
  - header present, no active member row → **404** `group_not_found` (never 403: don't confirm
    the group exists);
  - header absent, exactly one active member row → that group (keeps today's clients and
    tests working);
  - header absent, several → **400** `group_required`; none → 403 `no_group` (unchanged).
- Device sessions are bound to `device_group_id`. A header naming a different group → 404.
- Routes keep reading `actor.group_id`; they change only where they don't yet filter by it.
- Old flight links (`/f/:id`) keep working: the server finds the flight's group and redirects
  to `/g/:gid/f/:id` only when the caller is an active member of its group (or, for a device,
  the flight is in its group); otherwise the same 404 as today. *(Builder call: `is_open_link`
  is a column with no routes today, so it plays no part.)*
- `/api/auth/me` returns every active group of the caller (id, name, role, is_personal) plus
  `is_owner`.

### Owner

- `users.is_owner` boolean. More than one owner is allowed; the last owner can't be demoted.
- Owner abilities: install settings; list every non-personal group by name and member count;
  start a team whatever the policy. Being owner gives **no** access inside any group.
- `flask create-admin <email>` becomes the owner-recovery command: it makes that user an owner
  (and admin of the first group, as today) and prints a sign-in link.
- *(My call)* Granting and removing ownership is server-side only in this spec:
  `flask create-admin` grants, a new `flask remove-owner <email>` removes (refused for the last
  owner). No owner-management screen, so the owner never needs a list of people.

### Install settings

One-row table `install_settings`:
- `team_creation`: `'anyone'` (default) or `'owner'`.
- `public_url`: nullable. When set, every link and QR code the app makes uses it; when unset,
  `BASE_URL` (unchanged behaviour). Owner-editable; must be an `http(s)` origin with no path.

### Groups

- `POST /api/groups` `{name, timezone}`: allowed for an owner, or anyone signed in when
  `team_creation = 'anyone'`. Creator becomes the group's admin.
- `POST /api/groups/personal`: one personal space per user (second call returns the existing
  one). `is_personal = true`. A personal space has one member (its user, role admin) and no
  roster screen, group link, invites or tablet codes; those routes return 404 there.
- Group roles (admin, editor, member) are per group, as today, including "can't remove the
  last active admin".

### Joining and signing in

- **Group link** (`invites`, kind `group`): one active link per group; admins turn it on/off
  and make a new one (the old one stops working). Opening `/join/<token>` shows the group's
  name and size. No expiry; revocable. The joiner either:
  - **types a display name**: creates a user with **no email**, an active `member` row with
    `joined_via = 'link'`, and a user session; or
  - **picks "I'm on the list"** and taps their name from the group's active roster entries
    that have no account (names only, nothing else about them). That entry is linked to a new
    user (no email) and keeps its history; it gets `joined_via = 'claimed'` and a timestamp.
    *(Decided by owner, 2026-11-20.)*
- **Undoing a claim**: on a `claimed` entry an admin can **Unlink**, which detaches the user
  from that entry (the entry and its history stay; that user's sessions end). The
  claimed-by-link history is recorded on the member row so the flag shows until reviewed.
- **Personal invite** (`invites`, kind `member`): for one roster entry, single-use, 7 days.
  Opening it signs that roster entry in, creating its user if it has none. Replaces today's
  "copy sign-in link" for members without an account.
- **Admin-made sign-in links for people with accounts** (the existing 24-hour link, and
  personal invites for a linked entry) are allowed **only when that person's only active
  group is this one**; otherwise refused with `other_group`, as today. People in several
  groups recover with another phone's hand-off QR, their email, or the owner's server
  command. *(Decided by owner, 2026-11-20.)*
- **Already signed in on that phone**: opening either kind offers "Join as <name>" and adds a
  member row for the current user instead of making a new account. A personal invite whose
  roster entry is already linked to another user is refused.
- **Another phone**: a signed-in user makes a hand-off code (`login_tokens` purpose
  `handoff`, 5 minutes, single use) shown as a QR; scanning it starts a session for the same
  user. Users can list and sign out their other sessions.
- **Email** becomes optional: `users.email` nullable (still unique when set). Email sign-in
  works exactly as today for users who have one, when SMTP is configured.
- The roster shows "Joined by link · <when>" on `joined_via = 'link'` members, with Remove
  (deactivate) beside it, and "Claimed by link · <when>" on `claimed` entries, with Unlink.
- Tablet codes are unchanged.

### First-run wizard (`/setup`)

Steps: claim → who are you (name, optional email) → [wine spec: drink] → first group (name,
timezone pre-filled from the browser) → sample data (optional) → "Get your team in" (the
group link as a QR code, copy link, print a join card).

- **Claiming** keeps today's guard exactly (setup token from the log, `SETUP_PASSWORD`, or
  "open" per the 2026-11-18 easy-setup rules, including "never open in a container"). The
  claim screen says which applies: "you're on this network" only when open; otherwise the
  password field, with where to find it.
- `render.yaml` and `render.free.yaml` generate `SETUP_PASSWORD` (`generateValue: true`), so a
  Render installer finds it under Environment.
- **The address**: when the wizard is loaded from `localhost`/`127.0.0.1`, the server suggests
  its LAN address (the interface a UDP socket to a non-routable address would use; nothing is
  sent) and the "get your team in" step asks the owner to confirm it into `public_url`.
- Finishing creates the owner (`is_owner`), the first group, its admin member row, the group
  link, and optionally sample data, in one transaction.

### Migration from one group

One Alembic revision for phase 1 (more for phases 2–3 as needed):
- `users.is_owner`; backfill the earliest-created admin member's user of the first
  non-personal group (by `groups.id`) as owner.
- `install_settings` with its one row (`team_creation = 'anyone'`, `public_url = NULL`).
- No change to groups, members or tasting tables: existing rows are already group-scoped.

## Phases (each ships on its own, each its own plan)

1. **Multi-group core**: `X-Group` resolution, owner, install settings API and screen,
   starting teams and personal spaces, group switcher, `/g/:gid` frontend routes, `/f/:id`
   redirect, migration. Cross-group test sweep.
2. **Joining and sign-in**: `invites` table, group link and personal invites, join screens,
   hand-off QR, session list, nullable email, joined-by-link flag.
3. **First-run wizard**: wizard screens, LAN address suggestion, `public_url`, Render
   `SETUP_PASSWORD`, README updates.

## Constraints

- Flask/SQLAlchemy/Alembic, SQLite and Postgres both (CI runs both). React 19 + MUI 7.
  QR codes with the existing `qrcode.react` dependency; no new dependencies expected.
- Device checks branch on `actor.kind`, never on `user_id`.
- Gunicorn/werkzeug logs never record query strings or `/join/<token>` paths; extend
  `identity/log_redact.py` to cover the join path.
- Join and hand-off endpoints are rate-limited like the other public auth routes.
- Tokens are stored as sha256 only (`identity/tokens.py`).

## Testing that must exist

- A parametrized sweep over every route: acting in group A with a resource of group B →
  404, for user and device sessions, open and closed flights.
- Header rules: missing/one group, missing/several, wrong group, device mismatch.
- Owner sees group names and counts only; owner without membership gets 404 inside a group.
- Upgrade test: a database at today's head migrates and its admin can still sign in and
  taste; the earliest admin is owner.
- Join flows: group link on/off/rotated, personal invite single-use and expiry, "join as"
  when signed in, hand-off expiry and single use, tokens absent from logs.
- Claiming: only unlinked active entries are offered; a claimed entry can't be claimed again;
  Unlink ends that user's sessions and keeps the history.
- Recovery links: refused with `other_group` for a person in two groups, allowed for one.

## Left to the builder

- Table and column names beyond those stated, endpoint paths beyond those stated, and
  response shapes, following the existing route style.
- How the frontend stores the last-used group (per device, not security-relevant).
- Print layout of the join card.
- Whether phase 2 needs one migration or two.
