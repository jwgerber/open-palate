"""Who may create the first admin: local visitors, a setup password, or SETUP_OPEN."""
import hmac
import ipaddress

from flask import current_app, request

# Explicit list rather than ip.is_private, which also covers documentation and
# other special-use ranges that are not "this network".
_PRIVATE_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "::1/128", "fc00::/7", "fe80::/10",
))


def is_private(addr: str | None) -> bool:
    """True for loopback, RFC 1918, IPv6 unique-local and link-local addresses."""
    if not isinstance(addr, str):
        return False
    try:
        ip = ipaddress.ip_address(addr.strip())
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(ip in network for network in _PRIVATE_NETWORKS if network.version == ip.version)


def is_local_request() -> bool:
    """Both the socket peer (before ProxyFix) and the resolved client are private."""
    original = request.environ.get("werkzeug.proxy_fix.orig", {})
    peer = original.get("REMOTE_ADDR") or request.environ.get("REMOTE_ADDR")
    return is_private(peer) and is_private(request.remote_addr)


def setup_is_open() -> bool:
    """SETUP_OPEN true/false wins; unset means local requests outside a container."""
    switch = current_app.config.get("SETUP_OPEN")
    if switch is not None:  # explicit: True opens to everyone, False never opens
        return bool(switch)
    if current_app.config.get("IN_CONTAINER"):
        return False
    return is_local_request()


def setup_password_ok(value) -> bool:
    expected = current_app.config.get("SETUP_PASSWORD")
    if not expected or not isinstance(value, str):
        return False
    return hmac.compare_digest(value.encode("utf-8"), expected.encode("utf-8"))
