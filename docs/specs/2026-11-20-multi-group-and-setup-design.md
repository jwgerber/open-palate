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
- `identity/access.py::_resolve_actor()` stays the single choke point for group routes. For a
  user session it loads the **active** member row for `(session.user_id, X-Group)`:
  - header present, member row found → Actor for that group;
  - header present, no active member row → **404** `group_not_found` (never 403: don't confirm
    the group exists);
  - header absent, exactly one active member row → that group (keeps today's clients and
    tests working);
  - header absent, several → **400** `group_required` (replaces today's 403
    `ambiguous_group`; 1b updates the frontend and tests that know the old code); none → 403
    `no_group` (unchanged).
- Device sessions are bound to `device_group_id`. A header naming a different group → 404.
- Routes keep reading `actor.group_id`; they change only where they don't yet filter by it.
- **Group-less routes use a new access level `signed_in`**: a user session only (never a
  device, so a tablet's member pick can never pass it), read from the session, with no group
  resolved and no Actor built. Used by: start a team, make a personal space, `/api/auth/me`,
  owner routes (install settings, group listing), making a hand-off code, and the session
  list / sign-out. Owner routes additionally check `users.is_owner` on the session's user.
- Old flight links: `/f/:id` is a frontend route, so 1b adds an API lookup
  (`GET /api/flights/:id/group`, `signed_in` or device) returning the flight's group id when
  the caller is an active member of it (or, for a device, the flight is in its group). Every
  other case, including a missing flight, gets the same 404. The frontend then redirects to
  `/g/:gid/f/:id`. *(`is_open_link` has no routes today and plays no part.)*
- `/api/auth/me` returns every active group of the caller (id, name, role, is_personal) plus
  `is_owner`.

### Owner

- `users.is_owner` boolean. More than one owner is allowed; the last owner can't be removed.
- Owner abilities: install settings; list every non-personal group by name and member count;
  start a team whatever the policy. Being owner gives **no** access inside any group.
- Server commands (whoever runs the server is trusted with the database anyway):
  - `flask create-admin <email | user-id>`: grants owner. With an email and no such user it
    creates one; it no longer forces admin of any group except during first setup on an
    empty install (no group yet), where it also creates the first group as today.
  - `flask remove-owner <email | user-id>`: refused for the last owner.
  - `flask signin-link <email | user-id>`: prints a one-time sign-in link and changes nothing
    else. **This is the recovery path for anyone in several groups**, including link-joined
    users with no email. *(Decided by owner, 2026-11-20.)*
- No owner-management screen, so the owner never needs a list of people.

### Setup gate and the owner across phases (lands in 1a)

- "Setup needed" becomes: **no owner exists and no non-personal group exists**. This replaces
  `admin_exists()` in the setup route, `/api/auth/setup-status` and the start-up setup-link
  log. The race check after creating counts owners, not admins.
- From 1a on, today's setup route and `ensure_admin` set `is_owner` on the first admin, so no
  install is ever created without an owner between 1a and phase 3.
- `POST /api/groups/personal` and `POST /api/groups` are refused (409 `setup_needed`) while
  setup is needed, so nothing created before setup can close the gate.

### Install settings

One-row table `install_settings`, read on every request (never cached per worker; Postgres
runs two):
- `team_creation`: `'verified'` (default) or `'owner'`. See "Who may start a team".
- `public_url`: nullable. Owner-editable; must be an `http(s)` origin with no path.
- **One helper decides the app's address** for anything sent off-device: `public_url` when
  set, else `BASE_URL`. Used for every link, invite and QR code (always built on the server,
  never from the browser's `window.location`) and the start-up setup link.
- **Redirects are relative**: `consume()` redirects to `/`, not an absolute URL, so the cookie
  set on whatever host the link was opened on is kept.
- **`Secure` cookies follow the request** (`request.is_secure`, with the existing ProxyFix),
  not `BASE_URL` or `public_url`, so phones on plain-http Wi-Fi keep their cookie even when an
  https address is also configured.

### Who may start a team *(Decided by owner, 2026-11-20)*

- `'verified'` (default): the owner, and any user whose email has been **verified** by
  signing in through an emailed link. Users who joined only by group link (no email) can't
  start teams; a photographed link must never work as open sign-up. They can still make a
  personal space.
- `'owner'`: the owner only.
- `ALLOW_SIGNUP` on forces `'owner'` whatever is stored; the settings screen says why.
- `users.email_verified_at` records the first successful emailed-link sign-in. Existing users
  with an email are backfilled as verified (they could only sign in by emailed link before).

### Groups

- `POST /api/groups` `{name, timezone}` (`signed_in`): allowed per "Who may start a team".
  Creator becomes the group's admin.
- `POST /api/groups/personal` (`signed_in`): one personal space per user, enforced by a
  partial unique index (one personal group per creating user), not by "find then insert"; a
  second call returns the existing one. A personal space has one member (its user, role
  admin) and no roster screen, group link, invites or tablet codes; those routes return 404.
- Group roles (admin, editor, member) are per group, as today, including "can't remove the
  last active admin".
- **No groups yet**: a signed-in user with no active group sees "You're not in a group yet"
  with "Make a personal space" and, when allowed, "Start a team", instead of the `no_group`
  error. It uses only `signed_in` routes.
- **Counting groups** (for the recovery rule, auto-linking and "only group"): a person's
  groups are their **active** member rows in any group, **personal spaces included**.

### Joining and signing in

Tokens never appear in a URL path. Join and invite links carry the token in the **fragment**
(`/join#<token>`, `/invite#<token>`, `/handoff#<token>`), which browsers don't send to the
server; the SPA reads it and redeems it with a POST body. No GET API route contains a token.

- **Group link** (`invites`, kind `group`): one active link per group; admins turn it on/off
  and make a new one (the old one stops working). Opening it shows the group's name and size.
  No expiry; revocable. *(Accepted trade-off: anyone holding the link can make accounts in the
  group until an admin turns it off or makes a new one; rate limits slow this and the roster
  flag shows it. Speed of joining was chosen over admin approval.)* The joiner either:
  - **types a display name**: creates a user with **no email**, an active `member` row with
    `joined_via = 'link'`, and a user session; or
  - **picks "I'm on the list"** and taps their name from entries that are `active`, role
    `member`, `is_sample = false`, with **no account and no email** (names only). That entry is
    linked to a new user (no email) and keeps its history; it gets `joined_via = 'claimed'` and
    a timestamp. Admin and editor entries are never offered. *(Decided by owner, 2026-11-20.)*
    Entries with an email are never offered: they join by email sign-in, which proves who they
    are.
  - Accepted: anyone with the group link sees the names of unclaimed, email-less member
    entries. The link is meant for staff.
- **Personal invite** (`invites`, kind `member`): for one roster entry with **no email**,
  role `member` (or the issuing admin's own entry), not sample, active. Single-use, 7 days.
  - The invite records the entry id and the entry's linked user id (or none) when issued.
    At redemption it is refused if the entry was linked, relinked, deactivated or changed role
    since, or if (for a linked entry) that user's group count is no longer one.
  - Redeeming signs in the entry's user, or creates one with **no email** if the entry had
    none. Accounts made from an invite or a claim **never take the entry's email and are never
    looked up by email**.
  - Entries with an email are invited by email sign-in instead (with SMTP), or recovered by
    `flask signin-link`.
- **Admin-made sign-in links for people with accounts** (the existing 24-hour link) keep
  today's refusals (`manager_member`, `sample_member`, `member_inactive`) and are allowed
  **only when that person's group count is one, this group**. The rule is checked when the
  link is made **and again when it's used**. *(Decided by owner, 2026-11-20.)*
- **Sessions record their origin**: `sessions.origin` in `'email' | 'admin_link' | 'invite' |
  'join' | 'handoff' | 'setup' | 'cli'`. When a user's group count goes from one to more than
  one, their `admin_link` and `invite` sessions are revoked, so an admin who used a recovery
  link can't follow that person into a second group.
- **Already signed in on that phone**: opening a group link or invite offers "Join as <name>":
  - already an active member of that group → just open the group;
  - an **inactive** row in that group (removed or unlinked) → refused `removed`; links and
    "Join as" never reactivate anyone. Only an admin re-activates people.
  - otherwise a member row is added for the current user. A personal invite whose entry is
    linked to a different user is refused.
- **Undoing**: on a `claimed` or `link` entry an admin can **Remove** (deactivate) or
  **Unlink** (detach the user from a `claimed` entry; the entry and its history stay). Unlink
  also clears that user's id from the group's rows written through that entry
  (`Tasting.user_id`, `TastingFlight.host_user_id` and the like, keeping `member_id`), and ends
  that user's sessions if this was their only group. After Remove or Unlink of a link-joined
  person the admin is prompted to make a new group link.
- **Another phone**: a signed-in user (`signed_in`; never a device) makes a hand-off code
  (`login_tokens` purpose `handoff`, 5 minutes, single use; the purpose CHECK is widened with
  the SQLite batch pattern), shown as a QR. Scanning it starts a session for the same user.
  Users list and sign out their other sessions. Sessions gain a short `label` ("iPhone ·
  Safari") from the User-Agent, no new dependency.
- **Email** becomes optional: `users.email` nullable, still unique when set. The `@validates`
  normaliser accepts None. Email sign-in works as today for users who have one, with SMTP.
  - When an entry is linked by claim or join, `member.email` stays as it was (always empty
    for claimable entries). Code that matches `Member.email` to `User.email` must handle None
    on either side.
  - Adding an email to an existing account (not in this spec) would require confirming it by
    an emailed link first, since an email unlocks roster entries.
  - The downgrade refuses with a clear message while any user has no email.
- **Auto-linking by email** (`link_roster_members`) runs only when the user has **no active
  group**. Otherwise, roster rows with their email that aren't linked show to them as pending
  invitations ("Osteria floor team added you · Join / Ignore"), so no one can be added to a
  group silently. *(Decided by owner, 2026-11-20.)*
- The roster shows "Joined by link · <when>" (Remove) and "Claimed by link · <when>"
  (Unlink, Remove).
- Tablet codes are unchanged.

### First-run wizard (`/setup`)

Steps: claim → who are you (name, optional email) → [wine spec: drink] → first group (name,
timezone pre-filled from the browser) → sample data (optional) → "Get your team in" (the
group link as a QR code, copy link, print a join card).

- **Claiming** keeps today's guard exactly (setup token from the log, `SETUP_PASSWORD`, or
  "open" per the 2026-11-18 easy-setup rules, including "never open in a container"), with the
  gate as defined above. The claim screen says which applies: "you're on this network" only
  when open; otherwise the password field, with where to find it.
- `render.yaml` and `render.free.yaml` generate `SETUP_PASSWORD` (`generateValue: true`).
- **The address**: after the owner exists, an **owner-only** endpoint suggests the server's
  LAN address (the interface a UDP socket to a non-routable address would use; nothing is
  sent) when the wizard was loaded from `localhost`/`127.0.0.1`; the last step asks the owner
  to confirm it into `public_url`. Nothing about the network is exposed before setup.
- Finishing creates the owner, the first group, its admin member row, the group link, and
  optionally sample data, in one transaction. Its session's origin is `setup`.

### Migrations

Phase 1a (one revision):
- `users.is_owner`; backfill as owner the user of the active admin member with the earliest
  `members.created_at` (ties: lowest `members.id`) in the first non-personal group (lowest
  `groups.id`). If none has a user, fall back to any active admin member with a user (same
  ordering), and log which was chosen. An install with no admin user at all stays ownerless,
  and the new gate treats it as set up (it has a group), so `flask create-admin` is the way in.
- `users.email_verified_at`, backfilled to `created_at` for users with an email.
- `install_settings` with its one row (`team_creation = 'verified'`, `public_url = NULL`).
- The personal-space partial unique index.
- No change to tasting tables: existing rows are already group-scoped.

Phase 2: `invites`; `members.joined_via` and its timestamp; `sessions.origin` and `label`;
`users.email` nullable; `login_tokens` purpose `handoff`. Downgrade refuses while null emails
exist.

## Phases (each ships on its own, each its own plan)

1a. **Multi-group core, backend**: `X-Group` resolution and the `signed_in` level, owner and
   CLI commands, the setup gate and owner-on-setup, install settings API, the address helper
   with relative redirects and request-based `Secure`, team-creation rule, groups and
   personal-space API, auto-linking restricted to people with no group, migration,
   cross-group test sweep. Ships alone: clients that send no header behave as today.
1b. **Multi-group core, frontend**: `/g/:gid` routes, group-aware API client, flight-group
   lookup and redirect, group switcher, start-a-team and personal-space screens, the
   no-groups screen with pending invitations, install settings screen, `group_required`.
2. **Joining and sign-in**: invites, group link and personal invites, "I'm on the list",
   fragment-token join screens, redemption re-checks, session origins and revocation,
   hand-off QR, session list with labels, nullable email, roster flags, Remove/Unlink.
3. **First-run wizard**: wizard screens, owner-only LAN address suggestion, `public_url`,
   Render `SETUP_PASSWORD`, README updates.

## Constraints

- Flask/SQLAlchemy/Alembic, SQLite and Postgres both (CI runs both). React 19 + MUI 7.
  QR codes with the existing `qrcode.react` dependency; no new dependencies expected.
- Device checks branch on `actor.kind` (or the session's kind), never on `user_id`.
- No token in any URL path or query that reaches the server's access log; fragments only for
  new links. The existing `/api/auth/consume?token=` stays, covered by today's redaction.
- Join, invite and hand-off endpoints are rate-limited like the other public auth routes.
- Tokens are stored as sha256 only (`identity/tokens.py`).

## Testing that must exist

- A parametrized sweep over every group route: acting in group A with a resource of group B →
  404, for user and device sessions, open and closed flights.
- Header rules: missing/one group, missing/several (`group_required`), wrong group, device
  mismatch, inactive member row.
- `signed_in` routes: refuse device sessions; work for a user with no group.
- Owner sees group names and counts only; owner without membership gets 404 inside a group.
- Setup gate: a personal space or team can't be made while setup is needed; setup sets owner;
  race check counts owners.
- Upgrade test (SQLite and Postgres): a database at today's head migrates, its admin can still
  sign in and taste, the earliest admin is owner, the fallback picks another admin when needed,
  existing emails are verified.
- Team creation: `'verified'` refuses a link-joined user and allows an email-verified one;
  `ALLOW_SIGNUP` forces owner-only.
- Address: with `public_url` set, every link and QR uses it; `consume()` redirects relatively;
  `Secure` follows the request scheme.
- Joining: group link on/off/rotated; tokens only in fragments, absent from logs; claim offers
  only active, non-sample, email-less `member` entries and never admins or editors; a claimed
  entry can't be claimed again.
- Personal invites: single-use, expiry, refused for entries with an email; refused at
  redemption when the entry was linked/relinked/deactivated/role-changed since issue, or the
  user's group count changed.
- Recovery links: refused for a person in two groups (personal space counts), re-checked at
  use; `admin_link` and `invite` sessions revoked when the user gains a second group.
- Re-joining: "Join as" with an inactive row → `removed`; already a member → opens the group.
- Unlink clears that user's ids in the group's rows and keeps `member_id` history.
- Auto-linking: a user with a group isn't silently added; sees a pending invitation instead.
- Personal space: two concurrent creates make one.
- Hand-off: expiry, single use, refused from a device session.

## Left to the builder

- Table and column names beyond those stated, endpoint paths beyond those stated, and
  response shapes, following the existing route style.
- How the frontend stores the last-used group (per device, not security-relevant).
- Print layout of the join card.
- Exactly which tasting columns Unlink clears, as long as no user id of the unlinked person
  remains on that group's rows and `member_id` history is kept.
