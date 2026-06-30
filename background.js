import { seedDemoData } from "./background/demo-data.js";

// Active scraping states
let activeScrape = {
  status: "IDLE", // IDLE, RUNNING, ITEMIZING, COMPLETED, ERROR
  message: "",
  progress: 0,
  transactions: [],
  fetchItemized: true,
  currentFetchIndex: 0,
  totalFetchCount: 0,
  cachedCount: 0,
  tabId: null,
};

let isBackgroundStorageChecked = false;
const pendingMessages = [];

// Restore active background scrape state from storage on startup (supports Manifest V3 Service Worker lifecycle suspension)
chrome.storage.local.get("backgroundActiveScrape", (data) => {
  isBackgroundStorageChecked = true;
  if (data && data.backgroundActiveScrape) {
    activeScrape = data.backgroundActiveScrape;
    console.log(
      "Restored active background scrape state from storage:",
      activeScrape,
    );
  }

  // Process any pending messages that arrived while loading from storage
  while (pendingMessages.length > 0) {
    const { request, sender, sendResponse } = pendingMessages.shift();
    handleBackgroundMessage(request, sender, sendResponse);
  }
});

/**
 * Checks if the user has an active authenticated session on Amazon.
 * Performs a silent background GET fetch and verifies if Amazon redirects to a signin/login landing page.
 */
async function checkAmazonAuth() {
  try {
    console.log("DataPrime: Checking Amazon session authentication...");
    const response = await fetch(
      "https://www.amazon.com/cpe/yourpayments/transactions",
      {
        method: "GET",
        credentials: "include",
      },
    );

    const finalUrl = response.url.toLowerCase();
    if (
      finalUrl.includes("/signin") ||
      finalUrl.includes("/login") ||
      finalUrl.includes("/register") ||
      finalUrl.includes("ap/signin")
    ) {
      return false; // Redirected to signin/login page, not authenticated
    }
    return true; // Stayed on transactions page, authenticated!
  } catch (error) {
    console.error("DataPrime: Session verification fetch failed:", error);
    return false;
  }
}

// Listen for scraper background tab being closed manually by the user
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeScrape.tabId === tabId) {
    console.log(
      "DataPrime: Scraper background tab was manually closed by the user.",
    );
    if (
      activeScrape.status === "RUNNING" ||
      activeScrape.status === "ITEMIZING"
    ) {
      activeScrape.status = "ERROR";
      activeScrape.message = "Analysis tab was closed before completion.";
      broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);
    }
    activeScrape.tabId = null;
  }
});

// Check active scrape state
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isBackgroundStorageChecked) {
    pendingMessages.push({ request, sender, sendResponse });
    return true; // Keep message channel open
  }
  return handleBackgroundMessage(request, sender, sendResponse);
});

