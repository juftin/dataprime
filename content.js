/**
 * DataPrime Content Scraper Script
 * Runs in the context of: https://www.amazon.com/cpe/yourpayments/transactions
 */

console.log("DataPrime Scraper content script loaded!");

// Signal background service worker that content script is loaded and active
chrome.runtime.sendMessage({ action: "CONTENT_SCRIPT_READY" });

// Handle automatic redirect recovery from Amazon overview landing page
if (window.location.href.includes("/cpe/yourpayments/overview")) {
  chrome.storage.local.get("activeScrapeSession", (data) => {
    if (data && data.activeScrapeSession && data.activeScrapeSession.active) {
      console.log(
        "DataPrime: Active scraping session detected on overview page. Redirecting back to transactions list...",
      );
      window.location.href =
        "https://www.amazon.com/cpe/yourpayments/transactions";
    }
  });
}

// Active scraping state
let scrapingState = {
  active: false,
  startDate: null,
  endDate: null,
  scrapedTransactions: [],
  pageCount: 0,
  fetchItemized: true,
  occurrenceCounts: {},
  lastPageTransactionBaseKeys: null,
  consecutiveEmptyPages: 0,
};

// ==========================================
// REAL-TIME VISUAL HUD LOGGING SYSTEM
// ==========================================
let hudElement = null;
let hudConsole = null;

function ensureHUD() {
  if (hudElement) return;

  hudElement = document.createElement("div");
  hudElement.id = "dataprime-hud";
  hudElement.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    width: 340px;
    background: rgba(11, 15, 25, 0.9);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.15);
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    z-index: 2147483647;
    padding: 18px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 10px;
    margin-bottom: 14px;
  `;
  header.innerHTML = `
    <span style="font-weight: 700; font-size: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">DataPrime Scraper</span>
    <span id="pl-hud-status" style="font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 9999px; background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.25);">IDLE</span>
  `;
  hudElement.appendChild(header);

  const stats = document.createElement("div");
  stats.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  `;
  stats.innerHTML = `
    <div style="background: rgba(255, 255, 255, 0.02); border-radius: 10px; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.04); text-align: center;">
      <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 2px;">Active Page</div>
      <div id="pl-hud-page" style="font-size: 20px; font-weight: 800; color: #f1f5f9; text-shadow: 0 0 10px rgba(255,255,255,0.1);">0</div>
    </div>
    <div style="background: rgba(255, 255, 255, 0.02); border-radius: 10px; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.04); text-align: center;">
      <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 2px;">Scraped Items</div>
      <div id="pl-hud-matches" style="font-size: 20px; font-weight: 800; color: #f1f5f9; text-shadow: 0 0 10px rgba(255,255,255,0.1);">0</div>
    </div>
  `;
  hudElement.appendChild(stats);

  const consoleTitle = document.createElement("div");
  consoleTitle.style.cssText = `
    color: #94a3b8;
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  `;
  consoleTitle.innerText = "Scraper Feedback Loop Logs";
  hudElement.appendChild(consoleTitle);

  hudConsole = document.createElement("div");
  hudConsole.id = "pl-hud-console";
  hudConsole.style.cssText = `
    height: 120px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 10px;
    padding: 10px;
    overflow-y: auto;
    font-family: "Fira Code", Monaco, Consolas, "Ubuntu Mono", monospace;
    font-size: 11px;
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.04);
    line-height: 1.4;
  `;
  hudElement.appendChild(hudConsole);

  const stopButton = document.createElement("button");
  stopButton.style.cssText = `
    width: 100%;
    margin-top: 14px;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    border: none;
    border-radius: 10px;
    color: white;
    padding: 10px;
    font-weight: 700;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
  `;
  stopButton.innerText = "Cancel Analysis";
  stopButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "STOP_SCRAPE" });
    removeHUD();
  });
  stopButton.addEventListener("mouseenter", () => {
    stopButton.style.opacity = "0.9";
  });
  stopButton.addEventListener("mouseleave", () => {
    stopButton.style.opacity = "1";
  });
  hudElement.appendChild(stopButton);

  document.body.appendChild(hudElement);
}

function removeHUD() {
  if (hudElement) {
    hudElement.remove();
    hudElement = null;
    hudConsole = null;
  }
}

function logToHUD(msg) {
  ensureHUD();
  console.log("[DataPrime HUD]", msg);
  if (hudConsole) {
    const logLine = document.createElement("div");
    logLine.style.cssText =
      "margin-bottom: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.02); padding-bottom: 3px; word-break: break-all;";
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    logLine.innerHTML = `<span style="color: #818cf8; font-weight: 600;">[${timestamp}]</span> ${msg}`;
    hudConsole.appendChild(logLine);
    hudConsole.scrollTop = hudConsole.scrollHeight;
  }
}

function updateHUDStatus(status, page, matches) {
  ensureHUD();
  const statusEl = document.getElementById("pl-hud-status");
  const pageEl = document.getElementById("pl-hud-page");
  const matchesEl = document.getElementById("pl-hud-matches");

  if (statusEl) {
    statusEl.innerText = status;
    if (status === "ERROR") {
      statusEl.style.background = "rgba(239, 68, 68, 0.15)";
      statusEl.style.color = "#f87171";
      statusEl.style.borderColor = "rgba(239, 68, 68, 0.25)";
    } else if (status === "COMPLETED") {
      statusEl.style.background = "rgba(16, 185, 129, 0.15)";
      statusEl.style.color = "#34d399";
      statusEl.style.borderColor = "rgba(16, 185, 129, 0.25)";
    } else {
      statusEl.style.background = "rgba(99, 102, 241, 0.15)";
      statusEl.style.color = "#818cf8";
      statusEl.style.borderColor = "rgba(99, 102, 241, 0.25)";
    }
  }
  if (pageEl) pageEl.innerText = page;
  if (matchesEl) matchesEl.innerText = matches;
}

let isStorageChecked = false;
let pendingStartRequest = null;

function handleStartScrape(request, sendResponse) {
  if (scrapingState.active) {
    sendResponse({ status: "ALREADY_RUNNING" });
    return;
  }

  scrapingState.active = true;
  scrapingState.startDate = request.startDate || null;
  scrapingState.endDate = request.endDate || null;
  scrapingState.fetchItemized = request.fetchItemized !== false;
  scrapingState.scrapedTransactions = [];
  scrapingState.pageCount = 0;
  scrapingState.occurrenceCounts = {};
  scrapingState.lastPageTransactionBaseKeys = null;
  scrapingState.consecutiveEmptyPages = 0;

  // Persist immediately on start, then respond and run the loop
  saveSessionState().then(() => {
    sendResponse({ status: "STARTED" });
    startScrapingLoop();
  });
}

// On startup, check if we have a saved active scraping session (to resume across page POST submissions)
chrome.storage.local.get("activeScrapeSession", (data) => {
  isStorageChecked = true;
  if (data && data.activeScrapeSession && data.activeScrapeSession.active) {
    console.log("Resuming active scraping session from storage...");
    scrapingState = data.activeScrapeSession;

    // Render feedback loop HUD
    ensureHUD();
    updateHUDStatus(
      "RUNNING",
      scrapingState.pageCount,
      scrapingState.scrapedTransactions.length,
    );
    logToHUD("Resuming active scraping session from storage...");

    // Discard any pending start requests since we are already resuming
    if (pendingStartRequest) {
      pendingStartRequest.sendResponse({ status: "ALREADY_RUNNING" });
      pendingStartRequest = null;
    }

    startScrapingLoop();
  } else {
    // If we received a START_SCRAPE message while we were reading storage, process it now!
    if (pendingStartRequest) {
      handleStartScrape(
        pendingStartRequest.request,
        pendingStartRequest.sendResponse,
      );
      pendingStartRequest = null;
    }
  }
});

