/**
 * DataPrime Background Service Worker
 * Coordinates transaction list scraping, itemization fetches, storage, and dashboard tabs.
 */

// Active scraping states
let activeScrape = {
  status: "IDLE", // IDLE, RUNNING, ITEMIZING, COMPLETED, ERROR
  message: "",
  progress: 0,
  transactions: [],
  fetchItemized: true,
  currentFetchIndex: 0,
  totalFetchCount: 0,
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
        (res) => {
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
    activeScrape = { ...activeScrape, ...payload };

    // Broadcast progress to popup or open dashboard tabs
    broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);
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
          const err = chrome.runtime.lastError;
        },
      );
      chrome.tabs.remove(activeScrape.tabId, () => {
        const err = chrome.runtime.lastError;
      });
      activeScrape.tabId = null;
    }

    activeScrape.status = "IDLE";
    activeScrape.message = "";
    activeScrape.progress = 0;
    activeScrape.transactions = [];
    activeScrape.startDate = null;
    activeScrape.endDate = null;

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
    sendResponse({ status: "RESET" });
    return true;
  }
}

/**
 * Finalizes the scraping pipeline, stores the results, and displays the dashboard
 */
async function finalizeScraping() {
  activeScrape.status = "COMPLETED";
  activeScrape.message = `Successfully scraped and analyzed ${activeScrape.transactions.length} transactions!`;
  activeScrape.progress = 100;

  // Cleanup: close the inactive background scraper tab cleanly!
  if (activeScrape.tabId) {
    chrome.tabs.remove(activeScrape.tabId, () => {
      const err = chrome.runtime.lastError;
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
  });

  broadcastToAll("SCRAPE_STATE_CHANGED", activeScrape);

  // Open the results dashboard in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard/results.html"),
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
    const lastError = chrome.runtime.lastError;
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Seeds high-quality demo data for visual dashboard testing
 */
async function seedDemoData() {
  const categories = [
    "Electronics",
    "Kitchen",
    "Apparel",
    "Office Supplies",
    "Groceries",
    "Books",
    "Streaming",
    "Home Goods",
  ];
  const sellers = [
    "Amazon.com",
    "Anker Direct",
    "Spreetail",
    "Whole Foods Market",
    "Patagonia",
    "Logitech Inc.",
    "Digital Services",
  ];

  const mockTransactions = [];
  const now = new Date();

  // Generate 25 mock transactions over the last 12 months
  for (let i = 0; i < 25; i++) {
    const txDate = new Date(now.getTime() - i * 14 * 24 * 60 * 60 * 1000);
    const dateISO = txDate.toISOString().split("T")[0];
    const orderId = `114-${Math.floor(1000000 + Math.random() * 9000000)}-${Math.floor(1000000 + Math.random() * 9000000)}`;

    // Determine random transaction structure
    const amountPaid = parseFloat((15 + Math.random() * 250).toFixed(2));

    // Create 1-3 itemized items
    const items = [];
    const itemCount = Math.floor(1 + Math.random() * 3);
    let remainingAmount = amountPaid;

    for (let j = 0; j < itemCount; j++) {
      const itemPrice =
        j === itemCount - 1
          ? remainingAmount
          : parseFloat(
              (
                (remainingAmount / (itemCount - j)) *
                (0.6 + Math.random() * 0.4)
              ).toFixed(2),
            );
      remainingAmount = parseFloat((remainingAmount - itemPrice).toFixed(2));

      const category =
        categories[Math.floor(Math.random() * categories.length)];
      const seller = sellers[Math.floor(Math.random() * sellers.length)];

      let itemTitle = `Premium ${category} Product ${j + 1}`;
      if (category === "Electronics") {
        itemTitle = [
          "Anker USB-C Power Hub 100W",
          "Logitech MX Master 3S Wireless Mouse",
          "Sony WH-1000XM4 Noise Cancelling Headphones",
          "Kindle Paperwhite (16 GB)",
        ][Math.floor(Math.random() * 4)];
      } else if (category === "Kitchen") {
        itemTitle = [
          "Instant Pot Duo 7-in-1 Smart Cooker",
          "Hydro Flask Wide Mouth Water Bottle",
          "Cosori Air Fryer Max XL 5.8 Qt",
          "Bodum Chambord French Press",
        ][Math.floor(Math.random() * 4)];
      } else if (category === "Groceries") {
        itemTitle = [
          "Organic Fuji Apples (3lb Bag)",
          "LaCroix Sparkling Water 24-Pack",
          "Organic Creamy Peanut Butter 28oz",
          "365 Everyday Value Olive Oil",
        ][Math.floor(Math.random() * 4)];
      } else if (category === "Apparel") {
        itemTitle = [
          "Patagonia Better Sweater Fleece Jacket",
          "Levis 511 Slim Fit Men's Jeans",
          "Champion Powerblend Fleece Hoodie",
          "Darn Tough Merino Wool Hiking Socks",
        ][Math.floor(Math.random() * 4)];
      }

      items.push({
        title: itemTitle,
        url: `https://www.amazon.com/gp/product/B07M${Math.floor(100000 + Math.random() * 900000)}`,
        price: itemPrice,
        quantity: 1,
        imageUrl: `https://picsum.photos/seed/${Math.floor(Math.random() * 1000)}/100/100`, // beautiful random product fallback images
        seller,
      });
    }

    mockTransactions.push({
      id: orderId,
      date: dateISO,
      amount: amountPaid,
      description: `Payment for Order ${orderId}`,
      orderId,
      detailsLink: `https://www.amazon.com/gp/your-account/order-details?orderID=${orderId}`,
      paymentMethod: [
        "Visa (*4321)",
        "MasterCard (*9876)",
        "Amex (*1002)",
        "Amazon Gift Card",
      ][Math.floor(Math.random() * 4)],
      items,
    });
  }

  // Add 2 refunds
  for (let i = 0; i < 2; i++) {
    const txDate = new Date(now.getTime() - (5 + i * 40) * 24 * 60 * 60 * 1000);
    const dateISO = txDate.toISOString().split("T")[0];
    const originalOrderId = `114-${Math.floor(1000000 + Math.random() * 9000000)}-${Math.floor(1000000 + Math.random() * 9000000)}`;
    const refundAmount = -parseFloat((20 + Math.random() * 80).toFixed(2));

    mockTransactions.push({
      id: `refund-${originalOrderId}`,
      date: dateISO,
      amount: refundAmount,
      description: `Refund for Order ${originalOrderId}`,
      orderId: originalOrderId,
      detailsLink: `https://www.amazon.com/gp/your-account/order-details?orderID=${originalOrderId}`,
      paymentMethod: "Refund to Card",
      items: [
        {
          title: "Returned Item Refund",
          url: `https://www.amazon.com/gp/product/B07M${Math.floor(100000 + Math.random() * 900000)}`,
          price: refundAmount,
          quantity: 1,
          imageUrl: `https://picsum.photos/seed/refund/100/100`,
          seller: "Amazon.com",
        },
      ],
    });
  }

  // Sort descending
  mockTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  await chrome.storage.local.set({
    transactions: mockTransactions,
    lastScraped: new Date().toISOString(),
  });

  return mockTransactions;
}
