#!/usr/bin/env bash
# Run Open Palate locally: Flask API on :8000 and the Vite dev server on :5173.
# Installs dependencies on first run, migrates a SQLite database in instance/,
# and stops both servers on Ctrl-C. Open http://localhost:5173.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

PYTHON="$(command -v python3.12 || command -v python3)"

if [ ! -x .venv/bin/python ]; then
    echo "Creating .venv with $PYTHON"
    "$PYTHON" -m venv .venv
    .venv/bin/pip install -r requirements-dev.txt
fi

if [ ! -d frontend/node_modules ]; then
    (cd frontend && npm ci)
fi

mkdir -p instance
export DATABASE_URL="${DATABASE_URL:-sqlite:///$ROOT/instance/dev.db}"
export SECRET_KEY="${SECRET_KEY:-dev}"
export BASE_URL="${BASE_URL:-http://localhost:5173}"

.venv/bin/alembic upgrade head

trap 'kill 0' EXIT
.venv/bin/flask --app "app:create_app()" run --port 8000 &
(cd frontend && npm run dev) &
wait
