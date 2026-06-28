/**
 * DataPrime Content Scraper - Order Itemization & Receipt Parsers
 */

/**
 * Performs same-site Order Details fetching and itemization inside the content script
 * utilizing a concurrent worker pool (concurrency = 5) to process staggers safely and fast.
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

  scrapingState.itemizationProgress = {
    current: 0,
    total: totalCount,
    cachedCount: 0,
  };

  // Notify background/popup to update status immediately
  chrome.runtime.sendMessage({
    action: "SCRAPE_STATUS",
    payload: {
      status: "ITEMIZING",
      message: `Initializing ${CONCURRENCY}-way parallel itemization...`,
      progress: 0,
      currentFetchIndex: 0,
      totalFetchCount: totalCount,
      cachedCount: 0,
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
      if (!scrapingState.itemizationProgress) {
        scrapingState.itemizationProgress = {};
      }
      scrapingState.itemizationProgress.current = currentIdx;
      scrapingState.itemizationProgress.total = totalCount;
      const progress = Math.round((currentIdx / totalCount) * 100);

      // Check if this transaction already has item details in the cache
      if (cacheMap.has(tx.id)) {
        tx.items = cacheMap.get(tx.id);
        scrapingState.itemizationProgress.cachedCount =
          (scrapingState.itemizationProgress.cachedCount || 0) + 1;

        // Extract and assign summary from existing transactions if available
        try {
          const storedRes = await new Promise((resolve) => {
            chrome.storage.local.get("transactions", (data) => {
              resolve(data || {});
            });
          });
          const matchTx = (storedRes.transactions || []).find(
            (t) => t.id === tx.id,
          );
          if (matchTx && matchTx.summary) {
            tx.summary = matchTx.summary;
          }
        } catch (e) {
          console.warn("Failed to restore transaction summary from cache", e);
        }

        if (currentIdx % 5 === 0 || currentIdx === totalCount) {
          logToHUD(
            `Itemized ${currentIdx}/${totalCount} - Loaded from cache: ${tx.orderId}`,
          );
          chrome.runtime.sendMessage({
            action: "SCRAPE_STATUS",
            payload: {
              status: "ITEMIZING",
              message: `Itemized ${currentIdx}/${totalCount} orders (cached)...`,
              progress,
              currentFetchIndex: currentIdx,
              totalFetchCount: totalCount,
            },
          });
        }
        continue;
      }

      // Fetch the order details page via standard window.fetch
      if (!tx.detailsLink) {
        console.warn("No detailsLink for transaction", tx);
        continue;
      }

      try {
        logToHUD(
          `[Worker ${workerId}] Fetching details for Order: ${tx.orderId}...`,
        );

        // Perform HTTP GET request using default credentials cookie authentication
        const response = await fetch(tx.detailsLink, {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const htmlText = await response.text();

        // Check if we got redirected to signin page
        if (
          htmlText.includes("ap/signin") ||
          htmlText.includes("signin.amazon")
        ) {
          throw new Error(
            "Session expired or authentication failed during fetch",
          );
        }

        // Parse items and summary from HTML
        const items = parseOrderDetailsHtml(htmlText, tx.orderId);
        tx.items = items;

        const summary = parseOrderSummary(htmlText);
        if (summary) {
          tx.summary = summary;
        }

        logToHUD(
          `[Worker ${workerId}] Successfully itemized Order ${tx.orderId} (${items.length} items parsed)`,
        );

        // Update progress state
        chrome.runtime.sendMessage({
          action: "SCRAPE_STATUS",
          payload: {
            status: "ITEMIZING",
            message: `Analyzing details for order ${currentIdx}/${totalCount}...`,
            progress,
            currentFetchIndex: currentIdx,
            totalFetchCount: totalCount,
          },
        });
      } catch (err) {
        console.error(`Failed fetching details for Order ${tx.orderId}:`, err);
        logToHUD(`Failed to fetch Order ${tx.orderId}: ${err.message}`);

        // Maintain fallback default items structure so dashboard never crashes
        tx.items = [
          {
            title: tx.description || "Amazon Purchase (Details Unreachable)",
            url:
              tx.detailsLink ||
              `https://www.amazon.com/gp/your-account/order-details?orderID=${tx.orderId}`,
            price: tx.amount,
            quantity: 1,
            imageUrl: "",
            seller: "Amazon.com",
          },
        ];
      }

      // Add a randomized human-like delay (1.2s - 2.8s) to avoid bot detection rate limits
      const delay = 1200 + Math.random() * 1600;
      await sleep(delay);
    }
  }

  // Spawn parallel workers
  const workers = [];
  for (let w = 1; w <= CONCURRENCY; w++) {
    workers.push(worker(w));
  }

  // Await all workers to conclude their tasks
  await Promise.all(workers);

  if (scrapingState.active) {
    await concludeScrape();
  }
}

/**
 * Resilient DOM-based parsing of Amazon's Order Details page HTML.
 * @param {string} html - Raw HTML source of details page.
 * @param {string} orderId - Order identifier.
 * @returns {Array<Object>}
 */
