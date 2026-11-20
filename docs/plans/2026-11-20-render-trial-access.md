# Render Trial Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Someone can click Deploy to Render, get their own free copy, create the first admin, and sign in again later, all without email or typing their own URL.

**Architecture:** `BASE_URL` falls back to Render's `RENDER_EXTERNAL_URL`. The public `GET /api/auth/setup-status` reports whether email is configured, and the sign-in page changes its wording when it isn't. The free blueprint becomes `render.yaml`, with a generated `SETUP_PASSWORD`. The paid one becomes `render.paid.yaml`. The README gains the button and the steps for getting started and getting back in.

**Tech Stack:** Flask, pytest, React 19 + MUI, Vitest, Render Blueprints.

**Spec:** `docs/specs/2026-11-20-render-trial-access-design.md`

## Global Constraints

- The request-link reply stays identical for known and unknown emails. No link, token or password appears in any response or page.
- Email-off sign-in copy, used verbatim:
  - Intro: `This copy of Open Palate can't send email. Staff: ask an admin to copy a sign-in link for you. Admins and editors: your link goes to the server log.`
  - After submitting: `If that address is on the list, a sign-in link was written to the server log (on Render: Logs, search for "Sign-in link for"). It works once and expires in 15 minutes.`
- `BASE_URL` order: `BASE_URL` → `RENDER_EXTERNAL_URL` → `http://localhost:8000`. The INFO log line is for the Render fallback; the WARNING stays only for localhost.
- The Copy sign-in link block for admins and editors is unchanged.
- No flavor-wheel publisher names outside the README's Flavor wheel section and `content/lexicon.json`'s `attribution`.

## Review Focus

1. **`RENDER_EXTERNAL_URL` with a trailing slash** must still give a `BASE_URL` with no trailing slash. Task 1: `test_render_external_url_trailing_slash_trimmed`.
2. **An empty `BASE_URL=""`** (as some hosts set it) must fall through to the Render URL, not to localhost. Task 1: `test_empty_base_url_uses_render_external_url`.
3. **`setup-status` failing** (network or 429) must leave the sign-in page usable with today's wording. Task 2: `keeps the email wording when setup-status fails`.
4. **`SMTP_HOST` set to an empty string** counts as email off. Task 2: `test_setup_status_email_false_when_smtp_host_blank`.
5. **The paid blueprint** must keep its disk, image and `BASE_URL` prompt after the rename. Task 3, Step 2: diff check.

---

### Task 1: `BASE_URL` falls back to `RENDER_EXTERNAL_URL`

**Files:**
- Modify: `config.py:115-125` (`load_config`)
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `load_config(env)["BASE_URL"]`, which later tasks don't call directly. The free blueprint relies on it.

- [ ] **Step 1: Write the failing tests** in `tests/test_config.py`, next to `test_base_url_defaults_to_localhost`:
```python
def test_render_external_url_used_when_base_url_unset(tmp_path, caplog):
    env = sqlite_env(tmp_path); del env["BASE_URL"]
    env["RENDER_EXTERNAL_URL"] = "https://open-palate-trial-ab12.onrender.com"
    with caplog.at_level(logging.INFO):
        config = load_config(env)
    assert config["BASE_URL"] == "https://open-palate-trial-ab12.onrender.com"
    assert not [r for r in caplog.records if r.levelno == logging.WARNING and "BASE_URL" in r.getMessage()]
    assert any("RENDER_EXTERNAL_URL" in r.getMessage() for r in caplog.records if r.levelno == logging.INFO)

def test_base_url_wins_over_render_external_url(tmp_path):
    env = sqlite_env(tmp_path)   # BASE_URL=http://localhost
    env["RENDER_EXTERNAL_URL"] = "https://x.onrender.com"
    assert load_config(env)["BASE_URL"] == "http://localhost"

def test_render_external_url_trailing_slash_trimmed(tmp_path):
    env = sqlite_env(tmp_path); del env["BASE_URL"]
    env["RENDER_EXTERNAL_URL"] = "https://x.onrender.com/"
    assert load_config(env)["BASE_URL"] == "https://x.onrender.com"

def test_empty_base_url_uses_render_external_url(tmp_path):
    env = sqlite_env(tmp_path); env["BASE_URL"] = ""
    env["RENDER_EXTERNAL_URL"] = "https://x.onrender.com"
    assert load_config(env)["BASE_URL"] == "https://x.onrender.com"
```
- [ ] **Step 2: Run them.** `.venv/bin/pytest tests/test_config.py -q`. Expected: the first, third and fourth fail; the second passes.
- [ ] **Step 3: Implement it in `load_config`.** Use `base_url = env.get("BASE_URL") or env.get("RENDER_EXTERNAL_URL")`, with an INFO log line naming `RENDER_EXTERNAL_URL` when that branch is taken. Keep the existing WARNING and localhost default for when neither is set. Also check `app.py:26-31`, which reads `BASE_URL` from `config` overrides: make sure it doesn't re-default.
- [ ] **Step 4: Run the whole backend suite.** `.venv/bin/pytest -q`. Expected: all pass, including `test_base_url_defaults_to_localhost`.
- [ ] **Step 5: Commit:** `Config: BASE_URL falls back to Render's RENDER_EXTERNAL_URL`.

