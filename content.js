/**
 * DataPrime Content Scraper Script
 * Runs in the context of: https://www.amazon.com/cpe/yourpayments/transactions
 */

// Node/Bun CommonJS module importing and globalling for unit tests
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  const utils = require("./content-scripts/utils.js");
  const hud = require("./content-scripts/hud.js");
  const parser = require("./content-scripts/parser.js");
  const itemizer = require("./content-scripts/itemizer.js");

  // Make all functions and state available on globalThis in tests
  Object.assign(globalThis, utils, hud, parser, itemizer);

  // Set up local bindings so they can be exported
  var scrapingState = utils.scrapingState;
  var ensureHUD = hud.ensureHUD;
  var removeHUD = hud.removeHUD;
  var logToHUD = hud.logToHUD;
  var updateHUDStatus = hud.updateHUDStatus;
  var updateTabTitle = hud.updateTabTitle;
  var scrapeCurrentPage = parser.scrapeCurrentPage;
  var parseTransactionElement = parser.parseTransactionElement;
  var parsePaymentMethod = parser.parsePaymentMethod;
  var isElementDisabled = parser.isElementDisabled;
  var findNextButton = parser.findNextButton;
  var findPreviousButton = parser.findPreviousButton;
  var runItemizationInContentScript = itemizer.runItemizationInContentScript;
  var parseOrderSummary = itemizer.parseOrderSummary;
  var parseOrderDetailsHtmlRegexFallback =
    itemizer.parseOrderDetailsHtmlRegexFallback;
  var sleep = utils.sleep;
  var safeISO = utils.safeISO;
  var isElementVisible = utils.isElementVisible;
}

console.log("DataPrime Scraper content script loaded!");

// Signal background service worker that content script is loaded and active
if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.sendMessage({ action: "CONTENT_SCRIPT_READY" });
}

// Handle automatic redirect recovery from Amazon overview landing page
if (
  typeof window !== "undefined" &&
  window.location &&
  window.location.href.includes("/cpe/yourpayments/overview")
) {
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

// Prevent tab closure when scraping or itemizing is active
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("beforeunload", (event) => {
    if (scrapingState && scrapingState.active) {
      event.preventDefault();
      event.returnValue =
        "Scraping is in progress. Closing this tab will stop the scraper. Are you sure you want to exit?";
      return event.returnValue;
    }
  });
}

let isStorageChecked = false;
let pendingStartRequest = null;

/**
 * Initializes and starts a new scraping run.
 * @param {Object} request - Request parameters.
 * @param {Function} sendResponse - Callback function.
 */
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

