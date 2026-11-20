# Render trial: one-click deploy that people can get into

Status: draft for owner approval. Tier: Full (sign-in behavior and the deploy contract change).

## Why

The owner wants a link in the GitHub README that lets someone checking out Open Palate deploy their own free copy on Render and try it. Today a fresh free deploy has rough edges that can leave a visitor stuck:

- **The sign-in page always promises an email.** Render's free plan blocks outbound SMTP (ports 25, 465 and 587), so no email ever arrives, and the link goes only to the server log.
- **The visitor must type their own address up front.** They don't know it yet, because Render picks the `onrender.com` name, sometimes with a suffix. A wrong `BASE_URL` breaks the setup and sign-in links.
- **Nothing explains how to get back in.** A returning admin's only way back is a sign-in link in the Render logs.
- **There is no one-click button,** because the button only reads `render.yaml`, which is the paid setup.

## Goals

- **A Deploy to Render button in the README** deploys the free trial in one click. A visitor ends up as the first admin of their own copy without typing their URL.
- **The sign-in page tells the truth when email isn't set up:**
  - Members are told to ask an admin for a sign-in link.
  - Admins are told where to find their own link: Render logs, search "Sign-in link for".
- **The visitor can choose a setup password at deploy time.** It's optional; the 15-minute log link still works.
- **The README explains getting started and getting back in** for a Render trial.

## Non-goals

- A shared, hosted demo (approach B in the conversation). That's a separate project for later.
- Letting admins copy sign-in links for other admins or editors. The existing block stays (owner's call, confirmed by silence on the proposal).
- Sending email from the free plan, whether through an HTTP email API or SMTP on port 2525.
- Making the repo public. The button waits for that; see Constraints.

## Anti-goals

- Revealing which emails have accounts. The request-link reply stays identical for known and unknown addresses.
- A sign-in link, setup token or password appearing anywhere new: the response, the page, or logs beyond the existing log line.
- Breaking the paid deploy or the user's existing trial Blueprint without saying how to fix it.

## Constraints

- Render's Deploy button reads `render.yaml` at the repo root. No documented parameter points it at another file.
- Render sets `RENDER_EXTERNAL_URL` (for example `https://open-palate-trial.onrender.com`) on every web service, at build time and at runtime.
- The button works only on a public repo. The repo stays private until the flavor-wheel and cupping-sheet publishers agree, so the button ships now but won't work until then. The README must say so.
- In Docker, setup is never open by itself (`setup_access.py`). The first admin comes from the log link or `SETUP_PASSWORD`.

## Approaches considered

1. **Make the free trial `render.yaml`, and move the paid setup to `render.paid.yaml` (chosen).** The button is truly one click. A real deployment needs one extra step: setting Blueprint Path in Render.
2. **Keep `render.yaml` as the paid setup and give manual steps for the trial.** Nothing is renamed, but there is no one-click deploy and the path is easy to get wrong.

## Decisions

The owner decided:
- Visitors deploy their own copy (approach A, not a hosted demo).
- Option 1: the free trial becomes `render.yaml`.

My calls (the owner can override):
- **`BASE_URL` fallback:** when `BASE_URL` is unset, the app uses `RENDER_EXTERNAL_URL` if present, before the `http://localhost:8000` default. `render.yaml` (free) stops asking for `BASE_URL`; a custom domain can still set it. The paid `render.paid.yaml` keeps its prompt, since paid deploys often use custom domains.
- **How the page knows email is off:** `GET /api/auth/setup-status` adds `"email": true|false` (true when `SMTP_HOST` is set) to every reply. The endpoint is public and already called before sign-in. Saying whether email is set up reveals nothing about accounts.
- **Sign-in page when email is off:** the form and the reply stay the same (request-link still logs the link, so admins can get one). The intro line and the post-submit message change. Exact copy:
  - Intro: "This copy of Open Palate can't send email. Ask an admin for a sign-in link."
  - After submitting: "If that address is on the list, a sign-in link was written to the server log (Render: Logs, search for "Sign-in link for"). It works once and expires in 15 minutes. Staff: ask an admin to copy a sign-in link for you from Group settings."
- **Setup password:** `render.yaml` (free) declares `SETUP_PASSWORD` with `sync: false`, so Render asks for it at deploy. Leaving it blank keeps the log-link route, because an empty value is treated as unset (`config.py` already does `or None`).
- **Files:**
  - `render.free.yaml` is renamed to `render.yaml`.
  - The old `render.yaml` becomes `render.paid.yaml`.
  - The service and database names stay `open-palate-trial` and `open-palate-trial-db`.
- **Your existing trial Blueprint** currently points at `render.free.yaml`. Its Blueprint Path is changed to `render.yaml` in Render before the rename merges, so its next sync doesn't fail. This goes in the Ship Checklist.
- **The button:** goes in the README's "Free trial on Render" section as Render's standard badge, linking to `https://render.com/deploy?repo=https://github.com/jwgerber/open-palate`, with a note that it works once the repository is public.

## What changes

- **`config.py`:** the `BASE_URL` fallback described above, with a log line saying which source was used.
- **`identity/auth_routes.py`:** `setup_status` returns `email` in both branches.
- **`frontend/src/auth/SignInPage.jsx`:** reads `email` from setup-status and shows the email-off copy. If the call fails, it keeps today's wording.
- **Blueprints:**
  - Rename `render.free.yaml` to `render.yaml`, drop its `BASE_URL` prompt, and add `SETUP_PASSWORD` with `sync: false`.
  - Rename the old `render.yaml` to `render.paid.yaml`.
  - Update the header comment in each to say which is which and how to choose a Blueprint Path.
- **README:**
  - The Deploy to Render section, with the button and the public-repo note.
  - The trial steps: click, optionally set a setup password, open the setup link or use the password.
  - A "Getting back in" note.
  - The paid deploy now points at `render.paid.yaml`.
  - The `BASE_URL` row in the env table mentions the Render fallback.
- **Tests:**
  - Config: `RENDER_EXTERNAL_URL` is used when `BASE_URL` is unset, and `BASE_URL` wins when both are set.
  - Route: `setup-status` includes `email` both before and after setup.
  - Frontend: the sign-in page shows the email-off intro and post-submit copy when `email` is false, and today's copy when it is true.

## Left to the builder

- Exact markup for the badge (Render's documented image URL).
- Whether the email-off note is an `Alert` or plain text. Keep it readable on a phone.

## Ship Checklist

- [ ] Third-party config: in Render, change the `open-palate-trial` Blueprint's Blueprint Path from `render.free.yaml` to `render.yaml` before merging.
- [ ] Migration: none.
- [ ] Env vars: none required. The existing trial keeps its `BASE_URL`, which still wins over the fallback.
- [ ] Smoke: after merge, the trial redeploys from `render.yaml`. `/healthz` is OK, and the sign-in page shows the email-off copy. Once the repo is public, click the README button from a logged-out browser and confirm Render offers the trial plan.
- [ ] Docs: README (Render sections and env table), and the CLAUDE.md commands section if it mentions `render.yaml`.
