"""Keep sign-in tokens out of access logs.

``GET /api/auth/consume?token=…`` carries a live bearer token in the query
string; werkzeug's access log would record it. Gunicorn's access log is
configured separately (log ``%(U)s``, the path without the query, not
``%(r)s``) — see the deployment docs.
"""
import logging
import re

_TOKEN_IN_QUERY = re.compile(r"([?&]token=)[^&\s\"']+")


class RedactTokenFilter(logging.Filter):
    """Rewrite a record so any ``token=`` query value reads ``[redacted]``."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = _TOKEN_IN_QUERY.sub(r"\1[redacted]", message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


def install(logger_name: str = "werkzeug") -> None:
    """Attach the filter once to the named logger (idempotent)."""
    target = logging.getLogger(logger_name)
    if not any(isinstance(f, RedactTokenFilter) for f in target.filters):
        target.addFilter(RedactTokenFilter())