function handleBackgroundMessage(request, sender, sendResponse) {
  if (request.action === "GET_SCRAPE_STATE") {
    sendResponse(activeScrape);
    return true;
  }

  // Orchestrate the Inactive Background Tab Scraper launch
  if (request.action === "LAUNCH_BACKGROUND_SCRAPE") {
    if (
      activeScrape.status === "RUNNING" ||
      activeScrape.status === "ITEMIZING"
    ) {
      sendResponse({ status: "ALREADY_RUNNING" });
      return true;
    }

    // Clear any previous activeScrapeSession left in storage to ensure a clean new start
    chrome.storage.local.remove("activeScrapeSession", () => {
      activeScrape.status = "RUNNING";
      activeScrape.message = "Verifying Amazon authentication state...";
      activeScrape.progress = 0;
      activeScrape.transactions = [];
      activeScrape.currentFetchIndex = 0;
      activeScrape.totalFetchCount = 0;
      activeScrape.cachedCount = 0;

      // Store target date bounds and itemize toggle directly on session state for ready handshake
      activeScrape.startDate = request.startDate;
      activeScrape.endDate = request.endDate;
      activeScrape.fetchItemized = request.fetchItemized;

      broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

      checkAmazonAuth().then((authenticated) => {
        if (!authenticated) {
          console.log("DataPrime: Scrape aborted. Session is unauthenticated.");
          activeScrape.status = "ERROR";
          activeScrape.message =
            "You are not logged in to Amazon. Please log in in the opened tab and try again.";
          broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

          // Open an active focus tab pointing to payments page so the user can easily log in!
          chrome.tabs.create({
            url: "https://www.amazon.com/cpe/yourpayments/transactions",
            active: true, // Active tab to prompt login
          });
          return;
        }

        // Proceed with background tab scraping since authentication is verified
        activeScrape.message = "Opening inactive Amazon transactions tab...";
        broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

        chrome.tabs.create(
          {
            url: "https://www.amazon.com/cpe/yourpayments/transactions",
            active: false, // Keep inactive in the background!
          },
          (tab) => {
            activeScrape.tabId = tab.id;
            broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);
            sendResponse({ status: "LAUNCHED" });
          },
        );
      });
    });
    return true;
  }

  // Content script checks if it's running in the background-managed tab
  if (request.action === "CHECK_SCRAPE_TAB") {
    const isScrapeTab =
      sender.tab &&
      sender.tab.id === activeScrape.tabId &&
      (activeScrape.status === "RUNNING" ||
        activeScrape.status === "ITEMIZING");
    sendResponse({ isScrapeTab });
    return true;
  }

  // Intercept the deterministic content script signal handshake
  if (request.action === "CONTENT_SCRIPT_READY") {
    if (
      sender.tab &&
      sender.tab.id === activeScrape.tabId &&
      activeScrape.status === "RUNNING"
    ) {
      console.log(
        `DataPrime background.js: Content script is alive in scraper tab ${sender.tab.id}. Triggering scraper start message...`,
      );
      activeScrape.message = "Preparing Amazon transaction list scraper...";
      broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

      // Send the START_SCRAPE command now that we are 100% sure the content script has loaded and is listening!
      chrome.tabs.sendMessage(
        activeScrape.tabId,
        {
          action: "START_SCRAPE",
          startDate: activeScrape.startDate,
          endDate: activeScrape.endDate,
          fetchItemized: activeScrape.fetchItemized,
        },
        (_res) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Failed to start scraper in background tab:",
              chrome.runtime.lastError.message,
            );
            activeScrape.status = "ERROR";
            activeScrape.message =
              "Failed to communicate with Amazon: " +
              chrome.runtime.lastError.message;
            broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

            // Cleanup tab on error
            chrome.tabs.remove(activeScrape.tabId);
            activeScrape.tabId = null;
          }
        },
      );
    }
    return true;
  }

  // Handle progress updates from content script
  if (request.action === "SCRAPE_STATUS") {
    const payload = request.payload;

    // Prevent itemization progress metrics from going backwards due to out-of-order concurrent worker messages.
    // Allow the metrics to be reset when the content script restarts/re-initializes (i.e. payload.currentFetchIndex is 0).
    if (
      activeScrape.status === "ITEMIZING" &&
      payload.status === "ITEMIZING" &&
      payload.currentFetchIndex !== 0 &&
      payload.currentFetchIndex !== undefined
    ) {
      if (
        payload.progress !== undefined &&
        payload.progress < activeScrape.progress
      ) {
        payload.progress = activeScrape.progress;
      }
      if (
        payload.currentFetchIndex !== undefined &&
        payload.currentFetchIndex < activeScrape.currentFetchIndex
      ) {
        payload.currentFetchIndex = activeScrape.currentFetchIndex;
      }
      if (
        payload.cachedCount !== undefined &&
        payload.cachedCount < activeScrape.cachedCount
      ) {
        payload.cachedCount = activeScrape.cachedCount;
      }
    }

    activeScrape = { ...activeScrape, ...payload };

    // Broadcast progress to popup or open dashboard tabs
    broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

    // Detect auth expiration during itemization and open a login tab
    if (
      payload.status === "ERROR" &&
      payload.message &&
      payload.message.includes("session expired")
    ) {
      console.log(
        "DataPrime: Auth expired during itemization. Opening login tab...",
      );
      chrome.tabs.create({
        url: "https://www.amazon.com/cpe/yourpayments/transactions",
        active: true,
      });
      if (activeScrape.tabId) {
        chrome.tabs.remove(activeScrape.tabId, () => {
          chrome.runtime.lastError;
        });
        activeScrape.tabId = null;
      }
    }
    return true;
  }

  // Content script is finished scraping the main list
  if (request.action === "SCRAPE_FINISHED") {
    const { transactions } = request.payload;
    activeScrape.transactions = transactions;
    finalizeScraping();
    return true;
  }

  // Intercept STOP_SCRAPE to remove background tab
  if (request.action === "STOP_SCRAPE") {
    // Explicitly clear the session state from storage to avoid auto-resume on reload/re-run
    chrome.storage.local.remove("activeScrapeSession");

    if (activeScrape.tabId) {
      chrome.tabs.sendMessage(
        activeScrape.tabId,
        { action: "STOP_SCRAPE" },
        () => {
          // Suppress any error if the tab is already dying
          chrome.runtime.lastError;
        },
      );
      chrome.tabs.remove(activeScrape.tabId, () => {
        chrome.runtime.lastError;
      });
      activeScrape.tabId = null;
    }

    activeScrape.status = "IDLE";
    activeScrape.message = "";
    activeScrape.progress = 0;
    activeScrape.transactions = [];
    activeScrape.startDate = null;
    activeScrape.endDate = null;
    activeScrape.currentFetchIndex = 0;
    activeScrape.totalFetchCount = 0;
    activeScrape.cachedCount = 0;

    broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);
    sendResponse({ status: "STOPPED" });
    return true;
  }

  // Manual Trigger for Demo Data
  if (request.action === "SEED_DEMO_DATA") {
    seedDemoData().then((demoData) => {
      sendResponse({ status: "SUCCESS", count: demoData.length });
    });
    return true;
  }

  // Reset active scraping state to allow new analyses
  if (request.action === "RESET_SCRAPE_STATE") {
    // Clean leftover session state
    chrome.storage.local.remove("activeScrapeSession");
    activeScrape.status = "IDLE";
    activeScrape.message = "";
    activeScrape.progress = 0;
    activeScrape.transactions = [];
    activeScrape.startDate = null;
    activeScrape.endDate = null;
    activeScrape.currentFetchIndex = 0;
    activeScrape.totalFetchCount = 0;
    activeScrape.cachedCount = 0;
    sendResponse({ status: "RESET" });
    return true;
  }
}

