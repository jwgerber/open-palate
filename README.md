# Open Palate

## What it is

A small web app for tasting coffee together. Staff log a *flight* (several coffees in pour order), score each cup on sliders, pick flavor terms from a wheel, note defects, and reveal everyone's reads once the flight closes. Blind flights stay blind, host included, until close. It also keeps a coffee list with consensus scores, a personal palate view, and printable cupping sheets.

One Docker image runs the Flask API and the built web app. Data lives in SQLite on a volume, or in Postgres if you set `DATABASE_URL`. HTTPS is required (secure cookies, QR links opened on phones).

## Quick start

```sh
docker run -d --name tasting -p 8000:8000 \
  -e SECRET_KEY="$(openssl rand -hex 32)" \
  -e BASE_URL=https://tasting.example.com \
  -v tasting-data:/data \
  ghcr.io/OWNER/open-palate:latest
```

`BASE_URL` is the public address people will type, with no trailing slash. Every link the app builds (sign-in emails, QR codes, the setup link) comes from it. Put the container behind HTTPS (Caddy, a Cloudflare Tunnel, or a host such as Render or Fly.io). Check it with `curl http://localhost:8000/healthz`, which answers `{"ok":true}`.

Environment variables:

| Variable | Notes |
|---|---|
| `SECRET_KEY` | Required. Keep it stable; changing it signs everyone out. |
| `BASE_URL` | Required. |
| `DATABASE_URL` | Unset: SQLite at `/data/tasting.db`. Set: Postgres, e.g. `postgresql://user:pass@host/db`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional, see below. |
| `ANTHROPIC_API_KEY` | Optional, see below. |
| `ALLOW_SIGNUP` | Default `false`: only admins add people. |
| `PROXY_HOPS` | Default `1`, see below. |

Migrations run on every container start.

## First admin

On start, if no admin exists, the app logs a one-time setup link (valid 15 minutes, a fresh one at each start until an admin exists):

```sh
docker logs tasting | grep "No admin yet"
```

Open it, set your name, then set the group name and time zone, add staff, and make a device code. On a host where you only have a log viewer, that is all you need. If you have a shell, this does the same:

```sh
docker exec tasting flask create-admin you@example.com
```

If every admin is lost, run `flask create-admin` again to recover.

## The shop tablet

Open your `BASE_URL` on the tablet, enter the device code from the admin page, and Add to Home Screen. People then pick their name from the group's members and taste without signing in on the shared device.

## Email and scan (optional)

- **Email.** Set the `SMTP_*` variables and staff can sign in on their own phones with an emailed link. Without SMTP, sign-in links are written to the log instead. Emails are sent synchronously, so a slow mail server slows the request that sent it. Some email security scanners open links before the person does and use up the single-use link; open the link from a device you trust, or request a new one.
- **Paper-sheet scan.** Set `ANTHROPIC_API_KEY` to turn on photo scanning of paper cupping sheets. It only pre-fills the entry form; nothing is saved until a person confirms. Without the key the scan is off.

## Behind a proxy

Every absolute link uses `BASE_URL`, never the request's host. The client address for rate limits comes from `X-Forwarded-For`, trusting `PROXY_HOPS` proxies (default `1`, right for Render, Fly.io, Caddy and Cloudflare). **Set `PROXY_HOPS=0` if the container is not behind a proxy**, otherwise clients can spoof their IP and dodge rate limits. Rate limits are counted per worker, in memory, so they reset on restart.

Gunicorn's access log here records the path only, never the query string, because sign-in links carry a token there; the werkzeug log is redacted too. Only the configuration shipped in this repo does that, so do not turn on query-string access logs in a proxy or elsewhere without redacting `token=`.

## Backups and restore

SQLite: `flask backup` writes a consistent copy (safe while the app runs) to `/data/backups/tasting-YYYY-MM-DD.db` and keeps the newest 14. Run it nightly from the host:

```
0 3 * * * docker exec tasting flask backup
```

The backups sit on the same disk as the data, so copy `/data/backups` off the machine as well.

Restore: stop the container, put a backup at `/data/tasting.db`, start it again.

Postgres: use your database host's backups; `flask backup` refuses with exit status 2.

## Updating

1. Take a backup first (above).
2. Pull the new image and restart the container. Migrations run on start.

Pin a version tag (`ghcr.io/OWNER/open-palate:v1.2.3`) instead of `latest` if you want to choose when you update.

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

The blueprint in `render.yaml` runs the image as a web service with a 1 GB disk at `/data`, generates `SECRET_KEY`, and asks for `BASE_URL`. A disk needs a paid instance (the Starter plan, about $7 per month plus a little for the disk). Edit the `image.url` in `render.yaml` to your published image, and add registry credentials in Render while the package is private. Read the setup link from Render's logs.

## Development

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
SECRET_KEY=dev BASE_URL=http://localhost:5173 DATABASE_URL=sqlite:///dev.db .venv/bin/alembic upgrade head
SECRET_KEY=dev BASE_URL=http://localhost:5173 DATABASE_URL=sqlite:///dev.db .venv/bin/flask run --port 8000
cd frontend && npm ci && npm run dev
```

Tests: `pytest` for the backend (set `TEST_DATABASE_URL` to also run on Postgres), `cd frontend && npx vitest run` for the frontend. CI runs both, on SQLite and Postgres.

## License

AGPL-3.0. See `LICENSE`.
