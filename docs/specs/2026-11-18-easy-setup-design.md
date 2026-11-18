# Easy setup and exploring: design

Date: 2026-11-18 · Status: draft for owner approval

## Why

Today every first step runs through the server log. A new install needs `SECRET_KEY` and
`BASE_URL` set before it starts, the first-admin setup link is printed to the log and dies
after 15 minutes, and without SMTP every sign-in link is in the log too. Once in, an admin
faces an empty app with nothing to look at until real people taste real coffees.

Goal: someone can `docker run` the image with no settings, open it in a browser, become
admin, invite people without a mail server, and see what the app does within a minute.

## Goals

1. **First run without the log.** No settings are required to start, and a visitor on the
   same machine or local network gets "create the first admin" directly.
2. **Sign-in without email.** An admin can copy a member's sign-in link and send it however
   they like.
3. **Sample data.** An admin of an empty group can load example data and remove it again.

## Non-goals

- Publishing the image, a Deploy button, Docker Compose, or a public demo (later, separately).
- Passwords, passkeys or any new way to sign in. A copied link is the same link email sends.
- Sample data for anything but a fresh group, or more than one sample set.

## Anti-goals (a failure even if it works)

- A server reachable from the internet can be taken over by whoever loads it first.
- A sign-in link, setup password or secret key appears in a log, a response body other than
  the one that issues it, or the browser's storage.
- Sample data mixes into real data: sample tasters in the tablet's picker, sample reads in a
  real person's palate, or a wipe that deletes a real tasting.

## 1. First run without the log

### Settings