// Helper to persist scraping session
function saveSessionState() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ activeScrapeSession: scrapingState }, () => {
      resolve();
    });
  });
}

// Helper to remove scraping session
function clearSessionState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove("activeScrapeSession", () => {
      resolve();
    });
  });
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING") {
    sendResponse({ status: "ALIVE" });
    return true;
  }

  if (request.action === "START_SCRAPE") {
    if (!isStorageChecked) {
      pendingStartRequest = { request, sendResponse };
      return true;
    }
    handleStartScrape(request, sendResponse);
    return true;
  }

  if (request.action === "STOP_SCRAPE") {
    scrapingState.active = false;
    clearSessionState().then(() => {
      sendResponse({
        status: "STOPPED",
        data: scrapingState.scrapedTransactions,
      });
    });
    return true;
  }
});

/**
 * Main scraping loop that handles pagination
 */
/**
 * Stateful helper to wait for the Amazon async widget to complete rendering transactions
 */
async function waitForTransactions(maxWaitMs = 12000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const elements = document.querySelectorAll(
      '.apx-transactions-line-item-component-container, .apx-transactions-line-item, .apx-transaction-line-item, [id^="apx-transactions-line-item-"]',
    );
    if (elements.length > 0) {
      console.log(`Transactions rendered after ${Date.now() - startTime}ms`);
      return true;
    }
    // Check if there is an empty transaction alert visible
    const alertEl = document.getElementById("missingTransactionAlert");
    if (alertEl && !alertEl.classList.contains("aok-hidden")) {
      console.log("Empty transaction notification detected");
      return false;
    }
    await sleep(500);
  }
  console.log("Timed out waiting for transactions to render");
  return false;
}

/**
 * Polls for an AJAX in-place DOM update after clicking the Next Page button.
 * Returns true if the transaction list content changed, false on timeout.
 */
async function pollForAjaxUpdate(previousFirstText) {
  const startTime = Date.now();

  while (Date.now() - startTime < 12000) {
    await sleep(500);

    // If the page is in the middle of a full reload, this loop will be aborted naturally.
    const newElements = document.querySelectorAll(
      ".apx-transactions-line-item-component-container",
    );
    if (newElements.length > 0) {
      const newFirstText = (newElements[0].innerText || "").trim();

      // Verify that it is a fully loaded transaction card (has '$') and differs from the previous one
      if (newFirstText && newFirstText.includes("$")) {
        if (newFirstText !== previousFirstText) {
          logToHUD(
            "AJAX DOM update detected! Card content changed successfully.",
          );
          return true;
        }
        logToHUD(
          "AJAX poll: DOM elements are still showing old page transactions...",
        );
      } else {
        logToHUD(
          "AJAX poll: DOM is in a transient loading state (no dollar amount parsed)...",
        );
      }
    } else {
      logToHUD(
        "AJAX poll: Transaction list is empty or rendering skeletons...",
      );
    }
  }

  logToHUD("No AJAX DOM update detected within 12s.");
  return false;
}

/**
 * Main scraping loop that handles pagination via a while loop.
 * For AJAX-based pagination, iterates in-process. For full-page POST
 * navigation, exits and relies on storage-resume to restart the loop.
 */
