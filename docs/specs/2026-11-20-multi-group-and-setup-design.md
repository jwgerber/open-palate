# Multi-group access and getting in: design

Date: 2026-11-20 · Status: draft for owner approval · Tier: Full (auth, permissions, migrations)

Mockups: the "Getting in" row (screens A–F) of the Open Palate Wine design canvas
(claude.ai/artifact/Hxdt2PrjHJ137xSnXoQZTu). They show intent, not exact copy or layout.
Where they differ from this document (screen F's "who can start a team"; screen E's QR), this
document wins.

## Why

Open Palate is self-hosted: one person installs it on a web host or a box at the shop, and
everyone else uses it from their phone. Today an install holds exactly one group, so a person
can't be in two teams, a restaurant can't run a managers' group beside its floor team, and
nobody can taste alone. Getting people in leans on email or on an admin copying sign-in links
one at a time, and phones on shop Wi-Fi need an address nobody can type.

This is the foundation for wine, which is built after this ships, as its own spec.

## Goals

1. **Many groups per install.** A person can belong to several groups, switch between them,
   and act in exactly one group per request.
2. **An owner** (the installer) runs install-wide settings and makes teams.
3. **Anyone can make a personal space** for solo tasting.
4. **Easy joining.** One open link or QR code per group: scan, type a name, you're in.
5. **Always a way back** to your own tastings: email when the install has it, otherwise an
   admin or the server, plus approving a new device from a signed-in one.
6. **A first-run wizard** in the browser that ends with the group's QR code.
7. **Existing installs keep working** with no action.

## Non-goals

- Wine and the install's "what do you taste" setting (the wine spec adds them; the wizard
  leaves a slot between "who are you" and "first group").
- A hosted service or anything run by the author.
- Passwords or passkeys.
- Moving people or data between groups, merging accounts or groups, deleting groups.
- Claiming an existing roster entry through the open link (tablet-only people get a personal
  invite instead).
- Teams started by anyone other than the owner.
- Email settings in the app (SMTP stays in server configuration).

## Anti-goals (a failure even if it works)

- **Any cross-group leak**: a request acting in group A reads or writes anything of group B,
  by any route, header, link or id. The blind and no-leak invariants hold per group.
- A score lands in a different group than the screen it was entered on.
- The owner sees inside a group they don't belong to (names and counts only).
- A token appears in a server log, a URL path or query sent to the server, browser storage,
  or any response but the one that issues it.
- A link or invite brings back someone an admin removed.
- An existing install loses access, data or a working sign-in after upgrading.

## How this compares with established practice

Researched 2026-11-20; sources in the conversation that produced this doc.
- **Open team links that never expire, with "regenerate" to kill the old one**: Mattermost.
  (Discord adds optional expiry and use limits; not needed here.)
- **Recovery without email runs through an admin or the server**: Immich (admin reset, server
  command), Nextcloud (admin sets password), Home Assistant (console command only). OWASP: a
  user must always have *some* way back, even by staff verifying them by hand.
- **New device shows a code, a signed-in device approves it**: Jellyfin Quick Connect. This
  also covers iPhone home-screen apps, whose storage is separate from Safari's (WebKit bug
  181849), so a person who joined in Safari can sign the home-screen app in the same way.
- **Single-use, short-lived, hashed tokens; never reveal whether an account exists; emailed
  links open a confirm button** so mail scanners can't use them up: OWASP.

## Approaches considered

Every route already gets its group from one place (`_resolve_actor()` → `actor.group_id`,
about 90 uses across 50 routes). The choice was how a request names its group:

1. **Group sent with each request** (`X-Group` header, group in frontend URLs). **Chosen.**
   No route rewrites; each tab or phone can be in a different group.
2. **Group in every API path.** Equally safe, but rewrites all 50 routes and every frontend
   call for the same single membership check.
3. **Current group stored on the session.** Rejected: all tabs share a session, so a second tab
   switched to another group would silently send scores to the wrong group.

## Decided

### How a request picks its group

- Frontend URLs carry the group: `/g/:groupId/...`. The API client sends `X-Group: <id>` on
  every request made from a group screen.