/**
 * Finalizes the scraping pipeline, stores the results, and displays the dashboard
 */
async function finalizeScraping() {
  activeScrape.status = "COMPLETED";
  activeScrape.message = `Successfully analyzed ${activeScrape.transactions.length} transactions!`;
  activeScrape.progress = 100;

  // Cleanup: close the inactive background scraper tab cleanly!
  if (activeScrape.tabId) {
    chrome.tabs.remove(activeScrape.tabId, () => {
      chrome.runtime.lastError;
    });
    activeScrape.tabId = null;
  }

  // Retrieve existing stored transactions to merge (optional, but clean)
  const result = await chrome.storage.local.get("transactions");
  let allTransactions = result.transactions || [];

  // Merge: overwrite existing, append new
  const txMap = new Map(allTransactions.map((t) => [t.id, t]));
  activeScrape.transactions.forEach((t) => txMap.set(t.id, t));
  const mergedList = Array.from(txMap.values());

  // Sort descending by date
  mergedList.sort((a, b) => new Date(b.date) - new Date(a.date));

  await chrome.storage.local.set({
    transactions: mergedList,
    lastScraped: new Date().toISOString(),
    scrapeStartDate: activeScrape.startDate,
    scrapeEndDate: activeScrape.endDate,
  });

  broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

  // Open or focus the results dashboard
  openOrFocusDashboard();
}

/**
 * Opens a new dashboard tab or focuses it if it is already open.
 */
function openOrFocusDashboard() {
  const url = chrome.runtime.getURL("dashboard/results.html");
  chrome.tabs.query({}, (tabs) => {
    const existingTab = (tabs || []).find(
      (t) => t.url && t.url.startsWith(url),
    );
    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true }, () => {
        chrome.runtime.lastError;
      });
      chrome.windows.update(existingTab.windowId, { focused: true }, () => {
        chrome.runtime.lastError;
      });
    } else {
      chrome.tabs.create({ url: url });
    }
  });
}

/**
 * Broadcast messages to all active extension pages (popup, results dashboard)
 */
function broadcastToAll(action, payload) {
  if (action === "SCRAPE_STATE_CHANGED") {
    chrome.storage.local.set({ backgroundActiveScrape: payload });
  }
  chrome.runtime.sendMessage({ action, payload }, () => {
    // Suppress the "receiving end does not exist" error when popup is closed
    chrome.runtime.lastError;
  });
}