async function startScrapingLoop() {
  try {
    if (!scrapingState.active) return;

    // Verify we are starting from the first page of transactions (Previous Page is disabled or absent)
    if (scrapingState.pageCount === 0) {
      const prevButton = findPreviousButton();
      if (prevButton) {
        logToHUD(
          "Verification failed: Scraping must start from Page 1 (Previous Page is clickable).",
        );
        console.log(
          "DataPrime Scraper: Previous Page button is active. Blocking start to ensure page 1 integrity.",
        );
        notifyError(
          "Analysis must start from the first page of your Amazon transactions list. Please navigate to Page 1 and try again.",
        );
        scrapingState.active = false;
        await clearSessionState();
        return;
      }
    }

    const MAX_EMPTY_PAGES = 3;
    const MAX_TOTAL_PAGES = 200;

    while (scrapingState.active) {
      scrapingState.pageCount++;

      // Clear any previous occurrence count records for the new page to prevent duplicate count incrementing on re-scrapes/reloads
      if (!scrapingState.occurrenceCounts) {
        scrapingState.occurrenceCounts = {};
      }
      scrapingState.occurrenceCounts[`page_${scrapingState.pageCount}`] = {};

      // Hard safety limit — prevent runaway pagination
      if (scrapingState.pageCount > MAX_TOTAL_PAGES) {
        logToHUD(
          `CRITICAL: Reached hard limit of ${MAX_TOTAL_PAGES} pages. Stopping.`,
        );
        console.error(
          `DataPrime: Hard page limit reached (${MAX_TOTAL_PAGES}). Stopping scraper.`,
        );
        break;
      }
      notifyProgress(
        `Analyzing transactions on page ${scrapingState.pageCount} (loading list)...`,
      );

      // Resilient wait for Amazon's JS widget to complete loading transactions asynchronously
      await waitForTransactions();

      // Scrape the current page
      const pageTransactions = scrapeCurrentPage();
      console.log(
        `Scraped ${pageTransactions.length} transactions on page ${scrapingState.pageCount}`,
      );

      // Diagnostic: log date range and sample transaction dates
      if (pageTransactions.length > 0) {
        const dates = pageTransactions.map((t) => t.date);
        console.log(
          `DataPrime: Page ${scrapingState.pageCount} — ${pageTransactions.length} txns, dates: ${dates[0]} to ${dates[dates.length - 1]}`,
        );
      }
      console.log(
        `DataPrime: Filter range — startDate=${safeISO(scrapingState.startDate)}, endDate=${safeISO(scrapingState.endDate)}`,
      );

      // Loop protection: check if we reloaded the exact same page content
      const currentPageBaseKeys = pageTransactions.map((t) => t.baseKey);
      const isPageIdentical =
        currentPageBaseKeys.length > 0 &&
        scrapingState.lastPageTransactionBaseKeys &&
        currentPageBaseKeys.length ===
          scrapingState.lastPageTransactionBaseKeys.length &&
        currentPageBaseKeys.every(
          (key, idx) => key === scrapingState.lastPageTransactionBaseKeys[idx],
        );

      if (isPageIdentical) {
        logToHUD(
          "Loop Protection: Detected duplicate page transactions (navigation did not occur). Finishing list scrape.",
        );
        console.log(
          "Duplicate page transactions detected. Stopping to prevent infinite loop.",
        );
        break;
      }
      scrapingState.lastPageTransactionBaseKeys = currentPageBaseKeys;

      // Filter by date range and merge
      let outOfRangeStartReached = false;
      let transactionsAddedThisPage = 0;

      // Verbose diagnostic: log actual filter values
      const filterStart = scrapingState.startDate
        ? new Date(scrapingState.startDate)
        : null;
      const filterEnd = scrapingState.endDate
        ? new Date(scrapingState.endDate)
        : null;
      const filterStartTs =
        filterStart && !isNaN(filterStart.getTime())
          ? filterStart.getTime()
          : null;
      const filterEndTs =
        filterEnd && !isNaN(filterEnd.getTime()) ? filterEnd.getTime() : null;
      console.log(
        `DataPrime: Date filter — start=${safeISO(filterStart)} (ts=${filterStartTs}), end=${safeISO(filterEnd)} (ts=${filterEndTs})`,
      );

      for (const tx of pageTransactions) {
        const txDate = new Date(tx.date);
        const txTime = txDate.getTime();

        // Filter out elements beyond our target window
        if (filterEndTs && txTime > filterEndTs) {
          console.log(
            `DataPrime: SKIP tx ${tx.date} — newer than endDate (${safeISO(txDate)} > ${safeISO(filterEnd)})`,
          );
          continue;
        }

        if (filterStartTs && txTime < filterStartTs) {
          console.log(
            `DataPrime: STOP at tx ${tx.date} — older than startDate (${safeISO(txDate)} < ${safeISO(filterStart)})`,
          );
          outOfRangeStartReached = true;
          break;
        }

        // Avoid duplicates
        const isDuplicate = scrapingState.scrapedTransactions.some(
          (t) => t.id === tx.id,
        );
        if (!isDuplicate) {
          scrapingState.scrapedTransactions.push(tx);
          transactionsAddedThisPage++;
          if (transactionsAddedThisPage <= 2) {
            console.log(
              `DataPrime: ADD tx ${tx.date} $${tx.amount} — within range`,
            );
          }
        }
      }

      console.log(
        `DataPrime: Page result — added=${transactionsAddedThisPage}, outOfRange=${outOfRangeStartReached}, total=${scrapingState.scrapedTransactions.length}`,
      );

      notifyProgress(
        `Scraped ${scrapingState.scrapedTransactions.length} matching transactions so far.`,
        scrapingState.scrapedTransactions,
      );

      // Stop if we've reached transactions older than the start date
      if (outOfRangeStartReached) {
        console.log(
          "Reached transactions older than start date. Finishing list scrape.",
        );
        break;
      }

      // Guard against pages that yield nothing — either empty DOM or all
      // transactions filtered out. Persisted in scrapingState to survive
      // full-page POST reloads.
      if (transactionsAddedThisPage === 0) {
        scrapingState.consecutiveEmptyPages++;
        logToHUD(
          `No new transactions added on page ${scrapingState.pageCount}. Consecutive dry pages: ${scrapingState.consecutiveEmptyPages}/${MAX_EMPTY_PAGES}`,
        );
        if (scrapingState.consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
          logToHUD(
            `Stopping: ${MAX_EMPTY_PAGES} consecutive pages yielded no new matching transactions.`,
          );
          break;
        }
      } else {
        scrapingState.consecutiveEmptyPages = 0;
      }

      // Try to find the Next page button
      const nextButton = findNextButton();
      if (!nextButton) {
        logToHUD("No Next button found. Finishing list scrape.");
        break;
      }

      logToHUD("Next Page button found. Preparing navigation...");

      // Save state to protect against full-page POST reloads
      logToHUD("Saving current state to secure local storage...");
      await saveSessionState();

      // Record and trim the current first transaction text to detect AJAX in-place updates
      const currentFirstText =
        pageTransactions.length > 0 && pageTransactions[0].elementText
          ? pageTransactions[0].elementText.trim()
          : null;

      logToHUD(
        `Triggering click on element <${nextButton.tagName.toLowerCase()}> with name: "${nextButton.name || nextButton.innerText || "none"}"`,
      );
      nextButton.click();

      logToHUD("Waiting to detect AJAX in-place DOM updates or page load...");

      const ajaxDetected = await pollForAjaxUpdate(currentFirstText);

      if (ajaxDetected && scrapingState.active) {
        logToHUD(
          "Throttling execution for 1.5s to ensure full page rendering and avoid anti-bot flags...",
        );
        await sleep(1500);
        // Loop continues to next iteration (AJAX navigation succeeded in-process)
      } else {
        logToHUD(
          "No AJAX DOM update detected within 12s. Awaiting full-page navigation/reload...",
        );
        return; // Full-page POST reload will restart the loop via storage-resume
      }
    }

    // We reach here via break (scraping complete) — not via the return above
    if (scrapingState.active) {
      finishScraping();
    }
  } catch (error) {
    console.error("Scraping error:", error);
    notifyError(error.message);
  }
}

/**
 * Scrapes all transactions listed on the current page
 */
function scrapeCurrentPage() {
  const transactions = [];

  // Selector 1: Standard Amazon Pay / Payments containers
  // Look for transactions lists (usually structured in cards or tables)
  let elements = document.querySelectorAll(
    '.apx-transactions-line-item-component-container, .apx-transactions-line-item, .apx-transaction-line-item, [id^="apx-transactions-line-item-"]',
  );

  // Selector 2: Fallback to common transaction layouts inside widgets
  if (elements.length === 0) {
    elements = document.querySelectorAll(
      '.a-box.a-spacing-base, tr.apx-transaction-details, div[id*="transaction"]',
    );
  }

  // Selector 3: Extreme fallback - scan all elements with a potential dollar amount and parse their containers
  if (elements.length === 0) {
    console.log("Using extreme fallback scan of the DOM...");
    return scrapeHeuristicFallback();
  }

  elements.forEach((el, index) => {
    try {
      const parsed = parseTransactionElement(el, index);
      if (parsed) {
        transactions.push(parsed);
      }
    } catch (e) {
      console.warn("Failed parsing transaction card", el, e);
    }
  });

  // If we found nothing with typical card elements, let's try the heuristic fallback
  if (transactions.length === 0) {
    return scrapeHeuristicFallback();
  }

  return transactions;
}

/**
 * Parses an individual transaction card / element using multiple strategies
 */