- `_resolve_actor()` stays the single choke point for group routes. For a user session it
  loads the **active** member row for `(session.user_id, X-Group)`:
  - found → Actor for that group;
  - not found → **404** `group_not_found` (never 403: don't confirm the group exists);
  - header absent, exactly one active group → that group (today's clients keep working);
  - header absent, several → **400** `group_required` (replaces 403 `ambiguous_group`);
    none → 403 `no_group`.
- Device sessions stay bound to `device_group_id`; a header naming another group → 404.
- Routes keep reading `actor.group_id`; they change only where they don't yet filter by it.
- **A new access level `signed_in`** for routes that have no group: user sessions only (never a
  device), no group resolved, no Actor built. Used by `/api/auth/me`, making a personal space,
  owner routes, device approval and the session list. Owner routes also check `is_owner`.
- `/f/:id` is a frontend route: 1b adds `GET /api/flights/:id/group` returning the flight's
  group when the caller is an active member of it (or a device in it); every other case,
  including a missing flight, is the same 404. The frontend then goes to `/g/:gid/f/:id`.
- `/api/auth/me` returns the caller's active groups (id, name, role, is_personal) and
  `is_owner`.

### Owner

- `users.is_owner`. More than one owner allowed; the last can't be removed.
- The owner: edits install settings, lists non-personal groups by name and member count, and
  **makes teams**. Being owner gives no access inside a group; the owner joins their own teams
  as admin when making them.
- Server commands (whoever runs the server is already trusted with its data):
  - `flask create-admin <email | user-id>`: grants owner (creating the user from an email if
    needed). On an install with no group yet it also makes the first group, as today.
  - `flask remove-owner <email | user-id>`: refused for the last owner.
  - `flask signin-link <email | user-id>`: prints a one-time sign-in link; changes nothing else.

### Setup gate (lands in 1a)

- "Setup needed" = **no owner and no non-personal group**. It replaces `admin_exists()` in the
  setup route, `/api/auth/setup-status` and the start-up log; the race check counts owners.
- From 1a on, today's setup route and `ensure_admin` set `is_owner`.
- Making groups or personal spaces is refused (409 `setup_needed`) while setup is needed.

### Install settings and the app's address

- One-row `install_settings`, read on every request (Postgres runs two workers):
  `public_url` (nullable, owner-editable, an `http(s)` origin with no path).
- One helper gives the address for anything sent off-device: `public_url`, else `BASE_URL`.
  Every link, invite and QR code is built on the server with it, never from the browser.
- Redirects after sign-in are relative (`/`), so the cookie set on whatever host the link was
  opened on is kept. `Secure` cookies follow `request.is_secure` (ProxyFix is configured), so
  phones on plain-http Wi-Fi keep their cookie.

### Groups

- `POST /api/groups` `{name, timezone}`: owner only. The owner becomes its admin.
- `POST /api/groups/personal` (`signed_in`): one per user, enforced by a unique index; a
  second call returns the existing one. A personal space has one member (its user, admin)
  and no roster, link, invites or tablet codes; those routes 404 there.
- Roles stay per group (admin, editor, member), including "can't remove the last admin".
- **No groups yet**: a signed-in user with no active group sees "You're not in a group yet"
  with "Make a personal space" and a line saying a team admin can send them a link.
- A person's **group count** = their active member rows, personal space included.

### Joining

Join and invite links carry their token after `#` (`/join#<token>`, `/invite#<token>`), which
browsers never send to the server. The app reads it and redeems it with a POST. No URL path or
query sent to the server contains one of these tokens.

- **Group link**: one per group, on by default for teams. Admins turn it off or **make a new
  one** (the old stops working). No expiry. Opening it shows the group's name and size.
  - **Install without email**: type a name → a new user (no email), an active member row
    with `joined_via = 'link'`, a session.
  - **Install with email (SMTP set)**: name and email → "check your email" → the emailed link
    opens a **Join** button → confirmed. If that email already has an account, the button signs
    into *that* account and adds the membership; the screen before says the same thing either
    way, so it never reveals whether an account exists.
  - The join screen says: "Been here before? Don't join again: sign in, or ask an admin."
  - Already signed in on that phone: "Join as <name>" adds the membership; already a member
    just opens the group.
  - **Removed stays removed**: an inactive row for that person in the group → refused
    `removed`. Links never reactivate anyone; only an admin does.
  - Accepted trade-off: anyone holding the link can join as a member until an admin makes a
    new one. The roster flags "Joined by link · <when>" with Remove, and after a Remove the
    admin is offered "make a new link".
- **Personal invite**, for roster entries with **no account and no email** (typically
  tablet-only people, keeping their tablet history): role `member`, active, not sample.
  Single-use, 7 days, shown as a QR. Redeeming links a new user (no email) to that entry. It
  never looks anything up by email. Entries with an email join by email sign-in instead.

### Getting back in

- **Same phone**: still signed in. Sessions for users **without an email** roll for 365 days
  (as devices do) instead of 30, so a month away doesn't lock them out.
- **Approve a new device** (any user): the new phone, or an iPhone home-screen app, chooses
  "Use a signed-in device" and shows a 6-digit code (5 minutes). On a signed-in device,
  "Approve a device" takes the code, shows the new device's label ("iPhone · Safari"), and
  approves; the new device then gets a session for the same user. Codes are stored hashed,
  single use, rate-limited per user and per IP; approving needs a `signed_in` session (never a
  tablet).
- **Email sign-in**, for users with an email, when SMTP is set: as today, except the emailed
  link opens a **Sign in** button (POST) instead of signing in on open.
- **Admin re-invite** (people with an account): an admin taps "Re-invite" on a roster entry and
  gets a one-time link or QR. Allowed only when that person's group count is one (this group),
  checked when made and when used; keeps today's refusals for other managers, sample and
  inactive members.
  - Accepted residual: an admin who misuses a re-invite gets a session as that person. The
    person can see and sign out every session from "Your devices", and re-invites are recorded
    on the member row for other admins to see.
- **`flask signin-link`** for anyone else, including people in several groups.
- "Your devices" lists the user's sessions with labels and "Sign out".

### Email becomes optional

- `users.email` nullable, unique when set; the `@validates` normaliser accepts None.
- Accounts made from the open link (no-email install) or a personal invite have no email.
  Adding an email later is out of scope; if added, it must be confirmed by an emailed link
  first.
- `link_roster_members` keeps today's behaviour (attach unlinked roster rows with the same
  email on email sign-in), safe because only the owner makes teams.
- The downgrade refuses while any user has no email.

### First-run wizard (`/setup`)

Steps: claim → who are you (name, optional email) → [wine spec: drink] → first group (name,
timezone from the browser) → sample data (optional) → "Get your team in" (the group link as a
QR, copy, print a join card).

- **Claiming** keeps today's guard (setup token from the log, `SETUP_PASSWORD`, or "open" per
  the 2026-11-18 easy-setup rules, including "never open in a container"), with the new gate.
  The screen says which applies.
