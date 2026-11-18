"""Gunicorn settings. Read automatically from the working directory."""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
# Rate limits are counted per worker, in memory (see README), so keep the count small.
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
threads = 4
timeout = 60  # paper-sheet scans call a model and can take a while

# Sign-in links carry a live token in the query string. Log the path only
# (%(U)s), never the request line (%(r)s) or the full path (%(RL)s).
accesslog = "-"
access_log_format = '%(h)s "%(m)s %(U)s" %(s)s %(b)s %(L)ss'
errorlog = "-"
