# Security

Please report vulnerabilities privately, not in a public issue: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and the version or commit.

You'll get a reply within a week. Fixes go into the next release, and reporters are credited unless they'd rather not be.

Only the latest release is supported.

## Areas of most concern

- Sign-in links and sessions (`identity/`). Links carry a token, so logs must never record query strings.
- Blind tastings: no scores or coffee identities may reach any client, the host included, before a flight is closed.
- The first-admin setup page, which must stay closed once an admin exists.
