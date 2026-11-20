# Contributing

Thanks for helping. Small, focused pull requests are easiest to review. For anything bigger than a bug fix, open an issue first so we can agree on the approach.

## Run it

```sh
./scripts/dev.sh
```

That installs dependencies on first run, migrates a SQLite database in `instance/`, and serves the app at http://localhost:5173. The README's Development section has the manual steps.

## Test it

```sh
.venv/bin/pytest
cd frontend && npx vitest run
```

Set `TEST_DATABASE_URL=postgresql://...` to run the backend tests on Postgres. CI runs the backend on SQLite and Postgres, plus the frontend tests and build, on every pull request.

Add a test with each change: one that fails before your fix and passes after.

## Rules that keep the app trustworthy

- **Blind stays blind.** No scores or coffee identities reach any client, the host included, before a flight is closed. Reveal returns 409 while a flight is open.
- **Consensus needs at least three tasters** (`CONSENSUS_THRESHOLD = 3`).
- **One person gets one read per cup**, however they signed in.
- **Shared-tablet checks branch on `actor.kind`**, never on whether a `user_id` is present.
- **Logs never record query strings**, because sign-in links carry a token.
- **The flavor-wheel lexicon (`content/lexicon.json`) is fixed.** It matches the published wheel; don't edit its terms, order or structure.

## Database changes

Schema changes need an Alembic migration in `migrations/` that works on both SQLite and Postgres. `tests/test_migrations.py` checks it.

## License

Open Palate is licensed under the AGPL-3.0. By opening a pull request you agree that your contribution is released under the same license.