- **`SECRET_KEY`** stays the authority when set. When unset and the database is SQLite, the
  app uses a key stored in a file named `secret_key` **in the same folder as the SQLite
  database file**, so the key lasts exactly as long as the data. It is created on first
  start with `secrets.token_urlsafe(48)`, file mode `0600`, with an exclusive create so two
  workers starting together cannot write two keys (the loser reads the winner's file). If
  the file cannot be read or written, start-up fails with a message naming the path and
  saying to set `SECRET_KEY` or fix the folder. When unset and the database is Postgres,
  start-up fails with a message saying to set `SECRET_KEY` (a container's own filesystem is
  not durable there; Render's blueprint already generates it). The key is never logged.
- **`SETUP_OPEN`** (new, optional, default off). See "Who may create the first admin".
- **`OPEN_PALATE_CONTAINER`** is set to `1` by the Dockerfile. It is how the app knows it
  runs in a container; operators do not set it.
- **`BASE_URL`** defaults to `http://localhost:8000` when unset, with one start-up warning
  that links will point there. It is still needed for any real deployment.
- **`SETUP_PASSWORD`** (new, optional). When set, it lets a non-local visitor create the
  first admin. Compared in constant time. Never logged.

### Who may create the first admin

While no admin exists, `POST /api/auth/setup` accepts any ONE of:

1. the existing setup token from the log (unchanged, 15 minutes);
2. a `setup_password` matching `SETUP_PASSWORD`;
3. nothing, when setup is **open** for this request.

Once an admin exists, every setup request is refused (unchanged: 409 `setup_done`).

**"Open"** means:

- `SETUP_OPEN=true` → open to every visitor, in or out of a container. The app logs one
  warning at start while no admin exists. The README pairs it only with a port published on
  `127.0.0.1` (`docker run -p 127.0.0.1:8000:8000 -e SETUP_OPEN=true …`), so the app cannot
  be reached from outside that computer.
- otherwise, in a container (`OPEN_PALATE_CONTAINER=1`) → never open. Docker's port
  mapping makes outside visitors arrive from the bridge's private address, so "local"
  cannot be told apart from the internet there. Use the setup link or `SETUP_PASSWORD`.
- otherwise (running directly, not in a container) → open when the request is **local**.

**"Local"** means BOTH of these are private addresses: the socket peer address (the real
connection, before `ProxyFix`) AND the client address `ProxyFix` resolves from
`PROXY_HOPS`. Private = loopback (`127.0.0.0/8`, `::1`), RFC 1918 (`10/8`, `172.16/12`,
`192.168/16`), IPv6 unique-local (`fc00::/7`) and link-local (`fe80::/10`). Use Python's
`ipaddress` module, not string prefixes.

Why both: with no proxy in front, `ProxyFix` would trust a client-sent `X-Forwarded-For:
127.0.0.1`; the socket peer catches that. Behind a hosting proxy the socket peer is the
proxy's private address, and the forwarded client address catches the outside visitor.
Known limit: a `PROXY_HOPS` set higher than the real number of proxies lets a client forge
the forwarded address. The README's proxy section says so.

### `GET /api/auth/setup-status` (new, public)

While no admin exists: `{"needed": true, "open": bool, "password": bool}`, meaning whether
this request may set up with nothing, and whether `SETUP_PASSWORD` is configured. Once an
admin exists: `{"needed": false}` and nothing else. Rate-limited like the other public auth
routes.

### Frontend

- When `needed` is true, every page except `/setup` goes to `/setup`.
- `/setup`: `open`, or a valid `?token=` → the existing form (name, email). Otherwise, with
  `password` true → the form plus a "Setup password" field. Otherwise → a short page
  saying how to get the setup link from the log, or to set `SETUP_PASSWORD` (or, on your
  own computer, `SETUP_OPEN`).
- The start-up log line stays; its text adds "or open the app from this machine".

## 2. Copy a sign-in link

- Admins only. Group settings → each member row with an email gets **Copy sign-in link**.
  Members without an email show it disabled with "Add an email first". Inactive members
  get nothing.
- `POST /api/admin/members/<id>/signin-link` (admin): finds the user with the member's
  email, or creates one even when `ALLOW_SIGNUP` is off (the admin is vouching for a member
  who already exists), links the member, and returns
  `{"link": ...}`. The link is the same `/api/auth/consume?token=` link email sends, with
  `purpose="signin"`, single use, **24-hour** expiry.
- Issuing a link marks every other unused sign-in token for that user as used, so only the
  newest link works (email links included).
- The UI copies to the clipboard and shows "Copied. Works once, for 24 hours." It does not
  show the link on screen beyond a fallback text field when the clipboard is refused.
- Logged at INFO: `admin_member_id`, `target_member_id`, expiry. Never the link or token.
- Cross-group member ids are 404, as elsewhere.

## 3. Sample data

### Data model (one migration, `0005`)

Add `is_sample BOOLEAN NOT NULL DEFAULT false` to `members`, `tasting_coffees` and
`tasting_flights`. Tastings, tags and defects need no flag: they belong to a sample flight.
The migration must build from an empty database like 0001–0004.

### What loading adds

`POST /api/admin/sample-data` (admin), acting on the admin's current group. Refused 409
`not_empty` when the group has any coffee, archived ones included, and 409
`already_loaded` when sample rows exist. In one transaction:

- 5 coffees, each with roaster, origin, process and notes. Roaster names are invented and
  clearly fictional; no real company is named.
- 3 members, `is_sample`, no email, role member, named `Sample · Robin`, `Sample · Sam`,
  `Sample · Jo`.
- One shared, blind, basic flight of 4 of the coffees, hosted by the admin, closed, with all
  three sample members' reads (overall, scales, 2–3 flavors each, from the current lexicon).
  Three reads reach `CONSENSUS_THRESHOLD`, so coffee pages show averages and descriptors.

### Keeping it apart

- Sample members never appear in the device "Who's tasting?" list, the paper-taster list or
  any other picker. They do appear in Group settings, marked "Sample", without actions.
  The filter lives in the data layer: the plan lists every `Member` query in the codebase
  and marks each as filtered or as a named exception (Group settings, and reads joined
  through their own tastings).
- Sample members cannot sign in: they have no email, and the copy-link route refuses them.
- A real person's palate never includes sample reads (they are other people's reads anyway).

### Removing it

`DELETE /api/admin/sample-data` (admin), behind a confirm in Group settings ("Remove sample
data"), shown while sample rows exist. In one transaction it deletes sample flights (with
their tastings, tags and defects), then sample members, then sample coffees, EXCEPT a
sample coffee that still has any tasting after the flights are gone: that coffee is kept
and its `is_sample` cleared, so a real tasting is never lost.

### Frontend

On Log and Coffees, for an admin of a group with no coffees: an "Explore with sample data"
card with a Load button and one line on what it adds. After loading, the Coffees list and
Recent flights show it.

## Constraints

- New routes gated through the existing access layer (`require("admin")` for admin routes).
- No new runtime dependency.
- Tests on SQLite and Postgres; the migration runs from empty in the migration tests.
- The original app's name and any shop or staff names stay out of every file (the hashed name scan must pass).

## Left to the builder

Exact copy beyond what is quoted here; sample coffee details; the card's layout; where the
setup-status call lives in the auth context.
