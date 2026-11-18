#!/bin/sh
# Container entrypoint: bring the schema up to date, then serve.
# Gunicorn's access log is configured in gunicorn.conf.py to omit query
# strings, because sign-in links carry a token there.
set -e
alembic upgrade head
exec gunicorn --config gunicorn.conf.py "app:create_app()"
