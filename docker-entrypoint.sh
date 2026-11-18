#!/bin/sh
# Runs as root only long enough to make /data writable for the app user
# (a bind mount or a host disk is often root-owned), then drops privileges.
# Only /data itself is touched, never its contents or anything else.
set -e
APP_UID=10001
if [ "$(id -u)" = "0" ]; then
    if [ "$(stat -c %u /data)" != "$APP_UID" ]; then
        chown "$APP_UID:$APP_UID" /data
    fi
    exec setpriv --reuid="$APP_UID" --regid="$APP_UID" --init-groups ./start.sh
fi
exec ./start.sh