function parseTransactionElement(el, index) {
  // Extract text fields
  const fullText = el.innerText || "";

  // 1. Parse Date
  // Look for elements with specific date classes or formats
  let dateText = "";
  const dateEl = el.querySelector(
    '.apx-transaction-date, [class*="transaction-date"], .a-color-secondary',
  );
  if (dateEl) {
    dateText = dateEl.innerText.trim();
  } else {
    // Walk up to the portal container that groups transactions by date,
    // then check its previous siblings for a date header.
    const portalParent = el.parentElement
      ? el.parentElement.closest(".pmts-portal-component, .a-section")
      : null;
    if (portalParent) {
      let prev = portalParent.previousElementSibling;
      let levels = 0;
      while (prev && levels < 3) {
        const prevText = prev.innerText || "";
        if (
          prev.classList.contains("apx-transaction-date-container") ||
          prev.querySelector(".apx-transaction-date-container") ||
          prevText.match(
            /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:,? \d{4})?/i,
          ) ||
          prevText.match(/\d{1,2}\/\d{1,2}\/\d{4}/) ||
          prevText.match(/\d{4}-\d{2}-\d{2}/)
        ) {
          dateText = prevText.trim();
          break;
        }
        prev = prev.previousElementSibling;
        levels++;
      }
    }
  }

  // Fallback: search card text for date patterns
  if (!dateText) {
    const dateMatch =
      fullText.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:,? \d{4})?/i,
      ) ||
      fullText.match(/\d{1,2}\/\d{1,2}\/\d{4}/) ||
      fullText.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      dateText = dateMatch[0];
    }
  }

  // Clean the dateText to just the date match if possible and ensure year is present
  if (dateText) {
    const match =
      dateText.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:,? \d{4})?/i,
      ) ||
      dateText.match(/\d{1,2}\/\d{1,2}\/\d{4}/) ||
      dateText.match(/\d{4}-\d{2}-\d{2}/);
    if (match) {
      dateText = match[0];
      if (!/\b\d{4}\b/.test(dateText)) {
        dateText += ", " + new Date().getFullYear();
      }
    }
  }

  const parsedDate = Date.parse(dateText);
  if (isNaN(parsedDate) || parsedDate === 0) {
    console.warn(
      `DataPrime: Could not parse date. dateText="${dateText}", card text preview="${fullText.slice(0, 200)}"`,
    );
    return null; // A valid transaction must have a valid date
  }
  let dateISO;
  try {
    dateISO = new Date(parsedDate).toISOString().split("T")[0];
  } catch (e) {
    console.warn(
      `DataPrime: Date conversion failed. dateText="${dateText}", parsedDate=${parsedDate}`,
      e,
    );
    return null;
  }

  // 2. Parse Amount
  let amountText = "";
  // Check highly specific transaction amount classes first (avoiding generic layout classes like .a-text-right or .a-text-bold)
  const amountEl = el.querySelector(
    '.apx-transaction-amount, [id^="apx-transaction-amount-"], .apx-transactions-line-item-amount, [class*="transaction-amount"]',
  );
  if (amountEl) {
    amountText = amountEl.innerText.trim();
  } else {
    // Resilient fallback: search the card text for standard dollar patterns (+/-$12.34 or $12.34)
    const amountMatch = fullText.match(/[+-]?\$[0-9,]+\.[0-9]{2}/);
    if (amountMatch) {
      amountText = amountMatch[0];
    }
  }

  if (!amountText) return null; // Transaction must have an amount

  // 3. Parse Description & Order ID
  let description = "";
  // Check highly specific description classes (avoiding layout utility classes like .a-spacing-mini or .a-col-address)
  const descEl = el.querySelector(
    '.apx-transaction-description, [id^="apx-transaction-description-"], .apx-transactions-line-item-description, [class*="transaction-description"]',
  );
  if (descEl) {
    description = descEl.innerText.trim();
  } else {
    // Split text and find descriptive lines
    const lines = fullText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Filter out common action button lines to avoid matching them as transaction description
    const cleanLines = lines.filter((l) => {
      const low = l.toLowerCase();
      return (
        !low.includes("return or refund") &&
        !low.includes("return window") &&
        !low.includes("view details") &&
        !low.includes("hide order")
      );
    });

    const merchantLine =
      cleanLines.find(
        (l) =>
          l.includes("Amazon") ||
          l.includes("AMZN") ||
          l.includes("Mktp") ||
          l.includes("Tips") ||
          l.includes("Services"),
      ) || "";
    const orderLine = cleanLines.find((l) => l.includes("Order")) || "";

    if (merchantLine && orderLine) {
      description = `${merchantLine} (${orderLine})`;
    } else if (orderLine) {
      description = orderLine;
    } else {
      description =
        cleanLines.find((l) => l.includes("Payment") || l.includes("Refund")) ||
        cleanLines[0] ||
        lines[0] ||
        "Amazon Transaction";
    }
  }

  // Format amount into float and determine if it is a refund
  // On Amazon Payments:
  // - A charge (payment) is represented as a debit with a minus sign (e.g. "-$24.99")
  // - A credit (refund) is represented with a plus sign (e.g. "+$24.99")
  // In our database/dashboard:
  // - Purchases (expenses) must be positive values (e.g. 24.99)
  // - Refunds (credits) must be negative values (e.g. -24.99)
  const isRefund =
    amountText.includes("+") ||
    (description.toLowerCase().includes("refund") &&
      !description.toLowerCase().includes("return or refund") &&
      !description.toLowerCase().includes("return window"));

  let numericAmount = parseFloat(amountText.replace(/[^\d.]/g, ""));
  if (isRefund) {
    numericAmount = -Math.abs(numericAmount);
  } else {
    numericAmount = Math.abs(numericAmount);
  }

  // Extract Order ID (supporting standard 114-xxxxxxx-xxxxxxx and digital D01-xxxxxxx-xxxxxxx formats)
  let orderIdMatch = fullText.match(/([D\d]\d{2}-\d{7}-\d{7})/i);
  let orderId = orderIdMatch ? orderIdMatch[1] : null;

  // Extract Invoice/Details links
  let detailsLink = "";
  const linkEl = el.querySelector(
    'a[href*="orderID="], a[href*="order-details"], a[href*="summary/edit.html"]',
  );
  if (linkEl) {
    detailsLink = linkEl.href;
    // Fallback: extract order ID from detailsLink href if visible card text lacked it
    if (!orderId) {
      const hrefOrderIdMatch = detailsLink.match(
        /orderID=([D\d]\d{2}-\d{7}-\d{7})/i,
      );
      if (hrefOrderIdMatch) {
        orderId = hrefOrderIdMatch[1];
      }
    }
  }

  if (orderId) {
    const descLower = description.toLowerCase();
    const isGrocery =
      descLower.includes("fresh") ||
      descLower.includes("whole foods") ||
      descLower.includes("grocery") ||
      descLower.includes("groceries") ||
      descLower.includes("prime now") ||
      (detailsLink &&
        (detailsLink.includes("/uff/") || detailsLink.includes("fresh")));

    if (!detailsLink) {
      if (isGrocery) {
        detailsLink = `https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=${orderId}&page=itemmod`;
      } else if (orderId.toUpperCase().startsWith("D")) {
        detailsLink = `https://www.amazon.com/your-orders/order-details?orderID=${orderId}`;
      } else {
        detailsLink = `https://www.amazon.com/gp/your-account/order-details?orderID=${orderId}`;
      }
    } else {
      // Force rewrite to standard UFF details link if it is grocery but had a standard link or lacks page=itemmod
      if (
        isGrocery &&
        (!detailsLink.includes("/uff/") ||
          !detailsLink.includes("page=itemmod"))
      ) {
        detailsLink = `https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=${orderId}&page=itemmod`;
      }
    }
  }

  // Generate a stable, unique ID by combining base transaction attributes with an occurrence index.
  // This guarantees split charges (even on the same date with the same amount) are recorded as separate entries,
  // while keeping the IDs completely stable across subsequent scrapes.
  const baseKey = orderId
    ? `${orderId}-${dateISO}-${Math.abs(numericAmount).toFixed(2)}`
    : `tx-${dateISO}-${Math.abs(numericAmount).toFixed(2)}`;

  if (!scrapingState.occurrenceCounts) {
    scrapingState.occurrenceCounts = {};
  }
  const pageNum = scrapingState.pageCount || 1;
  const pageKey = `page_${pageNum}`;
  if (!scrapingState.occurrenceCounts[pageKey]) {
    scrapingState.occurrenceCounts[pageKey] = {};
  }
  if (!scrapingState.occurrenceCounts[pageKey][baseKey]) {
    scrapingState.occurrenceCounts[pageKey][baseKey] = 0;
  }

  // Sum occurrences on previous pages to keep overall sequence stable
  let previousOccurrences = 0;
  for (let p = 1; p < pageNum; p++) {
    const prevPageKey = `page_${p}`;
    if (
      scrapingState.occurrenceCounts[prevPageKey] &&
      scrapingState.occurrenceCounts[prevPageKey][baseKey]
    ) {
      previousOccurrences +=
        scrapingState.occurrenceCounts[prevPageKey][baseKey];
    }
  }

  const pageOccurrenceIndex = scrapingState.occurrenceCounts[pageKey][
    baseKey
  ]++;
  const occurrenceIndex = previousOccurrences + pageOccurrenceIndex;
  const id = `${baseKey}-${occurrenceIndex}`;

  return {
    id,
    baseKey,
    date: dateISO,
    amount: numericAmount,
    description: description.replace(/\s+/g, " "),
    orderId,
    detailsLink,
    paymentMethod: parsePaymentMethod(fullText),
    elementText: fullText,
  };
}

