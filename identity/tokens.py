"""Random bearer tokens. Only the sha256 digest is ever stored."""
import hashlib
import secrets


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_token() -> tuple[str, str]:
    """Return ``(raw, sha256_hex)``; hand out the raw value, store the digest."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)
