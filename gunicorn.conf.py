"""Gunicorn settings. Read automatically from the working directory."""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"

# SQLite allows one writer at a time, so default to one worker with many
# threads there; Postgres gets two workers. Both are overridable.
# Rate limits are counted per worker, in memory (see README).
_database_url = os.environ.get("DATABASE_URL") or "sqlite:"
_is_sqlite = _database_url.startswith("sqlite")
workers = int(os.environ.get("WEB_CONCURRENCY") or (1 if _is_sqlite else 2))
threads = int(os.environ.get("GUNICORN_THREADS") or (8 if _is_sqlite else 4))
timeout = 60  # paper-sheet scans call a model and can take a while

# Sign-in links carry a live token in the query string. Log the path only
# (%(U)s), never the request line (%(r)s) or the full path (%(RL)s).
accesslog = "-"
access_log_format = '%(h)s "%(m)s %(U)s" %(s)s %(b)s %(L)ss'
errorlog = "-"