/**
 * Heuristic parsing that scans the document for rows containing transactions
 */
function scrapeHeuristicFallback() {
  const transactions = [];
  // Find all elements containing text that looks like a dollar amount (e.g. $12.34 or -$5.00)
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );

  const matchedNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.trim();
    if (/-?\$[0-9,]+\.[0-9]{2}/.test(text)) {
      matchedNodes.push(node.parentElement);
    }
  }

  // Deduplicate matched containers and inspect their text
  const containers = [...new Set(matchedNodes)];
  let idx = 0;

  containers.forEach((el) => {
    // Move up to finding an appropriate container card/row
    let parent = el;
    // Find a logical container (div or tr that has dates and doesn't span the whole page)
    for (let i = 0; i < 4; i++) {
      if (!parent || parent.tagName === "BODY") break;
      const text = parent.innerText || "";
      const dateMatch = text.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:,? \d{4})?/i,
      );

      if (dateMatch && parent.offsetWidth < window.innerWidth * 0.95) {
        const parsed = parseTransactionElement(parent, idx++);
        if (parsed && !transactions.some((t) => t.id === parsed.id)) {
          transactions.push(parsed);
          break;
        }
      }
      parent = parent.parentElement;
    }
  });

  return transactions;
}

/**
 * Parses payment method details (e.g. Visa 1234) from text block
 */
function parsePaymentMethod(text) {
  const t = text.toLowerCase();

  // Extract 4 digits (optionally preceded by asterisks or word boundaries)
  const cardMatch = text.match(/(?:\*+|\b)(\d{4})\b/);
  const cardSuffix = cardMatch ? ` (*${cardMatch[1]})` : "";

  if (t.includes("visa")) {
    return `Visa${cardSuffix}`;
  }
  if (t.includes("mastercard") || t.includes("mc")) {
    return `MasterCard${cardSuffix}`;
  }
  if (t.includes("amex") || t.includes("american express")) {
    return `Amex${cardSuffix}`;
  }
  if (t.includes("discover")) {
    return `Discover${cardSuffix}`;
  }
  if (t.includes("gift card")) {
    return "Amazon Gift Card";
  }

  if (cardSuffix) {
    return `Card${cardSuffix}`;
  }

  return "Amazon Account Balance";
}

function isElementDisabled(el) {
  if (el.disabled || el.getAttribute("disabled") !== null) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (
    el.classList.contains("a-disabled") ||
    el.classList.contains("a-button-disabled")
  )
    return true;
  if (
    el.closest(
      '.a-disabled, .a-button-disabled, [disabled="true"], [aria-disabled="true"]',
    )
  )
    return true;
  return false;
}

/**
 * Finds the "Next" button in Amazon pagination
 */
function findNextButton() {
  logToHUD("Searching for pagination 'Next Page' control...");

  // Common selectors for next page in Amazon lists
  const nextSelectors = [
    'input[name*="DefaultNextPageNavigationEvent"]',
    'input[name*="NextPage"]',
    'input[name*="nextPageKey"]',
    'input[name*="NextPageNavigationEvent"]',
    "li.a-last a",
    ".a-pagination .a-last a",
    '.apx-transactions-pagination-container a[class*="next"]',
  ];

  for (const sel of nextSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const visible = isElementVisible(el);
      const disabled = isElementDisabled(el);
      logToHUD(
        `Selector "${sel}": matched element (visible: ${visible}, disabled: ${disabled})`,
      );
      if (visible && !disabled) {
        logToHUD(`Selected Next Page control via selector: "${sel}"`);
        return el;
      }
    }
  }

  // Text search fallback — restricted to pagination containers to avoid
  // matching unrelated "next" text elsewhere on the page.
  logToHUD(
    "Direct selectors failed. Scanning pagination containers by text matching...",
  );
  const paginationContainers = document.querySelectorAll(
    ".a-pagination, .apx-transactions-pagination-container, " +
      '[class*="pagination"], [class*="pagn"], [id*="pagination"], [id*="pagn"]',
  );

  const candidateElements =
    paginationContainers.length > 0
      ? Array.from(paginationContainers).flatMap((c) =>
          Array.from(c.querySelectorAll("span, a, button, input")),
        )
      : Array.from(document.querySelectorAll("span, a, button, input"));

  for (const l of candidateElements) {
    const text = (l.innerText || l.value || "").trim().toLowerCase();
    if (
      text === "next page" ||
      text === "next" ||
      text === "next ›" ||
      text.includes("next page")
    ) {
      const visible = isElementVisible(l);
      const disabled = isElementDisabled(l);
      logToHUD(
        `Found element with text match "${text}" (visible: ${visible}, disabled: ${disabled})`,
      );
      if (visible && !disabled) {
        const parentButton = l.closest(".a-button");
        if (parentButton) {
          const inputEl = parentButton.querySelector("input");
          if (inputEl) {
            const inputDisabled = isElementDisabled(inputEl);
            logToHUD(
              `Matched visually hidden input inside the '.a-button' wrapper! (disabled: ${inputDisabled})`,
            );
            if (!inputDisabled) {
              return inputEl;
            }
          }
        }
        logToHUD("Matched visible next button directly!");
        return l;
      }
    }
  }

  logToHUD(
    "CRITICAL: Failed to locate any active Next Page navigation button!",
  );
  return null;
}

/**
 * Finds the "Previous" button in Amazon pagination
 */
function findPreviousButton() {
  logToHUD(
    "Searching for pagination 'Previous Page' control to verify first page...",
  );

  // Common selectors for previous page in Amazon lists
  const prevSelectors = [
    'input[name*="DefaultPreviousPageNavigationEvent"]',
    'input[name*="PreviousPage"]',
    'input[name*="prevPageKey"]',
    'input[name*="PreviousPageNavigationEvent"]',
    "li.a-first a",
    ".a-pagination .a-first a",
    '.apx-transactions-pagination-container a[class*="prev"]',
  ];

  for (const sel of prevSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const visible = isElementVisible(el);
      const disabled = isElementDisabled(el);
      logToHUD(
        `Selector "${sel}": matched element (visible: ${visible}, disabled: ${disabled})`,
      );
      if (visible && !disabled) {
        logToHUD(`Selected Previous Page control via selector: "${sel}"`);
        return el;
      }
    }
  }

  // Text search fallback — restricted to pagination containers
  logToHUD(
    "Direct selectors failed. Scanning pagination containers by text matching...",
  );
  const paginationContainers = document.querySelectorAll(
    ".a-pagination, .apx-transactions-pagination-container, " +
      '[class*="pagination"], [class*="pagn"], [id*="pagination"], [id*="pagn"]',
  );

  const candidateElements =
    paginationContainers.length > 0
      ? Array.from(paginationContainers).flatMap((c) =>
          Array.from(c.querySelectorAll("span, a, button, input")),
        )
      : Array.from(document.querySelectorAll("span, a, button, input"));

  for (const l of candidateElements) {
    const text = (l.innerText || l.value || "").trim().toLowerCase();
    if (
      text === "previous page" ||
      text === "previous" ||
      text === "prev" ||
      text === "‹ previous" ||
      text === "‹" ||
      text.includes("previous page")
    ) {
      const visible = isElementVisible(l);
      const disabled = isElementDisabled(l);
      logToHUD(
        `Found element with text match "${text}" (visible: ${visible}, disabled: ${disabled})`,
      );
      if (visible && !disabled) {
        const parentButton = l.closest(".a-button");
        if (parentButton) {
          const inputEl = parentButton.querySelector("input");
          if (inputEl) {
            const inputDisabled = isElementDisabled(inputEl);
            logToHUD(
              `Matched visually hidden input inside the '.a-button' wrapper! (disabled: ${inputDisabled})`,
            );
            if (!inputDisabled) {
              return inputEl;
            }
          }
        }
        logToHUD("Matched visible previous button directly!");
        return l;
      }
    }
  }

  logToHUD("Verify: No active Previous Page navigation button found.");
  return null;
}

function isElementVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/**
 * Sends a status/progress update message to the background & popup scripts
 */
function notifyProgress(statusText, data = null) {
  const txs = data || scrapingState.scrapedTransactions;
  logToHUD(statusText);
  updateHUDStatus("RUNNING", scrapingState.pageCount, txs.length);

  chrome.runtime.sendMessage({
    action: "SCRAPE_STATUS",
    payload: {
      status: "RUNNING",
      message: statusText,
      page: scrapingState.pageCount,
      transactions: txs,
    },
  });
}

/**
 * Sends an error message
 */
function notifyError(errorMessage) {
  logToHUD(`ERROR: ${errorMessage}`);
  updateHUDStatus(
    "ERROR",
    scrapingState.pageCount,
    scrapingState.scrapedTransactions.length,
  );

  chrome.runtime.sendMessage({
    action: "SCRAPE_STATUS",
    payload: {
      status: "ERROR",
      message: errorMessage,
      transactions: scrapingState.scrapedTransactions,
    },
  });
}

/**
 * Concludes the transaction list scraping step or kicks off same-site itemization
 */
async function finishScraping() {
  if (
    scrapingState.fetchItemized &&
    scrapingState.scrapedTransactions.some((t) => t.orderId)
  ) {
    await runItemizationInContentScript();
  } else {
    await concludeScrape();
  }
}

/**
 * Performs same-site Order Details fetching and itemization inside the content script
 * utilizing a concurrent worker pool (concurrency = 3) to process staggers safely and fast.
 */
async function runItemizationInContentScript() {
  logToHUD("Initializing asynchronous parallel order itemization...");
  updateHUDStatus(
    "ITEMIZING",
    scrapingState.pageCount,
    scrapingState.scrapedTransactions.length,
  );

  // Retrieve cached transaction itemizations from local storage
  let cacheMap = new Map();
  try {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get("transactions", (data) => {
        resolve(data || {});
      });
    });
    const cached = result.transactions || [];
    cached.forEach((t) => {
      if (t.id && t.items && t.items.length > 0) {
        cacheMap.set(t.id, t.items);
      }
    });
    logToHUD(
      `Retrieved ${cacheMap.size} cached transaction itemizations from secure storage.`,
    );
  } catch (err) {
    console.error("Failed to load transactions cache:", err);
  }

  const orderTransactions = scrapingState.scrapedTransactions.filter(
    (t) => t.orderId,
  );
  const totalCount = orderTransactions.length;

  logToHUD(`Found ${totalCount} transactions with Order IDs to itemize.`);

  // Create a copy of order transactions to serve as a shared work queue
  const queue = [...orderTransactions];
  let completedCount = 0;
  const CONCURRENCY = 5;

  // Notify background/popup to update status immediately
  chrome.runtime.sendMessage({
    action: "SCRAPE_STATUS",
    payload: {
      status: "ITEMIZING",
      message: `Initializing ${CONCURRENCY}-way parallel itemization...`,
      progress: 0,
      currentFetchIndex: 0,
      totalFetchCount: totalCount,
    },
  });

  // Defining the concurrent worker loop
  async function worker(workerId) {
    // Stagger the initial startup of each worker so they don't hit Amazon at the exact same millisecond
    const staggerTime = (workerId - 1) * (300 + Math.random() * 200);
    await sleep(staggerTime);
    logToHUD(`[Worker ${workerId}] Started execution.`);

    while (queue.length > 0) {
      // Check if scraping was cancelled
      if (!scrapingState.active) {
        logToHUD(`[Worker ${workerId}] Cancelled.`);
        return;
      }

      const tx = queue.shift();
      if (!tx) break;

      completedCount++;
      const currentIdx = completedCount;
      const progress = Math.round((currentIdx / totalCount) * 100);
      const statusText = `[Worker ${workerId}] Itemizing Order ${tx.orderId} (${currentIdx}/${totalCount})...`;

      logToHUD(statusText);
      updateHUDStatus(
        "ITEMIZING",
        scrapingState.pageCount,
        scrapingState.scrapedTransactions.length,
      );

      // Broadcast progress
      chrome.runtime.sendMessage({
        action: "SCRAPE_STATUS",
        payload: {
          status: "ITEMIZING",
          message: statusText,
          progress: progress,
          currentFetchIndex: currentIdx,
          totalFetchCount: totalCount,
          transactions: scrapingState.scrapedTransactions,
        },
      });

      // Check if we already have a cached itemization for this transaction
      if (cacheMap.has(tx.id)) {
        tx.items = cacheMap.get(tx.id);
        logToHUD(
          `[Worker ${workerId}] Retrieved cached itemization for Order ${tx.orderId}`,
        );
        // Skip network request and stagger sleep delay entirely!
        continue;
      }

      try {
        const detailsUrl =
          tx.detailsLink ||
          `https://www.amazon.com/gp/your-account/order-details?orderID=${tx.orderId}`;
        const response = await fetch(detailsUrl, { credentials: "include" });
        if (response.ok) {
          const html = await response.text();

          if (
            response.url.includes("signin") ||
            html.includes("ap_signin") ||
            html.includes('form[name="signIn"]') ||
            html.includes('id="ap_signin_form"')
          ) {
            logToHUD(
              `[Worker ${workerId}] Warning: Session unauthorized for Order ${tx.orderId}. Please log in.`,
            );
            tx.items = [];
          } else {
            const items = parseOrderDetailsHtml(html, tx.orderId);
            tx.items = items;
            logToHUD(
              `[Worker ${workerId}] Successfully itemized ${items.length} items for Order ${tx.orderId}`,
            );
          }
        } else {
          logToHUD(
            `[Worker ${workerId}] Warning: Failed fetching Order ${tx.orderId} (status: ${response.status})`,
          );
          tx.items = [];
        }
      } catch (err) {
        console.error(
          `[Worker ${workerId}] Error itemizing Order ${tx.orderId}:`,
          err,
        );
        logToHUD(
          `[Worker ${workerId}] Error itemizing Order ${tx.orderId}: ${err.message}`,
        );
        tx.items = [];
      }

      // Safe, staggered delay per worker (1.8s - 3.2s) to naturally spread concurrency load
      const delay = 1800 + Math.random() * 1400;
      await sleep(delay);
    }

    logToHUD(`[Worker ${workerId}] Finished execution.`);
  }

  // Create and launch the worker promises
  const workers = [];
  for (let id = 1; id <= CONCURRENCY; id++) {
    workers.push(worker(id));
  }

  // Await all workers to conclude their tasks
  await Promise.all(workers);

  if (scrapingState.active) {
    await concludeScrape();
  }
}

