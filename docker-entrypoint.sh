#!/bin/sh
# Runs as root only long enough to make /data writable for the app user
# (a bind mount or a host disk is often root-owned, and a `docker exec` run as
# root can leave root-owned database files), then drops privileges.
# Only /data itself and these exact top-level paths are touched, never anything
# recursively; -h means a symlink is never followed.
set -e
APP_UID=10001

fix_owner() {
    if [ -e "$1" ] || [ -L "$1" ]; then
        if [ "$(stat -c %u "$1")" != "$APP_UID" ]; then
            chown -h "$APP_UID:$APP_UID" "$1"
        fi
    fi
}

if [ "$(id -u)" = "0" ]; then
    for path in /data /data/tasting.db /data/tasting.db-wal /data/tasting.db-shm /data/backups; do
        fix_owner "$path"
    done
    exec setpriv --reuid="$APP_UID" --regid="$APP_UID" --init-groups ./start.sh
fi
exec ./start.sh