### Task 2: The sign-in page says when email is off

**Files:**
- Modify: `identity/auth_routes.py:153-161` (`setup_status`)
- Modify: `frontend/src/auth/SignInPage.jsx`
- Test: `tests/identity/test_setup_open.py` (or a new `tests/identity/test_setup_status.py`, if the fixtures there don't fit)
- Test: `frontend/src/auth/__tests__/SignInPage.test.jsx`

**Interfaces:**
- Produces: `GET /api/auth/setup-status` → `{"needed": bool, "email": bool, ...}`. `email` is present in both branches and true exactly when `SMTP_HOST` is a non-empty string.

- [ ] **Step 1: Write the failing backend tests.**
  - `test_setup_status_reports_email_before_setup`: with `SMTP_HOST` unset, and no admin, the body has `email` false and `needed` true.
  - `test_setup_status_reports_email_after_setup`: with `SMTP_HOST="smtp.example.test"` in the app config and an admin present, the body equals `{"needed": False, "email": True}`.
  - `test_setup_status_email_false_when_smtp_host_blank`: with `SMTP_HOST=""`, `email` is false.
  - Use the existing app or world fixtures, and set `SMTP_HOST` through `app.config`.
- [ ] **Step 2: Run them.** `.venv/bin/pytest tests/identity -q -k setup_status`. Expected: FAIL (`KeyError: 'email'`).
- [ ] **Step 3: Implement it.** `setup_status` adds `"email": bool(current_app.config.get("SMTP_HOST"))` to both returns.
- [ ] **Step 4: Write the failing frontend tests** in `SignInPage.test.jsx`. Mock `api.get` per test.
  - `says email is off and where links go`: `api.get` resolves `{ data: { needed: false, email: false } }`. The intro shows the exact email-off intro. After submitting, `sent-note` has the exact email-off post-submit text.
  - `keeps the email wording when email is on`: resolves `{ data: { needed: false, email: true } }`. The intro reads `Sign in with your email. We send a one-time link.`, and `sent-note` matches `/a sign-in link is on its way/`.
  - `keeps the email wording when setup-status fails`: `api.get` rejects. The page renders today's intro, and submitting still works.
  - The existing `shows the same message for any email` keeps passing. Set `api.get` to resolve `email: true` in `beforeEach`.
- [ ] **Step 5: Run them.** `cd frontend && npx vitest run src/auth/__tests__/SignInPage.test.jsx`. Expected: the new email-off test fails.
- [ ] **Step 6: Implement it in `SignInPage.jsx`.** On mount, call `api.get('/auth/setup-status')` once. Hold `emailOff` (true only when `data.email === false`), and ignore errors. Swap the intro and `sent-note` text when `emailOff` is set. The form, the POST and the error handling are unchanged.
- [ ] **Step 7: Run both suites and the build.** `.venv/bin/pytest -q`, then `cd frontend && npx vitest run && npm run build`. Expected: all pass, and the build succeeds.
- [ ] **Step 8: Commit:** `Sign-in page says when email isn't set up and where links go`.

### Task 3: Blueprints, README and docs

**Files:**
- Rename: `render.yaml` → `render.paid.yaml` (`git mv`)
- Rename: `render.free.yaml` → `render.yaml` (`git mv`)
- Modify: `README.md` (env table `BASE_URL` row, "Deploy to Render", "Free trial on Render")
- Modify: `CLAUDE.md:7`
- Modify: `docs/spec.md` (any `render.yaml` mention)

- [ ] **Step 1: Do the renames in that order,** with two `git mv` commands.
- [ ] **Step 2: Edit the new `render.yaml` (free).**
  - Remove the `BASE_URL` entry.
  - Add `- key: SETUP_PASSWORD` with `generateValue: true` and a comment: "copy it from the service's Environment page into the setup page".
  - Update the header comment: this is the default trial blueprint the Deploy button uses, and `render.paid.yaml` is for real use.
  - Then confirm the paid file is untouched apart from its header: `git diff -M HEAD -- render.paid.yaml` shows only header-comment changes. Its disk, `image`, `plan: starter` and `BASE_URL` `sync: false` must still be there. The header should name itself `render.paid.yaml` and say to set Blueprint Path to it.
- [ ] **Step 3: Check that both files parse.**
  `ruby -ryaml -e 'YAML.load_file("render.yaml"); YAML.load_file("render.paid.yaml"); puts :ok'`
  Expected: `ok`.
- [ ] **Step 4: Update the README.**
  - **Env table, `BASE_URL` row:** add "On Render, defaults to the service's own address (`RENDER_EXTERNAL_URL`)".
  - **"Deploy to Render":** the paid steps now name `render.paid.yaml`, with a Blueprint Path note and one line saying a Blueprint made from the old `render.yaml` must switch its path.
  - **"Free trial on Render":**
    - Render's standard badge, linking to `https://render.com/deploy?repo=https://github.com/jwgerber/open-palate`, followed by "(works once this repository is public)".
    - Steps: click, wait for the build, copy `SETUP_PASSWORD` from Environment, open the app, create the first admin.
    - Keep the existing limits list.
  - **New "Getting back in" bullets:**
    - Staff: ask an admin to use Copy sign-in link in Group settings.
    - Admins and editors: request a link on the sign-in page, then open Render › Logs and search for "Sign-in link for". Only the person who deployed can see the logs.
    - Tablets: device code.
- [ ] **Step 5: Update `CLAUDE.md:7` and `docs/spec.md`** so they name both blueprints: `render.yaml` is the free trial and Deploy-button default, and `render.paid.yaml` is the paid one with a disk.
- [ ] **Step 6: Run the name scan.** `.venv/bin/pytest tests/tasting/test_content.py -q`. Expected: pass.
- [ ] **Step 7: Commit:** `Render: free trial is the default render.yaml with a Deploy button; paid moves to render.paid.yaml`.

### Final: whole-branch review

Full tier: one fresh reviewer over the branch (`superpowers:requesting-code-review`), then fix Critical and Important findings, each with a failing test first.

## Ship Checklist

- [ ] Third-party config: the `open-palate-trial` Blueprint tracks `main`. **Merge first**, then straight away change its **Blueprint Path** from `render.free.yaml` to `render.yaml`. Doing it before the merge would point it at main's old `render.yaml`, the paid blueprint, and could start a paid service. The one sync in between fails harmlessly, because `render.free.yaml` is gone. Then review and approve the new sync, which adds `SETUP_PASSWORD` and leaves the existing service and database in place.
- [ ] Migration: none.
- [ ] Env vars: none required. The trial keeps its `BASE_URL`, which still wins; its next sync adds a generated `SETUP_PASSWORD`, which is harmless because an admin exists.
- [ ] Smoke: after merge, the trial redeploys. `/healthz` returns `{"ok":true}`, the sign-in page shows the email-off intro, and requesting a link for your email puts "Sign-in link for" in Render's logs. Once the repo is public, click the README button from a logged-out browser and check that Render proposes the free web service and database.
- [ ] Docs: README, CLAUDE.md:7, `docs/spec.md` (Task 3).