/**
 * Wraps up the scraping process and opens the analytical dashboard
 */
async function concludeScrape() {
  logToHUD("Finished all processing. Wrapping up session...");
  updateHUDStatus(
    "COMPLETED",
    scrapingState.pageCount,
    scrapingState.scrapedTransactions.length,
  );

  // Clear persistent session state
  await clearSessionState();

  // Hand off final transactions list to background.js for saving & dashboard open
  chrome.runtime.sendMessage({
    action: "SCRAPE_FINISHED",
    payload: {
      transactions: scrapingState.scrapedTransactions,
    },
  });

  // Automatically close HUD after 4 seconds
  setTimeout(() => {
    removeHUD();
  }, 4000);
}

/**
 * Resilient DOM-based parsing of Amazon's Order Details page HTML
 */
function parseOrderDetailsHtml(html, orderId) {
  const items = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Find all item blocks
    // Selector 1: Amazon's dedicated order details item container class
    let blocks = doc.querySelectorAll(".yohtmlc-item");

    // Selector 2: Standard desktop grid blocks for items in order details
    if (blocks.length === 0) {
      blocks = doc.querySelectorAll(".a-fixed-left-grid");
    }

    // Selector 3: Find links with product patterns and locate their container
    if (blocks.length === 0) {
      const links = doc.querySelectorAll(
        'a[href*="/gp/product/"], a[href*="/dp/"], a[href*="/gp/aw/d/"], a[href*="/gp/video/"], a[href*="/gp/digital/"], a[href*="subscribe-and-save"], a[href*="/gp/subscribe-and-save/"]',
      );
      const containers = new Set();
      links.forEach((link) => {
        if (link.querySelector("img") || link.innerText.trim().length === 0)
          return;
        const container = link.closest(
          '.a-box, tr, td, li, .a-row, div[class*="row"], div[class*="item"], div[class*="product"]',
        );
        if (container) {
          containers.add(container);
        }
      });
      blocks = Array.from(containers);
    }

    console.log(
      `[DataPrime Parser] Found ${blocks.length} item blocks in Order Details DOM for Order ${orderId}`,
    );

    blocks.forEach((block) => {
      try {
        let link = block.querySelector(
          'a[href*="/gp/product/"], a[href*="/dp/"], a[href*="/gp/aw/d/"], a[href*="/gp/video/"], a[href*="/gp/digital/"], a[href*="subscribe-and-save"], a[href*="/gp/subscribe-and-save/"]',
        );
        if (!link) {
          // Fallback: first anchor that is not review/feedback/return/help/cancel/support/contact
          const allAnchors = block.querySelectorAll("a[href]");
          for (const a of allAnchors) {
            const aHref = (a.getAttribute("href") || "").toLowerCase();
            const aText = (a.innerText || "").toLowerCase();
            if (
              !aHref.includes("review") &&
              !aHref.includes("feedback") &&
              !aHref.includes("return") &&
              !aHref.includes("help") &&
              !aHref.includes("cancel") &&
              !aText.includes("review") &&
              !aText.includes("feedback") &&
              !aText.includes("return") &&
              !aText.includes("cancel")
            ) {
              link = a;
              break;
            }
          }
        }
        if (!link) return;

        const href = link.getAttribute("href") || "";
        const asinMatch = href.match(
          /(?:\/gp\/product\/|\/dp\/|\/gp\/aw\/d\/)([A-Z0-9]{10})/i,
        );
        let asin = asinMatch ? asinMatch[1] : null;

        if (!asin) {
          // Generate a synthetic identifier for digital orders / subscriptions
          asin = `digital-${orderId}-${items.length}`;
        }

        let title = link.innerText.trim();
        if (!title || title.length < 2) {
          const allLinks = block.querySelectorAll("a");
          for (const l of allLinks) {
            if (
              l.innerText.trim().length > 2 &&
              !l.innerText.toLowerCase().includes("review") &&
              !l.innerText.toLowerCase().includes("feedback")
            ) {
              title = l.innerText.trim();
              break;
            }
          }
        }

        if (!title || title === "Amazon Purchase") {
          const titleEl = block.querySelector(
            '.yohtmlc-product-title, [class*="product-title"], .a-link-normal',
          );
          if (titleEl) title = titleEl.innerText.trim();
        }

        const lowerTitle = title.toLowerCase();
        if (
          lowerTitle.includes("return window") ||
          lowerTitle.includes("write a product review") ||
          lowerTitle.includes("leave seller feedback") ||
          lowerTitle.includes("archive order") ||
          lowerTitle.includes("hide order") ||
          title.length > 300
        ) {
          return;
        }

        let price = 0;
        const text = block.innerText || "";
        const priceMatch = text.match(/\$[0-9,]+\.[0-9]{2}/);
        if (priceMatch) {
          price = parseFloat(priceMatch[0].replace(/[^\d.]/g, ""));
        } else {
          const priceEl = block.querySelector(
            '.a-color-price, .yohtmlc-item-price, [class*="price"]',
          );
          if (priceEl) {
            const pMatch = priceEl.innerText.match(/\$[0-9,]+\.[0-9]{2}/);
            if (pMatch) price = parseFloat(pMatch[0].replace(/[^\d.]/g, ""));
          }
        }

        let quantity = 1;
        const qtyMatch =
          text.match(/Qty:\s*(\d+)/i) ||
          text.match(/Quantity:\s*(\d+)/i) ||
          text.match(/yohtmlc-item-quantity[^>]*>\s*(\d+)/i) ||
          text.match(/\b(\d+)\s+of\b/i);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1]);
        }

        let seller = "Amazon.com";
        const sellerMatch = text.match(/Sold by:\s*([^<\n]+)/i);
        if (sellerMatch) {
          seller = sellerMatch[1].split(/[|<>\n]/)[0].trim();
        }

        let imageUrl = "";
        const img = block.querySelector("img");
        if (img) {
          imageUrl = img.src || img.getAttribute("src") || "";
        }

        let itemUrl = `https://www.amazon.com/dp/${asin}`;
        if (asin.startsWith("digital-")) {
          if (href.startsWith("http")) {
            itemUrl = href;
          } else if (href.startsWith("/")) {
            itemUrl = `https://www.amazon.com${href}`;
          } else {
            itemUrl = `https://www.amazon.com/your-orders/order-details?orderID=${orderId}`;
          }
        }

        if (
          title &&
          !isPromotionalItem(title, price) &&
          !items.some((item) => item.title === title && item.price === price)
        ) {
          items.push({
            title,
            url: itemUrl,
            price,
            quantity,
            imageUrl,
            seller,
          });
        }
      } catch (innerErr) {
        console.warn(
          "Failed parsing details block in DOMParser loop",
          innerErr,
        );
      }
    });
  } catch (err) {
    console.error("DOMParser error in parseOrderDetailsHtml:", err);
  }

  // Fallback to resilient regex parsing if DOMParser found absolutely nothing
  if (items.length === 0) {
    console.log(
      "[DataPrime Parser] DOMParser itemization found 0 items. Running regex fallback...",
    );
    return parseOrderDetailsHtmlRegexFallback(html, orderId);
  }

  return items;
}

/**
 * Resilient RegExp parsing of Amazon's Order Details page HTML (as a fallback)
 */
