/**
 * DataPrime Content Scraper - DOM Parser & Pagination Helpers
 */

/**
 * Scrapes all transactions listed on the current page.
 * @returns {Array<Object>}
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
 * Parses an individual transaction card / element using multiple strategies.
 * @param {HTMLElement} el - Transaction card element.
 * @param {number} index - DOM position index.
 * @returns {Object|null}
 */
function parseTransactionElement(el, _index) {
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
  // Check highly specific transaction amount classes first
  const amountEl = el.querySelector(
    '.apx-transaction-amount, [id^="apx-transaction-amount-"], .apx-transactions-line-item-amount, [class*="transaction-amount"]',
  );
  if (amountEl) {
    amountText = amountEl.innerText.trim();
  } else {
    // Resilient fallback: search the card text for standard dollar patterns
    const amountMatch = fullText.match(/[+-]?\$[0-9,]+\.[0-9]{2}/);
    if (amountMatch) {
      amountText = amountMatch[0];
    }
  }

  if (!amountText) return null; // Transaction must have an amount

  // 3. Parse Description & Order ID
  let description = "";
  // Check highly specific description classes
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

    // Filter out common action button lines
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

  // Extract Order ID
  let orderIdMatch = fullText.match(/([D\d]\d{2}-\d{7}-\d{7})/i);
  let orderId = orderIdMatch ? orderIdMatch[1] : null;

  // Extract Invoice/Details links
  let orderDetailsUrl = "";
  const linkEl = el.querySelector(
    'a[href*="orderID="], a[href*="order-details"], a[href*="summary/edit.html"]',
  );
  if (linkEl) {
    orderDetailsUrl = linkEl.href;
    // Fallback: extract order ID from orderDetailsUrl href if visible card text lacked it
    if (!orderId) {
      const hrefOrderIdMatch = orderDetailsUrl.match(
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
      (orderDetailsUrl &&
        (orderDetailsUrl.includes("/uff/") ||
          orderDetailsUrl.includes("fresh")));

    if (!orderDetailsUrl) {
      orderDetailsUrl = `https://www.amazon.com/gp/your-account/order-details?orderID=${orderId}`;
      if (isGrocery) {
        orderDetailsUrl = `https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=${orderId}&page=itemmod`;
      } else if (orderId.toUpperCase().startsWith("D")) {
        orderDetailsUrl = `https://www.amazon.com/your-orders/order-details?orderID=${orderId}`;
      }
    } else {
      // Force rewrite to standard UFF details link if it is grocery but had a standard link
      if (
        isGrocery &&
        (!orderDetailsUrl.includes("/uff/") ||
          !orderDetailsUrl.includes("page=itemmod"))
      ) {
        orderDetailsUrl = `https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=${orderId}&page=itemmod`;
      }
    }
  }

  // Generate a stable, unique ID
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
  const id = isRefund
    ? `${baseKey}-${occurrenceIndex}-R`
    : `${baseKey}-${occurrenceIndex}`;

  return {
    id,
    baseKey,
    date: dateISO,
    paymentAmount: numericAmount,
    description: description.replace(/\s+/g, " "),
    orderId,
    orderDetailsUrl,
    paymentMethod: parsePaymentMethod(fullText),
    elementText: fullText,
  };
}

/**
 * Heuristic parsing that scans the document for rows containing transactions.
 * @returns {Array<Object>}
 */
function scrapeHeuristicFallback() {
  const transactions = [];
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
    let parent = el;
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
 * Parses payment method details (e.g. Visa 1234) from text block.
 * @param {string} text - Transaction element text.
 * @returns {string}
 */
function parsePaymentMethod(text) {
  const t = text.toLowerCase();

  // Extract 4 digits
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

/**
 * Checks if a pagination control button or link is disabled.
 * @param {HTMLElement} el - Element to check.
 * @returns {boolean}
 */
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
 * Finds the "Next" button in Amazon pagination.
 * @returns {HTMLElement|null}
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

  // Text search fallback
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
 * Finds the "Previous" button in Amazon pagination.
 * @returns {HTMLElement|null}
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

  // Text search fallback
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

// Exports for Node/Bun testing compatibility
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    scrapeCurrentPage,
    parseTransactionElement,
    scrapeHeuristicFallback,
    parsePaymentMethod,
    isElementDisabled,
    findNextButton,
    findPreviousButton,
  };
}
