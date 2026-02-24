# Jira Sprint Goal Display - Chrome Extension

A Chrome extension that fixes [JRACLOUD-93338](https://jira.atlassian.com/browse/JRACLOUD-93338) by displaying the active sprint goal directly on the Jira board, instead of hiding it behind the "Sprint Details" button.

## Features

- Automatically detects Jira board pages (new navigation and classic layouts)
- Fetches the active sprint goal via the Jira Agile REST API
- Displays a banner at the top of the board with the sprint name, goal, and days remaining
- Days-remaining badge changes color based on urgency (green / amber / red)
- Collapsible banner (state remembered across sessions)
- Enable/disable toggle in the extension popup
- Dark mode support

## Installation (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Browse to and select the `SprintGoal` folder (this folder)
5. The extension icon (teal lightning bolt) should appear in the Chrome toolbar

## Testing

1. After loading the extension, navigate to any Jira Cloud Scrum board with an active sprint, e.g.:
   ```
   https://<your-org>.atlassian.net/jira/software/projects/<KEY>/boards/<boardId>
   ```
2. You should see a banner appear at the top of the board displaying the sprint goal
3. If the sprint has no goal set, the banner will show "No sprint goal set" in italic

### Things to verify

- **Banner appears**: Navigate to an active sprint board and confirm the banner renders with the correct sprint name and goal
- **Days remaining**: Check that the badge shows the correct number of days left, and uses green (>5 days), amber (3-5 days), or red (<=2 days)
- **Collapse/expand**: Click the chevron button on the right side of the banner to collapse it, then refresh the page to confirm it stays collapsed
- **Enable/disable**: Click the extension icon in the toolbar, toggle "Show sprint goal" off, and confirm the banner disappears. Toggle it back on and confirm it returns
- **Navigation**: Navigate away from the board (e.g. to the backlog) and confirm the banner is removed, then navigate back and confirm it reappears
- **No sprint**: Visit a board with no active sprint and confirm no banner appears

## Troubleshooting

- **Banner doesn't appear**: Open DevTools (F12) and check the Console for messages starting with `[Sprint Goal]`. Common issues:
  - The board page hasn't fully loaded yet (the extension retries for up to 10 seconds)
  - The API returned an error (check for 401/403 -- you must be logged into Jira)
  - The board ID couldn't be extracted from the URL
- **After updating the code**: Go to `chrome://extensions/`, find "Jira Sprint Goal Display", and click the refresh icon to reload the extension

## How It Works

1. A **content script** (`content.js`) runs on all `*.atlassian.net` pages
2. It extracts the board ID from the URL using regex (supports both new and classic Jira URL formats)
3. It calls `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` using the browser's existing Jira session cookies (no API token needed)
4. It injects a styled banner into the board DOM showing the sprint name, goal, and days remaining
5. A **background service worker** (`background.js`) detects SPA navigations and notifies the content script to re-check
6. The content script also patches `history.pushState/replaceState` and uses a `MutationObserver` as fallback navigation detection for Jira's single-page app behavior
