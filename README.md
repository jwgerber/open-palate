# Open Palate

## What it is

A small web app for tasting coffee together. Staff log a *flight* (several coffees in pour order), score each cup on sliders, pick flavor terms from a wheel, note defects, and reveal everyone's reads once the flight closes. Blind flights stay blind, host included, until close. It also keeps a coffee list with consensus scores, a personal palate view, and printable cupping sheets.

One Docker image runs the Flask API and the built web app. Data lives in SQLite on a volume, or in Postgres if you set `DATABASE_URL`. For anything other than your own computer, put it behind HTTPS (secure cookies, QR links opened on phones).

## Quick start

The image is published to `ghcr.io/jwgerber/open-palate` when a version tag (`v1.2.3`) is pushed. Until the first release is out, or while the package is private, build it yourself from a checkout and use `open-palate` in place of `ghcr.io/jwgerber/open-palate:latest` below:

```sh
docker build -t open-palate .
```

Try it on your own computer. No other settings are needed:

```sh
docker run -p 127.0.0.1:8000:8000 -v open-palate-data:/data -e SETUP_OPEN=true ghcr.io/jwgerber/open-palate:latest
```

Open http://localhost:8000 and create the first admin. `SETUP_OPEN=true` lets anyone who can reach the app become the first admin, so this is safe only because the port is bound to `127.0.0.1`: nothing outside your computer can connect. Do not use it on a server.

On a server, drop `SETUP_OPEN`, set `BASE_URL` to the public address, and use the setup link or `SETUP_PASSWORD` (see First admin):

```sh
docker run -d --name tasting -p 8000:8000 \
  -e BASE_URL=https://tasting.example.com \
  -e SETUP_PASSWORD="choose-a-long-passphrase" \
  -v tasting-data:/data \
  ghcr.io/jwgerber/open-palate:latest
```

The app runs as uid 10001. On start the container fixes the ownership of `/data` itself, so a bind mount (`-v /srv/tasting:/data`) or a host disk that is owned by root works too. SQLite runs with write-ahead logging and one worker by default (set `WEB_CONCURRENCY` or `GUNICORN_THREADS` to change that).

`BASE_URL` is the public address people will type, with no trailing slash. It defaults to `http://localhost:8000` (with a warning in the log), which is right only on your own computer. Every link the app builds (sign-in emails, QR codes, the setup link) comes from it. On a server, put the container behind HTTPS (Caddy, a Cloudflare Tunnel, or a host such as Render or Fly.io). Check it with `curl http://localhost:8000/healthz`, which answers `{"ok":true}`.

Environment variables:

| Variable | Notes |
|---|---|
| `SECRET_KEY` | Optional with SQLite: when unset, one is generated on first start and kept in a file named `secret_key` next to the database file (mode 0600), so it lasts as long as the data. Required with Postgres (start-up fails without it). Keep it stable; changing it signs everyone out. |
| `BASE_URL` | Default `http://localhost:8000`, with a warning. Set it to the public address on any real deployment. |
| `SETUP_OPEN` | `true` lets anyone who can reach the app create the first admin; use it only with a port bound to `127.0.0.1`. `false` never opens setup by itself, even for local visitors. Unset (default): open only to local visitors when running outside Docker. |
| `SETUP_PASSWORD` | Optional. A passphrase that lets a visitor create the first admin from the setup page. |
| `DATABASE_URL` | Unset: SQLite at `/data/tasting.db`. Set: Postgres, e.g. `postgresql://user:pass@host/db`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional, see below. |
| `ANTHROPIC_API_KEY` | Optional, see below. |
| `ALLOW_SIGNUP` | Default `false`: only admins add people. |
| `PROXY_HOPS` | Default `1`, see below. |

Migrations run on every container start.

## First admin

While no admin exists, any ONE of these creates the first admin:

1. **Open setup.** The setup page needs nothing. It applies when `SETUP_OPEN=true` (anyone who can reach the app), or, when running directly and not in Docker, when the visitor's real connection and forwarded address are both on your own network (private or loopback). In Docker, setup is never open by itself: on a server, Docker makes every visitor look local, so you must use one of the next two ways or set `SETUP_OPEN`. Running directly behind a proxy or tunnel on the same machine, the proxy must send `X-Forwarded-For`; otherwise every visitor looks local. If you cannot guarantee that, set `SETUP_OPEN=false` and use the setup link or `SETUP_PASSWORD`.
2. **`SETUP_PASSWORD`.** Set it, open the app, and type it on the setup page.
3. **The setup link in the log.** On start, if no admin exists, the app logs a one-time link (valid 15 minutes, a fresh one at each start until an admin exists):

```sh
docker logs tasting | grep "No admin yet"
```

Open it, set your name, then set the group name and time zone, add staff, and make a device code. On a host where you only have a log viewer, the link is all you need. If you have a shell, this does the same:

```sh
docker exec --user 10001 tasting flask create-admin you@example.com
```

Setup requests are limited to 5 a minute. Once an admin exists, setup is closed. If every admin is lost, run `flask create-admin` again to recover.

Next, in the Log or Coffees tab an admin of an empty group can **load sample data** (five coffees, three sample tasters and a closed flight) to see how the app looks. Remove it in Group settings.

## The shop tablet

