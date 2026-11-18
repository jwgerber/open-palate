"""Environment-driven configuration."""
import os

DEFAULT_DATABASE_URL = "sqlite:////data/tasting.db"
# Paper-sheet scan models, first one used. Not an env var: change it here.
DEFAULT_SCAN_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")


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
    settings = {
        "SECRET_KEY": env["SECRET_KEY"],
        "BASE_URL": env["BASE_URL"].rstrip("/"),
        "SQLALCHEMY_DATABASE_URI": normalize_database_url(env.get("DATABASE_URL") or DEFAULT_DATABASE_URL),
        "PROXY_HOPS": int(env.get("PROXY_HOPS", "1")),
        "ALLOW_SIGNUP": env.get("ALLOW_SIGNUP", "false").strip().lower() in ("1", "true", "yes"),
        "SMTP_HOST": env.get("SMTP_HOST") or None,
        "SMTP_PORT": int(env.get("SMTP_PORT") or 587),
        "SMTP_USER": env.get("SMTP_USER") or None,
        "SMTP_PASSWORD": env.get("SMTP_PASSWORD") or None,
        "SMTP_FROM": env.get("SMTP_FROM") or None,
        # Optional: the paper-sheet scan is off (404 scan_disabled) without it.
        "ANTHROPIC_API_KEY": env.get("ANTHROPIC_API_KEY") or None,
        "SCAN_MODELS": DEFAULT_SCAN_MODELS,
    }
    # Set by migrations/env.py: the migration process builds the app on a database
    # that may not be migrated yet, and must not log (or fail on) the setup link.
    if env.get("LOG_SETUP_LINK") is not None:
        settings["LOG_SETUP_LINK"] = env["LOG_SETUP_LINK"].strip().lower() in ("1", "true", "yes")
    return settings
