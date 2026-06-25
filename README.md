# DataPrime 🛒 - Premium Amazon Transaction & Spending Analyzer

DataPrime is a modern, high-performance Manifest V3 Chrome Extension that scrapes, itemizes, and visualizes your Amazon transaction history. It features a stunning glassmorphic dashboard, a parallel same-site itemization fetch worker pool, and robust invoice scanners.

---

## 🌟 Core Features

### 1. High-Performance Same-Site Scraper Engine
- **Staggered Concurrency Worker Pool**: Employs a concurrent pool (`CONCURRENCY = 5`) inside `content.js` to fetch order invoices in parallel, accelerating itemization by over **500%** (processing 40+ orders in under 20 seconds).
- **Human-Like Jitter Delays**: Naturally spreads the concurrency load with staggered startup sequences and randomized delays (1.8s - 3.2s) between fetches to stay comfortably within Amazon's rate-limiting/WAF boundaries.
- **Visual Feedback Loop HUD**: Renders a beautiful glassmorphic real-time HUD console directly on the active tab, showing active page counts, matched items, and parallel worker operations (e.g. `[Worker 1] Itemizing...`).

### 2. Comprehensive Coverage
- **Amazon Digital Orders & Subscriptions**: Parses `D01-` digital order formats (Kindle, Prime Video, Grocery Subscriptions), generating synthetic unique identifiers and retaining active digital management links.
- **Amazon Fresh & Whole Foods (UFF) Receipts**: Automatically detects grocery transactions and dynamically routes fetch requests to the exact receipt page (`&page=itemmod`) for full list itemization.
- **Split-Shipments & Multiple Charges**: Employs a stateful occurrence counter to track and assign stable occurrence-suffixed unique IDs (e.g. `...-2026-06-01-11.75-0`, `-1`). This records split shipments or identical charges as separate transaction entries while remaining completely duplicate-resistant across subsequent scraper runs.

### 3. Loop Protection Guardrails
- **Disabled Pagination Filter**: Automatically filters out disabled pagination controls (attributes or `.a-disabled` classes) to prevent futile scraper clicking.
- **Page Content Hash Protection**: Compares transaction IDs on each page to the immediate previous page. If identical (indicating a same-page POST reload occurred), the scraper immediately concludes scraping cleanly.
- **Promotional Ad & Advertisement Filtering**: Excludes co-branded credit card advertisement templates (e.g. Amazon Secured Card) and Prime Video recommendation elements from invoice summaries.

### 4. Interactive Glassmorphic Analytics Dashboard
- **Monthly Spend Trends**: Renders custom SVG monthly spend charts and cumulative spend lines on hover.
- **Quick Timeframe Filters**: Stretches across custom presets (7 Days, 30 Days, 90 Days, 12 Months) and precise date-range pickers.
- **Search & Detail Registry Drawers**: Provides full-text search (matching descriptions, card suffixes, order IDs, and itemized product titles) and expanding detail drawers containing product images, sellers, unit prices, and quantities.
- **Data Exporting**: Uses modern, browser-safe transient Blob Object URLs to download large CSV and JSON transaction registries without file corruption or character truncation (e.g. at order `#` identifiers).

---

## 📁 Project Structure

```bash
dataprime/
├── manifest.json         # Manifest V3 extension configuration
├── content.js            # Main page scraping & same-site itemization engine
├── background.js         # Coordinates scrape state, storage, and dashboard tabs
├── Taskfile.yaml         # Project dev & package automation
├── README.md             # Project documentation
├── popup/                # Popup HUD controller
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── dashboard/            # Analytical dashboard pages
    ├── results.html
    ├── results.css
    └── results.js
```

---

## 🛠️ Development Workflow

The development workflow is orchestrated using [go-task](https://taskfile.dev/):

| Task | Command | Purpose |
| :--- | :--- | :--- |
| **Verify Integrity** | `task check` / `task lint` | Validates `manifest.json` structure and checks project file integrity. |
| **Package Extension**| `task build` / `task zip` | Cleans and compiles files into `dataprime-extension.zip`. |

---

## 📥 Installation & Running Live

### 1. Load the Extension Unpacked
1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left.
4. Select the `dataprime/` project root directory.

### 2. Run a Spending Scrape
1. Navigate to your Amazon Payments Transactions page:
   `https://www.amazon.com/cpe/yourpayments/transactions`
2. Click the **DataPrime** extension icon in your browser toolbar.
3. Select a timeframe quick preset (e.g. **7 Days** or **30 Days**) and click **Analyze spending**.
4. Watch the glassmorphic HUD log parallel itemization fetches in real time.
5. Once completed, your browser will automatically open the premium interactive spending dashboard!