Open your `BASE_URL` on the tablet, enter the device code from the admin page, and Add to Home Screen. People then pick their name from the group's members and taste without signing in on the shared device.

## Email and scan (optional)

- **Email.** Set the `SMTP_*` variables and staff can sign in on their own phones with an emailed link. Without SMTP, sign-in links are written to the log instead, or an admin can open Group settings and use **Copy sign-in link** on a member who has an email (members only, plus your own row; admins and editors sign in by email): it makes a single-use link valid for 24 hours, cancels that person's older links, and needs no mail server. Emails are sent synchronously, so a slow mail server slows the request that sent it. Some email security scanners open links before the person does and use up the single-use link; open the link from a device you trust, or request a new one.
- **Paper-sheet scan.** Set `ANTHROPIC_API_KEY` to turn on photo scanning of paper cupping sheets. It only pre-fills the entry form; nothing is saved until a person confirms. Without the key the scan is off.

## Behind a proxy

Every absolute link uses `BASE_URL`, never the request's host. The client address for rate limits comes from `X-Forwarded-For`, trusting `PROXY_HOPS` proxies (default `1`, right for Render, Fly.io, Caddy and Cloudflare). **Set `PROXY_HOPS=0` if the container is not behind a proxy**, otherwise clients can spoof their IP and dodge rate limits. Running directly (not in Docker) behind a proxy or tunnel, the proxy MUST send `X-Forwarded-For`, otherwise every visitor looks local and the first internet visitor could claim the admin account; or set `SETUP_OPEN=false` and use the setup link or `SETUP_PASSWORD`. Set `PROXY_HOPS` to the exact number of proxies. A higher number lets a visitor fake their address, which can open setup. Rate limits are counted per worker, in memory, so they reset on restart.

Gunicorn's access log here records the path only, never the query string, because sign-in links carry a token there; the werkzeug log is redacted too. Only the configuration shipped in this repo does that, so do not turn on query-string access logs in a proxy or elsewhere without redacting `token=`.

## Backups and restore

SQLite: `flask backup` writes a consistent copy (safe while the app runs) to `/data/backups/tasting-YYYY-MM-DD.db` and keeps the newest 14. Run it nightly from the host:

```
0 3 * * * docker exec --user 10001 tasting flask backup
```

Always pass `--user 10001` to `docker exec`: as root it would create files the app cannot write. A restart also repairs ownership of the database files and `/data/backups`.

The backups sit on the same disk as the data, so copy `/data/backups` off the machine as well.

Restore, with the container stopped (`docker stop tasting`). Copy the backup into the volume, remove the old write-ahead files, and hand the file to the app user (uid 10001):

```sh
docker run --rm -v tasting-data:/data -v "$PWD":/backup python:3.12-slim sh -c \
  'cp /backup/tasting-YYYY-MM-DD.db /data/tasting.db \
   && rm -f /data/tasting.db-wal /data/tasting.db-shm \
   && chown 10001:10001 /data/tasting.db'
docker start tasting
```

Leaving a stale `tasting.db-wal` or `-shm` beside a restored file can corrupt it, so always remove both.

Postgres: use your database host's backups; `flask backup` refuses with exit status 2.

## Updating

1. Take a backup first (above).
2. Pull the new image and restart the container. Migrations run on start.

Pin a version tag (`ghcr.io/jwgerber/open-palate:v1.2.3`) instead of `latest` if you want to choose when you update.

## Deploy to Render

The blueprint in `render.yaml` runs the image as a web service with a 1 GB disk at `/data`, generates `SECRET_KEY`, and asks for `BASE_URL`. Add a `SETUP_PASSWORD` env var in Render if you prefer it to the log link. A disk needs a paid instance (the Starter plan, about $7 per month plus a little for the disk). Edit the `image.url` in `render.yaml` to your published image, and add registry credentials in Render while the package is private. Read the setup link from Render's logs.

## Development

`./scripts/dev.sh` does everything below in one step: it creates `.venv` and installs frontend packages on first run, migrates a SQLite database at `instance/dev.db`, and runs the API on port 8000 and the web app on http://localhost:5173. Ctrl-C stops both. `DATABASE_URL`, `SECRET_KEY` and `BASE_URL` from your environment override its defaults.

By hand:

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
SECRET_KEY=dev BASE_URL=http://localhost:5173 DATABASE_URL=sqlite:///dev.db .venv/bin/alembic upgrade head
SECRET_KEY=dev BASE_URL=http://localhost:5173 DATABASE_URL=sqlite:///dev.db .venv/bin/flask run --port 8000
cd frontend && npm ci && npm run dev
```

A relative SQLite `DATABASE_URL` such as `sqlite:///dev.db` puts the file in `instance/` (here `instance/dev.db`), created on first use.

Tests: `pytest` for the backend (set `TEST_DATABASE_URL` to also run on Postgres), `cd frontend && npx vitest run` for the frontend. CI runs both, on SQLite and Postgres.

## Flavor wheel

The flavor wheel is the SCA / World Coffee Research Coffee Taster's Flavor Wheel (2016), extended with notes from the Counter Culture Coffee Taster's Flavor Wheel (2020). The terms live in `content/lexicon.json`.

## License

AGPL-3.0. See `LICENSE`.
