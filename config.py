"""Environment-driven configuration."""
import os

DEFAULT_DATABASE_URL = "sqlite:////data/tasting.db"


def normalize_database_url(url: str) -> str:
    """Hosts hand out plain ``postgresql://`` (or ``postgres://``) URLs; point
    them at the psycopg 3 driver, the one we ship."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def load_config(env=os.environ) -> dict:
    """Read settings from the environment; fail early on required ones."""
    for name in ("SECRET_KEY", "BASE_URL"):
        if not env.get(name):
            raise RuntimeError(f"{name} must be set")
    return {
        "SECRET_KEY": env["SECRET_KEY"],
        "BASE_URL": env["BASE_URL"].rstrip("/"),
        "SQLALCHEMY_DATABASE_URI": normalize_database_url(env.get("DATABASE_URL") or DEFAULT_DATABASE_URL),
        "PROXY_HOPS": int(env.get("PROXY_HOPS", "1")),
    }
