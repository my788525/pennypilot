# PennyPilot Privacy Policy

**Effective date:** 2026-08-25
**Extension:** PennyPilot — Tax & Bill Deadline Reminders (Chrome Web Store)
**Publisher:** AllMoneyCalc · Contact: support@allmoneycalc.com
**Published at:** https://allmoneycalc.com/pennypilot-privacy

## 1. Summary
PennyPilot is designed to be **private by default**. It runs entirely on your device and does **not** collect, transmit, or store personal data on any server. The publisher (AllMoneyCalc) never receives your location, reminders, or usage.

## 2. What we store (locally only)
PennyPilot saves the following in your browser's synchronized storage (`chrome.storage.sync` — synced across your signed-in devices):
- Your selected **state** (e.g., "WA").
- Your optional **ZIP code** (used only to resolve more precise, location-aware reminders on your device).
- Notification throttle timestamps (so we don't remind you about the same date twice in 30 days).
- Your "My reminders" entries (names, due dates, and notes you create).
- Your sponsored-content preference (whether to show sponsored offers).

None of this is ever uploaded. There is **no account, no login, and no server**.

## 3. What we do NOT do
- We do **not** track you, show behavioral or targeted ads, or build a profile.
- We do **not** send your location, state, or ZIP to any remote server.
- We do **not** embed third-party trackers or remote code.
- We do **not** read the contents of the web pages you visit (the extension requests no host permissions).

## 4. How reminders work
Reminder dates come from a **bundled dataset** inside the extension (sourced from public U.S. authorities: U.S. Department of Labor, IRS, and state Departments of Revenue). Your device computes which dates are upcoming and shows a badge/notification locally. No network request is made to determine your reminders.

PennyPilot currently makes **no outbound network requests** at all. A future, strictly opt-in update could periodically fetch a small, generic, **public** data-override file (e.g., scam alerts, temporary tax-filing extensions) from our own server. That request would send **no personal data** — only the public file is downloaded and merged into your local reminders. Such a feature would only activate in a version that re-declares the corresponding permission, and remains off by default.

## 4b. Sponsored content
PennyPilot may display **sponsored offers** from third-party advertisers. These are delivered compliantly:
- **Where they appear:** only inside PennyPilot's own panels (popup, side panel, settings). They are **never** injected into the web pages you visit.
- **Labeled:** every sponsored item is clearly marked "Sponsored" / "Ad".
- **Generic, not targeted:** offers are the same for all users. They are **not** selected or ranked using your ZIP, state, life events, or any other data you provide. No advertiser receives any of your information.
- **First-party delivery, no remote code:** creative is served as static data (from our own host or bundled in the extension). No third-party ad SDK or remote script runs — this satisfies the Manifest V3 security model.
- **Your control:** you can turn sponsored offers off at any time in Settings ("Sponsored content"). When off, none are fetched or shown.

If you disable sponsored content, PennyPilot's reminders and tools are fully functional without it.

## 5. Data sources
- U.S. Department of Labor — Wage and Hour Division (minimum wage)
- IRS federal tax calendar
- State Departments of Revenue (individual income-tax deadlines)

All figures are drawn from public authorities and are clearly marked with their source and retrieval date inside the bundled data.

## 6. Children
PennyPilot is not directed to children under 13 and does not knowingly collect their data.

## 7. Changes
If this policy changes, the new version will be posted at https://allmoneycalc.com/pennypilot-privacy with an updated effective date.

## 8. Contact
For privacy questions, contact: **support@allmoneycalc.com**

---
*This policy governs the PennyPilot browser extension published by AllMoneyCalc. It is separate from the AllMoneyCalc website privacy notice.*