- `render.yaml` and `render.free.yaml` generate `SETUP_PASSWORD`.
- **The address**: after the owner exists, an owner-only endpoint suggests the server's LAN
  address when the wizard was loaded from `localhost`, and the last step asks the owner to
  confirm it into `public_url`. Nothing about the network is exposed before setup.
- Finishing creates the owner, first group, admin row, group link and optional sample data in
  one transaction.

### Migrations

Phase 1a (one revision):
- `users.is_owner`; backfill the user of the active admin with the earliest
  `members.created_at` (ties: lowest id) in the lowest-id non-personal group; if none has a
  user, any active admin with a user (logged). An install with no admin user stays ownerless
  but has a group, so the gate treats it as set up; `flask create-admin` is the way in.
- `install_settings` with one row (`public_url = NULL`).
- Unique index: one personal group per user.

Phase 2: `invites` (group links and personal invites), `members.joined_via` and time,
re-invite record, `device_approvals`, `sessions.label`, `users.email` nullable.

## Phases (each ships on its own, each its own plan)

1a. **Backend core**: `X-Group` and `signed_in`, owner and CLI commands, setup gate, install
   settings API and address helper (relative redirect, request-based `Secure`), groups and
   personal-space API, migration, cross-group test sweep. Header-less clients behave as today.
1b. **Frontend core**: `/g/:gid` routes, group-aware API client, flight-group lookup, group
   switcher, make a team (owner) and personal space, no-groups screen, install settings,
   `group_required`.
2. **Joining and getting back in**: group link (with and without email), personal invites,
   join screens, approve a new device, email links with a confirm button, admin re-invite,
   "Your devices", longer sessions for no-email users, nullable email, roster flags.
3. **First-run wizard**: wizard, owner-only LAN suggestion, `public_url`, Render
   `SETUP_PASSWORD`, README.

## Constraints

- Flask/SQLAlchemy/Alembic, SQLite and Postgres (CI runs both). React 19 + MUI 7. QR codes
  with the existing `qrcode.react`; no new dependencies expected.
- Device checks branch on the session or actor kind, never on `user_id`.
- Join, invite, approval and email endpoints are rate-limited like the other public auth
  routes. Tokens and codes are stored as sha256 only.

## Testing that must exist

- Cross-group sweep over every group route: acting in group A with group B's resources → 404,
  user and device sessions, open and closed flights.
- Header rules (none/one, none/several, wrong group, device mismatch, inactive row);
  `signed_in` refuses devices and works with no group.
- Owner: sees names and counts only, 404 inside groups they're not in, only the owner makes
  teams.
- Setup gate: nothing can be made while setup is needed; setup sets owner.
- Upgrade (SQLite and Postgres): today's head migrates, the admin still signs in and tastes,
  the expected admin becomes owner, the fallback works.
- Address: links and QRs use `public_url`; redirects are relative; `Secure` follows the request.
- Joining: link on/off/new link; tokens only after `#`, never in logs; with SMTP the email step
  gives the same response for new and existing emails; removed people refused; "Join as".
- Personal invites: single use, expiry, only for no-account no-email member entries.
- Device approval: expiry, single use, rate limit, refused from tablets, new device gets the
  same user.
- Email links don't sign in on GET; the button does.
- Re-invite: refused for someone in two groups (personal space counts), re-checked at use.
- No-email sessions roll for 365 days.

## Left to the builder

- Names beyond those stated, endpoint paths, response shapes, following the existing style.
- How the frontend remembers the last-used group.
- Join card print layout; the device label format.
