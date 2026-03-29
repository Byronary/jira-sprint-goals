# Jira Sprint Goal Display — Chrome Extension

A Chrome extension that addresses [JRACLOUD-93338](https://jira.atlassian.com/browse/JRACLOUD-93338) by showing the active sprint goal on the Jira board instead of only behind Jira’s sprint-details UI.

## Features

- Detects Jira board pages (new navigation and classic URL patterns)
- Loads the active sprint via the Jira Agile REST API (`sprint?state=active`) using your existing session (no API token)
- Renders a **compact card** in the board header (new nav: inside `data-testid="horizontal-nav-header.ui.board-header.header"`, inserted before the rightmost header block so it sits with the board actions area)
- Card shows sprint name, goal text, and **days left** (weekdays from tomorrow through the day before sprint end, aligned with Jira’s sprint popup)
- If you open Jira’s own sprint-details dialog, the extension can **replace** the displayed days text with the value scraped from that dialog (optional sync)
- Days-left styling uses urgency colors: green (&gt;5), amber (3–5), red (≤2)
- Enable/disable toggle in the extension popup (`jsg-enabled` in `chrome.storage.local`)
- Light/dark styling: prefers Jira’s `html[data-color-mode="dark"]`, with `prefers-color-scheme` as fallback when Jira does not set `data-color-mode`

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`SprintGoal`)
5. Pin the extension from the puzzle menu if you want quick access to the popup

## Testing

1. Load the extension, then open a Jira Cloud Scrum board with an active sprint, for example:
   ```
   https://<your-org>.atlassian.net/jira/software/projects/<KEY>/boards/<boardId>
   ```
2. On **Active sprints** (or equivalent board view), you should see the sprint goal **card** in the header row (not a full-width strip above the board columns).
3. If the sprint has no goal, the card shows *No sprint goal set*.

### Things to verify

- **Card appears** with the correct sprint name and goal on a board that has an active sprint
- **Days left** matches Jira’s sprint-details popup for typical cases (weekday count); opening the popup may refresh the label if it differed
- **Urgency colors**: green (&gt;5 weekdays), amber (3–5), red (≤2)
- **Enable/disable**: Open the extension popup, turn **Show sprint goal** off — the card should disappear; turn it on — it should return
- **Navigation**: Leave the board (e.g. backlog) and confirm the card is gone; return to the board and confirm it comes back
- **No active sprint**: Board with no active sprint should show no card

## Troubleshooting

- **Card doesn’t appear**: Open DevTools (F12) → Console. Look for `[Sprint Goal]` warnings (e.g. API errors).
  - Jira may still be rendering the header; the script retries insertion for up to **10 seconds** (20 × 500 ms).
  - **401/403**: You must be logged into the same Atlassian site in that tab.
  - **Wrong URL**: The board ID must be present in the URL (new nav path or classic `rapidView=`).
- **After code changes**: On `chrome://extensions/`, use **Reload** on *Jira Sprint Goal Display*.

## How it works

1. **Content script** (`content.js`) + **styles** (`styles.css`) run on `*://*.atlassian.net/*` at `document_idle` (see `manifest.json`).
2. **Board ID** is parsed from the URL (new: `/jira/software/projects/.../boards/{id}`, classic: `rapidView=`).
3. **API**: `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` with `credentials: 'same-origin'`.
4. **DOM**: Prefer inserting the card into `horizontal-nav-header.ui.board-header.header` before its last child; otherwise fall back to `#ghx-content-main`, software board containers, or `main`.
5. **Days left**: `businessDaysRemaining(endDate)` counts Mon–Fri strictly between “tomorrow” and the sprint end date (end date normalized to local midnight). A **MutationObserver** watches for Jira’s sprint dialog (`[role="dialog"][aria-label*="active sprint" i]`) and updates the label if a scraped string differs.
6. **Background** (`background.js`): `webNavigation` on `*.atlassian.net` notifies the tab to re-run injection after SPA navigations.
7. **History**: `pushState` / `replaceState` are wrapped and `popstate` is listened to; a **MutationObserver** re-injects if the card node disappears after Jira re-renders.
8. **Popup** (`popup.html` / `popup.js`): toggles visibility and sends `jsg-toggle` to the active tab.

## Project layout

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, host permission for `*.atlassian.net` |
| `content.js` | URL parsing, API fetch, card DOM, days logic, observers |
| `styles.css` | Card layout, urgency colors, Jira theme hooks, header overflow tweaks |
| `background.js` | Navigation messages to content script |
| `popup.html` / `popup.js` | Enable/disable UI |
| `icons/` | Toolbar / store icons |
