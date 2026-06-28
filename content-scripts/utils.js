/**
 * DataPrime Content Scraper - Utilities & Shared State
 */

// Active scraping state (declared with var to make it a shared global across content scripts)
var scrapingState = {
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

/**
 * Pauses execution for a specified duration in milliseconds.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Converts a date string or Date object to a safe ISO YYYY-MM-DD string representation.
 * @param {string|Date} d - Date to convert.
 * @returns {string}
 */
function safeISO(d) {
  if (!d) return "null";
  try {
    const dateObj = new Date(d);
    return isNaN(dateObj.getTime())
      ? "invalid"
      : dateObj.toISOString().split("T")[0];
  } catch {
    return "error";
  }
}

/**
 * Checks if a DOM element is visible using offset dimensions or client rects.
 * @param {HTMLElement} el - Element to check.
 * @returns {boolean}
 */
function isElementVisible(el) {
  return !!(
    el.offsetWidth ||
    el.offsetHeight ||
    (typeof el.getClientRects === "function" && el.getClientRects().length)
  );
}

// Exports for Node/Bun testing compatibility
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    scrapingState,
    sleep,
    safeISO,
    isElementVisible,
  };
}