function parseOrderDetailsHtml(html, orderId) {
  const items = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Find all item blocks
    let blocks = doc.querySelectorAll(".yohtmlc-item");

    // Selector 2: Standard desktop grid blocks
    if (blocks.length === 0) {
      blocks = doc.querySelectorAll(".a-fixed-left-grid");
    }

    // Selector 3: Find links with product patterns
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

  // Fallback if DOMParser found nothing
  if (items.length === 0) {
    console.log(
      "[DataPrime Parser] DOMParser itemization found 0 items. Running regex fallback...",
    );
    return parseOrderDetailsHtmlRegexFallback(html, orderId);
  }

  return items;
}

/**
 * Extracts order summary values (subtotals, totals, refunds) from details HTML.
 * @param {string} html - Raw HTML source.
 * @returns {Object|null}
 */
function parseOrderSummary(html) {
  const summary = {};
  const cleanHtml = html.replace(/\s+/g, " ");

  const extractAmountNearKeyword = (keyword) => {
    const idx = cleanHtml.indexOf(keyword);
    if (idx === -1) return null;
    const sub = cleanHtml.substring(idx, idx + 400);
    const match = sub.match(/\$[0-9,]+\.[0-9]{2}/);
    return match ? parseFloat(match[0].replace(/[^\d.]/g, "")) : null;
  };

  summary.itemSubtotal = extractAmountNearKeyword("Item(s) Subtotal");
  summary.shippingHandling =
    extractAmountNearKeyword("Shipping &amp; Handling") ??
    extractAmountNearKeyword("Shipping & Handling");
  summary.taxCollected = extractAmountNearKeyword(
    "Estimated tax to be collected",
  );
  summary.grandTotal = extractAmountNearKeyword("Grand Total:");

  summary.itemsRefund = extractAmountNearKeyword("Item(s) refund");
  summary.taxRefund = extractAmountNearKeyword("Tax refund");
  summary.refundTotal = extractAmountNearKeyword("Refund Total");

  const hasValues = Object.values(summary).some((val) => val !== null);
  return hasValues ? summary : null;
}

/**
 * Resilient RegExp parsing of Amazon's Order Details page HTML.
 * @param {string} html - Raw HTML source.
 * @param {string} orderId - Order identifier.
 * @returns {Array<Object>}
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

  const asinRegex = /\/(?:gp\/product|dp|gp\/aw\/d)\/([A-Z0-9]{10})\b/gi;
  let match;
  const matchedIdentifiers = new Map();

  while ((match = asinRegex.exec(mainContent)) !== null) {
    if (!matchedIdentifiers.has(match[1])) {
      matchedIdentifiers.set(match[1], match.index);
    }
  }

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
 * Detects if parsed metadata belongs to an advertisement or promotional link.
 * @param {string} title - Product title.
 * @param {number} price - Unit price.
 * @returns {boolean}
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

// Exports for Node/Bun testing compatibility
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    runItemizationInContentScript,
    parseOrderDetailsHtml,
    parseOrderSummary,
    parseOrderDetailsHtmlRegexFallback,
    isPromotionalItem,
  };
}