function parseOrderDetailsHtmlRegexFallback(html, orderId) {
  const items = [];
  const itemBlocks = [];

  let mainContent = html;
  const detailsStart =
    html.indexOf('id="orderDetails"') !== -1
      ? html.indexOf('id="orderDetails"')
      : html.indexOf('class="a-box"');
  if (detailsStart !== -1) {
    mainContent = html.slice(detailsStart);
  }

  // Find all unique ASINs inside standard product links in the main content
  const asinRegex = /\/(?:gp\/product|dp|gp\/aw\/d)\/([A-Z0-9]{10})\b/gi;
  let match;
  const matchedIdentifiers = new Map(); // map identifier -> index of occurrence

  while ((match = asinRegex.exec(mainContent)) !== null) {
    if (!matchedIdentifiers.has(match[1])) {
      matchedIdentifiers.set(match[1], match.index);
    }
  }

  // Also scan for digital/subscription keys in links
  const digitalRegex =
    /\/(?:gp\/video\/|gp\/digital\/|subscribe-and-save|gp\/subscribe-and-save\/)([^"\s>?&#]+)/gi;
  let digCount = 0;
  while ((match = digitalRegex.exec(mainContent)) !== null) {
    const key = `digital-${orderId}-${digCount++}`;
    if (!matchedIdentifiers.has(key)) {
      matchedIdentifiers.set(key, match.index);
    }
  }

  matchedIdentifiers.forEach((index, ident) => {
    const start = Math.max(0, index - 1000);
    const end = Math.min(mainContent.length, index + 1000);
    itemBlocks.push({
      identifier: ident,
      blockContent: mainContent.slice(start, end),
    });
  });

  itemBlocks.forEach(({ identifier, blockContent }) => {
    try {
      const asin = identifier;

      let seller = "";
      const sellerMatch =
        blockContent.match(/Sold by:\s*<[^>]+>([^<]+)</i) ||
        blockContent.match(/Sold by:\s*([^<\n]+)/i);
      if (sellerMatch) {
        seller = sellerMatch[1].trim();
      }

      let quantity = 0;
      const qtyMatch =
        blockContent.match(/yohtmlc-item-quantity[^>]*>\s*(\d+)\s*</i) ||
        blockContent.match(/class="a-size-small"[^>]*>Qty:\s*(\d+)/i) ||
        blockContent.match(/Quantity:\s*(\d+)/i) ||
        blockContent.match(/Qty:\s*(\d+)/i) ||
        blockContent.match(
          /<span[^>]*class="[^"]*quantity[^"]*"[^>]*>\s*(\d+)\s*<\/span>/i,
        );
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1]);
      }

      if (!seller && quantity === 0) {
        if (!asin.startsWith("digital-")) {
          return;
        }
      }

      if (!seller) seller = "Amazon.com";
      if (quantity === 0) quantity = 1;

      let title = "Amazon Purchase";
      let titleMatch = null;
      if (!asin.startsWith("digital-")) {
        const asinLinkRegex = new RegExp(
          `<a[^>]*href="[^"]*(?:/gp/product/|/dp/|/gp/aw/d/)${asin}[^"]*"[^>]*>\\s*([^<]+)\\s*</a>`,
          "i",
        );
        titleMatch = blockContent.match(asinLinkRegex);
      } else {
        titleMatch = blockContent.match(
          /<a[^>]*href="[^"]*(?:gp\/video\/|gp\/digital\/|subscribe-and-save|gp\/subscribe-and-save\/)[^"]*"[^>]*>\s*([^<]+)\s*<\/a>/i,
        );
      }

      if (titleMatch && titleMatch[1].trim()) {
        title = titleMatch[1].trim();
      } else {
        const generalMatch =
          blockContent.match(/yohtmlc-product-title[^>]*>\s*([^<]+)\s*</i) ||
          blockContent.match(
            /class="[^"]*product-title[^"]*"[^>]*>\s*([^<]+)\s*</i,
          ) ||
          blockContent.match(
            /<a[^>]*class="[^"]*a-link-normal[^"]*"[^>]*>\s*([^<]+)\s*<\/a>/i,
          ) ||
          blockContent.match(/class="a-link-normal"[^>]*>\s*([^<]+)\s*<\/a>/i);
        if (generalMatch) {
          title = generalMatch[1].trim();
        }
      }

      const lowerTitle = title.toLowerCase();
      if (
        lowerTitle.includes("return window") ||
        lowerTitle.includes("write a product review") ||
        lowerTitle.includes("leave seller feedback") ||
        lowerTitle.includes("archive order") ||
        lowerTitle.includes("hide order") ||
        title.length > 300
      ) {
        return;
      }

      let price = 0;
      const priceMatch = blockContent.match(/\$[0-9,]+\.[0-9]{2}/);
      if (priceMatch) {
        price = parseFloat(priceMatch[0].replace(/[^\d.]/g, ""));
      }

      let imageUrl = "";
      const imgMatch =
        blockContent.match(
          /src="([^"]*(?:media-amazon|images-na|images-amazon)[^"]*\.jpg)"/i,
        ) || blockContent.match(/src="([^"]*\.jpg)"/i);
      if (imgMatch) {
        imageUrl = imgMatch[1];
      }

      let url = `https://www.amazon.com/dp/${asin}`;
      if (asin.startsWith("digital-")) {
        const urlMatch = blockContent.match(
          /href="([^"]*(?:gp\/video\/|gp\/digital\/|subscribe-and-save|gp\/subscribe-and-save\/)[^"]*)"/i,
        );
        if (urlMatch) {
          const matchedUrl = urlMatch[1];
          if (matchedUrl.startsWith("http")) {
            url = matchedUrl;
          } else if (matchedUrl.startsWith("/")) {
            url = `https://www.amazon.com${matchedUrl}`;
          }
        } else {
          url = `https://www.amazon.com/your-orders/order-details?orderID=${orderId}`;
        }
      }

      if (
        !isPromotionalItem(title, price) &&
        !items.some((item) => item.title === title && item.price === price)
      ) {
        items.push({
          title,
          url,
          price,
          quantity,
          imageUrl,
          seller,
        });
      }
    } catch (e) {
      console.warn("Failed parsing item details block in regex fallback", e);
    }
  });

  return items;
}

/**
 * Detects if parsed metadata belongs to an advertisement or promotional link (e.g. credit cards or Prime Video ads)
 * that is not an actual purchased item. Usually has a price of $0.00.
 *
 * @param {string} title - The parsed item product title.
 * @param {number} price - The parsed item unit price.
 * @returns {boolean} True if the item is classified as promotional/ad, false otherwise.
 */
function isPromotionalItem(title, price) {
  if (price > 0) return false;

  const lowerTitle = (title || "").toLowerCase();
  const promoKeywords = [
    "secured card",
    "business card",
    "store card",
    "rewards visa",
    "visa signature",
    "prime video",
    "amazon prime",
    "join prime",
    "try prime",
    "credit card",
    "amazon business",
    "storecard",
    "gift card",
  ];

  return promoKeywords.some((keyword) => lowerTitle.includes(keyword));
}

/**
 * Safe Date-to-ISO-string that never throws. Returns the original value
 * as a string if the Date is invalid or not a Date.
 */
function safeISO(d) {
  if (d instanceof Date && !isNaN(d.getTime())) {
    return d.toISOString();
  }
  return String(d);
}

/**
 * Helper utility to delay execution
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export functions for zero-dependency Node.js tests
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    scrapingState,
    parseTransactionElement,
    parseOrderDetailsHtmlRegexFallback,
    parsePaymentMethod,
    isElementDisabled,
    isElementVisible,
    findPreviousButton,
    findNextButton,
  };
}
