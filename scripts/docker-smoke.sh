#!/usr/bin/env bash
# Smoke-test a built image the way the README runs it: a root-owned bind mount
# for /data, migrations on start, the logged setup link, `flask backup` as uid
# 10001, and a restart that keeps the same data and secret key.
# Usage: scripts/docker-smoke.sh [image]   (default: open-palate:smoke)
# Needs Docker, curl and sudo (to make the root-owned data directory).
set -euo pipefail

IMAGE="${1:-open-palate:smoke}"
NAME="open-palate-smoke-$$"
PORT="${SMOKE_PORT:-8765}"
DATA="$(mktemp -d)/data"
APP_UID=10001

cleanup() {
    status=$?
    if [ "$status" -ne 0 ]; then
        echo "--- container log ---"
        docker logs "$NAME" 2>&1 | tail -50 || true
    fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    sudo rm -rf "$(dirname "$DATA")"
    exit "$status"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

wait_healthy() {
    for _ in $(seq 1 60); do
        if curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -q '"ok":true'; then
            return 0
        fi
        sleep 1
    done
    fail "/healthz did not answer ok within 60s"
}

owner() { sudo stat -c %u "$1"; }

# A bind mount owned by root, as on a fresh host disk: the entrypoint must fix it.
sudo mkdir -p "$DATA"
sudo chown 0:0 "$DATA"

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8000" -v "$DATA:/data" "$IMAGE" >/dev/null
wait_healthy
echo "ok: /healthz"

curl -fsS "http://127.0.0.1:$PORT/" | grep -qi '<div id="root"' || fail "/ did not serve the SPA"
echo "ok: SPA served at /"

docker logs "$NAME" 2>&1 | grep -q "No admin yet. Create the first admin" \
    || fail "setup link not logged"
echo "ok: setup link logged"

[ "$(owner "$DATA")" = "$APP_UID" ] || fail "/data not owned by $APP_UID"
[ "$(owner "$DATA/tasting.db")" = "$APP_UID" ] || fail "tasting.db not owned by $APP_UID"
echo "ok: /data and tasting.db owned by $APP_UID"

docker exec --user "$APP_UID" "$NAME" flask backup
sudo sh -c "ls '$DATA'/backups/tasting-*.db" >/dev/null || fail "flask backup wrote no file"
echo "ok: flask backup"

key_before="$(sudo sha256sum "$DATA/secret_key" | cut -d' ' -f1)"
docker restart "$NAME" >/dev/null
wait_healthy
key_after="$(sudo sha256sum "$DATA/secret_key" | cut -d' ' -f1)"
[ "$key_before" = "$key_after" ] || fail "secret_key changed across restart"
echo "ok: restart keeps secret_key, migrations rerun cleanly"

echo "Docker smoke passed: $IMAGE"
