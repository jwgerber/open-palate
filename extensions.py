from flask import request
from flask_limiter import Limiter
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

# In-memory counts, per IP. ProxyFix (PROXY_HOPS) has already put the real
# client address in remote_addr.
limiter = Limiter(key_func=lambda: request.remote_addr or "unknown", storage_uri="memory://")
