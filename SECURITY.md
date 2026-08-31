# Security policy

Kadr handles screenshots, which regularly contain private data: dashboards, inboxes,
tokens on screen. A bug here is a privacy bug, so it is treated seriously.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button under the Security tab to open a private
advisory. Please do not open a public issue for anything exploitable.

Include what you have: affected version, the page or setup that triggers it, and what an
attacker gets out of it. A proof of concept helps but is not required.

Expect a first response within a few days. If the report is confirmed, the fix ships in
the next release and the advisory is published with credit unless you prefer otherwise.

## Scope

In scope:

- Any path by which a screenshot, its OCR text or an API key leaves the device without the
  user explicitly asking for it.
- API keys or captured data readable by a web page, another extension, or written to
  `chrome.storage.sync`.
- Injected content scripts running on pages the user did not act on.
- Escalation of the optional host permission (`<all_urls>`) without a user gesture: the
  extension must never end up holding access to a site the user did not grant it by button.

Out of scope:

- Documented platform limits, such as `chrome://` pages not being capturable or the two
  frames per second Chrome allows a tab capture.
- Findings that require the user to install a malicious extension or run code in their own
  browser console.

## Design commitments

- Settings and API keys live in `chrome.storage.local`, never in `chrome.storage.sync`,
  so they are not synced to a cloud account.
- The extension issues no network request unless the user explicitly runs an AI action;
  those go straight to the provider the user configured. There is no Kadr backend.
- AI is off by default, and the payload is shown before the first request leaves the device.
