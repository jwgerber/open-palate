"""Sign-in email. SMTP when ``SMTP_HOST`` is set, otherwise the link is logged."""
import logging
import smtplib
from email.message import EmailMessage

from flask import current_app

logger = logging.getLogger(__name__)


def send_signin_email(to: str, link: str) -> None:
    config = current_app.config
    host = config.get("SMTP_HOST")
    if not host:
        # Deliberate: with no SMTP the console is the delivery channel.
        logger.info("Sign-in link for %s: %s", to, link)
        return

    message = EmailMessage()
    message["Subject"] = "Your sign-in link"
    message["From"] = config.get("SMTP_FROM") or config.get("SMTP_USER") or f"noreply@{host}"
    message["To"] = to
    message.set_content(
        "Open this link to sign in. It works once and expires in 15 minutes.\n\n"
        f"{link}\n\nIf you didn't ask for it, ignore this email.\n")

    port = int(config.get("SMTP_PORT") or 587)
    smtp_class = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
    with smtp_class(host, port, timeout=10) as smtp:
        if port != 465:
            smtp.starttls()
        if config.get("SMTP_USER"):
            smtp.login(config["SMTP_USER"], config.get("SMTP_PASSWORD") or "")
        smtp.send_message(message)
