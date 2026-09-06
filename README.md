# OpenRouter Account Status

A Chrome extension that displays your OpenRouter account status directly in a popup — **no API key required**. Just click the icon and see your balance, usage, and model costs at a glance.

![Extension Screenshot](screenshot.avif)

## Features

- **Account Balance** — See your current credit balance in real-time
- **Multi-Period Usage Tracking** — View spending for 15 min, 1 hour, 3 hours, today, this week, and this month
- **Usage by Model** — Interactive bar chart showing per-model costs, powered by Chart.js
- **Quick Login** — Detects if you're not signed in and provides a direct link to log in
- **Quick Links** — Jump directly to OpenRouter's activity page or key management

## How It Works

The extension retrieves account information directly from <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">openrouter.ai</a> using your existing signed-in browser session — **no API key or token needed**. Account information is transmitted only between the extension and OpenRouter; nothing is sent to any server operated by the extension author.

### Data Sources

| Data | Source |
|------|--------|
| User info (name, email, avatar) | `/api/frontend/v1/private/users/current` |
| Account balance | Scraped from `/settings/credits` page |
| Usage by model & period | `/api/frontend/v1/private/analytics-query` (POST) |

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `openrouter_extension` folder
6. The OpenRouter icon appears in your toolbar

### Usage

1. Log in to <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">openrouter.ai</a> in Chrome
2. Click the OpenRouter extension icon in the toolbar
3. Your account status loads automatically

> **Note:** You must be logged in to OpenRouter in your Chrome browser for the extension to work.

## Permissions

| Permission | Purpose |
|------------|---------|
| `host_permissions: openrouter.ai/*` | Retrieve account information from OpenRouter using your existing signed-in browser session |

The extension does not extract, store, or transmit authentication cookies to any server. It only communicates with `openrouter.ai` and does not collect or transmit any data to third parties.

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks)
- CSS custom properties for theming
- Background service worker for API calls
- <a href="https://www.chartjs.org/" target="_blank" rel="noopener noreferrer">Chart.js</a> with DataLabels plugin (bundled locally)

## Project Structure

```
openrouter_extension/
├── manifest.json                              # Extension manifest (MV3)
├── background.js                              # Service worker — handles all API calls
├── popup.html                                 # Popup UI
├── popup.css                                  # Dark theme styling
├── popup.js                                   # Popup logic & data fetching
├── lib/
│   ├── chart.umd.min.js                      # Chart.js (local)
│   └── chartjs-plugin-datalabels.min.js       # DataLabels plugin (local)
└── icons/
    ├── icon16.png                             # Toolbar icon (16x16)
    ├── icon48.png                             # Extensions page icon (48x48)
    └── icon128.png                            # Store icon (128x128)
```

## Privacy

- ✅ No data is collected, stored on external servers, or sent to third parties
- ✅ No API keys, tokens, or authentication cookies are extracted or stored
- ✅ Only communicates with `openrouter.ai`
- ✅ Uses your existing browser session (no additional login required)
- ✅ Account information is used only to display the account status in the extension popup
- ✅ Open source — inspect the code yourself
- ✅ <a href="https://ciobanut.com/works/openrouter-extension/privacy-policy/" target="_blank" rel="noopener noreferrer">Full Privacy Policy</a>

## License

MIT