// On startup, check if we have a saved active scraping session.
// Only resume if the background confirms this is its managed tab.
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get("activeScrapeSession", (data) => {
    isStorageChecked = true;
    if (data && data.activeScrapeSession && data.activeScrapeSession.active) {
      // Ask background if this tab is the managed scrape tab before resuming.
      // This prevents hijacking an unrelated Amazon tab the user has open.
      chrome.runtime.sendMessage(
        { action: "CHECK_SCRAPE_TAB" },
        (response) => {
          if (chrome.runtime.lastError) {
            isStorageChecked = true;
            return;
          }
          if (response && response.isScrapeTab) {
            console.log("Resuming active scraping session from storage...");
            scrapingState = data.activeScrapeSession;

            ensureHUD();
            updateHUDStatus(
              "RUNNING",
              scrapingState.pageCount,
              scrapingState.scrapedTransactions.length,
            );
            logToHUD("Resuming active scraping session from storage...");

            if (pendingStartRequest) {
              pendingStartRequest.sendResponse({ status: "ALREADY_RUNNING" });
              pendingStartRequest = null;
            }

            startScrapingLoop();
          } else {
            // Not our managed tab — clear the stale session from storage
            console.log("DataPrime: Not the managed scrape tab, clearing stale session.");
            chrome.storage.local.remove("activeScrapeSession");
            if (pendingStartRequest) {
              handleStartScrape(
                pendingStartRequest.request,
                pendingStartRequest.sendResponse,
              );
              pendingStartRequest = null;
            }
          }
        },
      );
    } else {
      if (pendingStartRequest) {
        handleStartScrape(
          pendingStartRequest.request,
          pendingStartRequest.sendResponse,
        );
        pendingStartRequest = null;
      }
    }
  });
}

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
if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
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
}

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

    const newElements = document.querySelectorAll(
      ".apx-transactions-line-item-component-container",
    );
    if (newElements.length > 0) {
      const newFirstText = (newElements[0].innerText || "").trim();

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
 */
async function startScrapingLoop() {
  try {
    if (!scrapingState.active) return;

    // Verify we are starting from the first page of transactions
    if (scrapingState.pageCount === 0) {
      let prevButton = findPreviousButton();
      if (prevButton) {
        logToHUD(
          "Not on page 1. Navigating back to the first page of transactions...",
        );
        console.log(
          "DataPrime Scraper: Previous Page button is active. Navigating back to page 1.",
        );

        // Click Previous until we reach page 1 (max 200 iterations to prevent infinite loop)
        const MAX_BACK_NAV = 200;
        for (let backNav = 0; backNav < MAX_BACK_NAV; backNav++) {
          if (!scrapingState.active) return;

          const firstElBefore = document.querySelector(
            ".apx-transactions-line-item-component-container",
          );
          const firstTextBefore = firstElBefore
            ? (firstElBefore.innerText || "").trim()
            : null;

          prevButton.click();
          logToHUD(
            `Clicked Previous Page (${backNav + 1}/${MAX_BACK_NAV})...`,
          );

          await pollForAjaxUpdate(firstTextBefore);
          await sleep(800);

          prevButton = findPreviousButton();
          if (!prevButton) {
            logToHUD("Reached page 1. Beginning analysis.");
            break;
          }

          if (backNav === MAX_BACK_NAV - 1) {
            logToHUD(
              "Failed to reach page 1 after maximum navigation attempts.",
              true,
            );
            notifyError(
              "Could not navigate to the first page of your transactions. Please manually navigate to Page 1 and try again.",
            );
            scrapingState.active = false;
            await clearSessionState();
            return;
          }
        }
      }
    }

    const MAX_EMPTY_PAGES = 3;
    const MAX_TOTAL_PAGES = 200;

    while (scrapingState.active) {
      scrapingState.pageCount++;

      if (!scrapingState.occurrenceCounts) {
        scrapingState.occurrenceCounts = {};
      }
      scrapingState.occurrenceCounts[`page_${scrapingState.pageCount}`] = {};

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

      await waitForTransactions();

      const pageTransactions = scrapeCurrentPage();
      console.log(
        `Scraped ${pageTransactions.length} transactions on page ${scrapingState.pageCount}`,
      );

      if (pageTransactions.length > 0) {
        const dates = pageTransactions.map((t) => t.date);
        console.log(
          `DataPrime: Page ${scrapingState.pageCount} — ${pageTransactions.length} txns, dates: ${dates[0]} to ${dates[dates.length - 1]}`,
        );
      }
      console.log(
        `DataPrime: Filter range — startDate=${safeISO(scrapingState.startDate)}, endDate=${safeISO(scrapingState.endDate)}`,
      );

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

      let outOfRangeStartReached = false;
      let transactionsAddedThisPage = 0;

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

      if (outOfRangeStartReached) {
        console.log(
          "Reached transactions older than start date. Finishing list scrape.",
        );
        break;
      }

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

      const nextButton = findNextButton();
      if (!nextButton) {
        logToHUD("No Next button found. Finishing list scrape.");
        break;
      }

      logToHUD("Next Page button found. Preparing navigation...");
      await saveSessionState();

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
      } else {
        logToHUD(
          "No AJAX DOM update detected within 12s. Awaiting full-page navigation/reload...",
        );
        return;
      }
    }

    if (scrapingState.active) {
      finishScraping();
    }
  } catch (error) {
    console.error("Scraping error:", error);
    notifyError(error.message);
  }
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
 * Sends an error message and stops the scrape session.
 */
function notifyError(errorMessage) {
  scrapingState.active = false;
  clearSessionState();
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
 * Wraps up the scraping process and opens the analytical dashboard
 */
async function concludeScrape() {
  scrapingState.active = false;
  logToHUD("Finished all processing. Wrapping up session...");
  updateHUDStatus(
    "COMPLETED",
    scrapingState.pageCount,
    scrapingState.scrapedTransactions.length,
  );

  await clearSessionState();

  chrome.runtime.sendMessage({
    action: "SCRAPE_FINISHED",
    payload: {
      transactions: scrapingState.scrapedTransactions,
    },
  });

  setTimeout(() => {
    removeHUD();
  }, 4000);
}

// Exports for Node/Bun testing compatibility
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
    parseOrderSummary,
    updateTabTitle,
  };
}
