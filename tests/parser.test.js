/**
 * DataPrime Parser and Deduplication Test Suite
 * Zero-dependency unit tests running natively under Node.js --test
 */

// Mock standard browser globals for Node.js environment before requiring content.js
globalThis.window = {
  location: {
    href: "https://www.amazon.com/cpe/yourpayments/transactions",
  },
};
globalThis.chrome = {
  storage: {
    local: {
      get(key, callback) {
        callback({});
      },
      set(data, callback) {
        if (callback) callback();
      },
      remove(key, callback) {
        if (callback) callback();
      },
    },
  },
  runtime: {
    onMessage: {
      addListener() {},
    },
    sendMessage() {},
  },
};

const test = require("node:test");
const assert = require("node:assert");
const {
  scrapingState,
  parseTransactionElement,
  parseOrderDetailsHtmlRegexFallback,
  parsePaymentMethod,
  isElementDisabled,
  isElementVisible,
  findPreviousButton,
  findNextButton,
  parseOrderSummary,
} = require("../content.js");

// Helper to reset scrapingState duplicate occurrence counters before tests
function resetScrapingState() {
  scrapingState.occurrenceCounts = {};
  scrapingState.lastPageTransactionBaseKeys = null;
  scrapingState.consecutiveEmptyPages = 0;
  scrapingState.scrapedTransactions = [];
  scrapingState.startDate = null;
  scrapingState.endDate = null;
}

test("1. parseOrderDetailsHtmlRegexFallback() - Digital Subscription Parsing", () => {
  const mockDigitalHtml = `
      <div id="orderDetails">
        <div class="a-box">
          <div class="a-row">
            <a href="/gp/digital/your-memberships-and-subscriptions/association?id=sub_123456" class="a-link-normal">
              Amazon Music Unlimited
            </a>
            <span class="a-color-price">$10.99</span>
            <span class="quantity">Qty: 1</span>
            <span>Sold by: Amazon.com Services LLC</span>
          </div>
        </div>
      </div>
    `;

  const orderId = "D01-0968278-2659453";
  const items = parseOrderDetailsHtmlRegexFallback(mockDigitalHtml, orderId);

  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, "Amazon Music Unlimited");
  assert.strictEqual(items[0].price, 10.99);
  assert.strictEqual(items[0].quantity, 1);
  assert.strictEqual(items[0].seller, "Amazon.com Services LLC");
  assert.ok(items[0].url.includes("your-memberships-and-subscriptions"));
});

test("2. parseOrderDetailsHtmlRegexFallback() - Grocery Order Details Parsing", () => {
  // Add 1500 characters of padding spacing between item blocks to replicate standard DOM spacing
  // and prevent 1000-character regex context window overlap.
  const mockGroceryHtml = `
      <div class="orderDetails">
        <div class="a-row">
          <a href="/gp/product/B078123456" class="yohtmlc-product-title">
            Organic Honeycrisp Apples, 3lb bag
          </a>
          <span class="yohtmlc-item-price">$6.99</span>
          <span class="yohtmlc-item-quantity">Qty: 2</span>
          <span>Sold by: Whole Foods Market</span>
        </div>
        ${" ".repeat(1500)}
        <div class="a-row">
          <a href="/gp/product/B078654321" class="yohtmlc-product-title">
            Fresh Sliced Turkey Breast, 16oz
          </a>
          <span class="yohtmlc-item-price">$8.49</span>
          <span class="yohtmlc-item-quantity">Qty: 1</span>
          <span>Sold by: Whole Foods Market</span>
        </div>
      </div>
    `;

  const orderId = "112-7743642-4499445";
  const items = parseOrderDetailsHtmlRegexFallback(mockGroceryHtml, orderId);

  assert.strictEqual(items.length, 2);

  assert.strictEqual(items[0].title, "Organic Honeycrisp Apples, 3lb bag");
  assert.strictEqual(items[0].price, 6.99);
  assert.strictEqual(items[0].quantity, 2);
  assert.strictEqual(items[0].seller, "Whole Foods Market");

  assert.strictEqual(items[1].title, "Fresh Sliced Turkey Breast, 16oz");
  assert.strictEqual(items[1].price, 8.49);
  assert.strictEqual(items[1].quantity, 1);
  assert.strictEqual(items[1].seller, "Whole Foods Market");
});

test("3. parseTransactionElement() - Standard Transactions parsing", () => {
  resetScrapingState();

  const mockText = `
      Amazon.com Order # 114-9876543-2109876
      -$45.50
      Payment Method: Visa ending in 9876
      View Details
    `;

  const mockEl = {
    innerText: mockText,
    querySelector(selector) {
      if (selector.includes("date") || selector.includes("secondary")) {
        return { innerText: "Jan 25, 2026" };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const parsed = parseTransactionElement(mockEl, 0);

  assert.ok(parsed);
  assert.strictEqual(parsed.orderId, "114-9876543-2109876");
  assert.strictEqual(parsed.date, "2026-01-25");
  assert.strictEqual(parsed.amount, 45.5); // Charges should be stored as positive amounts
  assert.strictEqual(parsed.paymentMethod, "Visa (*9876)");
  assert.strictEqual(parsed.id, "114-9876543-2109876-2026-01-25-45.50-0");
});

test("4. parseTransactionElement() - Refund Transactions parsing", () => {
  resetScrapingState();

  const mockText = `
      Refund for Order # 114-9876543-2109876
      +$15.20
      Payment Method: Visa ending in 9876
    `;

  const mockEl = {
    innerText: mockText,
    querySelector(selector) {
      if (selector.includes("date") || selector.includes("secondary")) {
        return { innerText: "Feb 12, 2026" };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const parsed = parseTransactionElement(mockEl, 0);

  assert.ok(parsed);
  assert.strictEqual(parsed.amount, -15.2); // Refunds should be stored as negative amounts
  assert.strictEqual(parsed.id, "114-9876543-2109876-2026-02-12-15.20-0");
});

test("5. parseTransactionElement() - Split charges stateful sequence ID tracking", () => {
  resetScrapingState();

  const mockText = `
      Amazon.com Order # 112-7743642-4499445
      -$11.75
      Payment Method: Visa ending in 4321
    `;

  const mockEl = {
    innerText: mockText,
    querySelector(selector) {
      if (selector.includes("date") || selector.includes("secondary")) {
        return { innerText: "Mar 04, 2026" };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  // First transaction charge
  const parsed1 = parseTransactionElement(mockEl, 0);
  // Second identical charge on same order, same day, same amount (split charges)
  const parsed2 = parseTransactionElement(mockEl, 1);
  // Third identical charge
  const parsed3 = parseTransactionElement(mockEl, 2);

  assert.ok(parsed1);
  assert.ok(parsed2);
  assert.ok(parsed3);

  // Ensure occurrence suffixes are sequential and stable
  assert.strictEqual(parsed1.id, "112-7743642-4499445-2026-03-04-11.75-0");
  assert.strictEqual(parsed2.id, "112-7743642-4499445-2026-03-04-11.75-1");
  assert.strictEqual(parsed3.id, "112-7743642-4499445-2026-03-04-11.75-2");
});

test("6. parsePaymentMethod() - Brand extraction and trailing card digits", () => {
  assert.strictEqual(parsePaymentMethod("Visa ending in 4821"), "Visa (*4821)");
  assert.strictEqual(parsePaymentMethod("MC *5566"), "MasterCard (*5566)");
  assert.strictEqual(parsePaymentMethod("Amex ending in 1002"), "Amex (*1002)");
  assert.strictEqual(
    parsePaymentMethod("Discover card ending in 9081"),
    "Discover (*9081)",
  );
  assert.strictEqual(
    parsePaymentMethod("Paid with Amazon Gift Card"),
    "Amazon Gift Card",
  );
  assert.strictEqual(
    parsePaymentMethod("Amazon Account Balance and Visa 1122"),
    "Visa (*1122)",
  );
});

test("7. isElementDisabled() - Disabled navigation controls detection", () => {
  const mockDisabledEl = {
    disabled: true,
    getAttribute(attr) {
      return attr === "disabled" ? "true" : null;
    },
    classList: {
      contains() {
        return false;
      },
    },
    closest() {
      return null;
    },
  };

  const mockClassDisabledEl = {
    disabled: false,
    getAttribute() {
      return null;
    },
    classList: {
      contains(cls) {
        return cls === "a-disabled" || cls === "a-button-disabled";
      },
    },
    closest() {
      return null;
    },
  };

  const mockAriaDisabledEl = {
    disabled: false,
    getAttribute(attr) {
      return attr === "aria-disabled" ? "true" : null;
    },
    classList: {
      contains() {
        return false;
      },
    },
    closest() {
      return null;
    },
  };

  const mockChildAriaDisabledEl = {
    disabled: false,
    getAttribute() {
      return null;
    },
    classList: {
      contains() {
        return false;
      },
    },
    closest(sel) {
      return sel.includes("aria-disabled") ? {} : null;
    },
  };

  const mockActiveEl = {
    disabled: false,
    getAttribute() {
      return null;
    },
    classList: {
      contains() {
        return false;
      },
    },
    closest() {
      return null;
    },
  };

  assert.strictEqual(isElementDisabled(mockDisabledEl), true);
  assert.strictEqual(isElementDisabled(mockClassDisabledEl), true);
  assert.strictEqual(isElementDisabled(mockAriaDisabledEl), true);
  assert.strictEqual(isElementDisabled(mockChildAriaDisabledEl), true);
  assert.strictEqual(isElementDisabled(mockActiveEl), false);
});

test("8. isElementVisible() - Offset dimension and client rect check", () => {
  const visibleEl1 = {
    offsetWidth: 10,
    offsetHeight: 0,
    getClientRects() {
      return [];
    },
  };
  const visibleEl2 = {
    offsetWidth: 0,
    offsetHeight: 15,
    getClientRects() {
      return [];
    },
  };
  const visibleEl3 = {
    offsetWidth: 0,
    offsetHeight: 0,
    getClientRects() {
      return [{}];
    },
  };
  const hiddenEl = {
    offsetWidth: 0,
    offsetHeight: 0,
    getClientRects() {
      return [];
    },
  };

  assert.strictEqual(isElementVisible(visibleEl1), true);
  assert.strictEqual(isElementVisible(visibleEl2), true);
  assert.strictEqual(isElementVisible(visibleEl3), true);
  assert.strictEqual(isElementVisible(hiddenEl), false);
});

test("9. parsePaymentMethod() - Advanced brand matching fallback cases", () => {
  // Unbranded card digits matching
  assert.strictEqual(
    parsePaymentMethod("Paid with Card ending in 7744"),
    "Card (*7744)",
  );
  // MC lower/upper case matching
  assert.strictEqual(
    parsePaymentMethod("charged to mastercard 3322"),
    "MasterCard (*3322)",
  );
  assert.strictEqual(
    parsePaymentMethod("charged to mc 5544"),
    "MasterCard (*5544)",
  );
  // Amazon Account Balance matching
  assert.strictEqual(
    parsePaymentMethod("Paid with checking account"),
    "Amazon Account Balance",
  );
});

test("10. parseOrderDetailsHtmlRegexFallback() - Quantity parsing edge cases", () => {
  // Use valid 10-character Amazon ASIN codes to satisfy strict regex matcher constraints
  const mockHtml1 = `
      <a href="/gp/product/B07XYZ1234">Item Title</a>
      <span>Quantity: 5</span>
      <span>Sold by: Amazon.com</span>
      <span>$12.00</span>
    `;
  const mockHtml2 = `
      <a href="/gp/product/B07ABC5678">Another Item</a>
      <span>Qty: 10</span>
      <span>Sold by: Amazon.com</span>
      <span>$5.50</span>
    `;
  const mockHtml3 = `
      <a href="/gp/product/B07DEF9012">Third Item</a>
      <span>Qty: 12</span>
      <span>Sold by: Amazon.com</span>
      <span>$2.00</span>
    `;

  const items1 = parseOrderDetailsHtmlRegexFallback(mockHtml1, "111");
  const items2 = parseOrderDetailsHtmlRegexFallback(mockHtml2, "222");
  const items3 = parseOrderDetailsHtmlRegexFallback(mockHtml3, "333");

  assert.strictEqual(items1.length, 1);
  assert.strictEqual(items2.length, 1);
  assert.strictEqual(items3.length, 1);

  assert.strictEqual(items1[0].quantity, 5);
  assert.strictEqual(items2[0].quantity, 10);
  assert.strictEqual(items3[0].quantity, 12);
});

test("11. parseOrderDetailsHtmlRegexFallback() - Seller parsing and image extraction variations", () => {
  const mockHtml = `
      <a href="/gp/product/B078IMAGES">Photo Album</a>
      <img src="https://images-na.ssl-images-amazon.com/images/I/71xyz.jpg" />
      <span>Sold by: <a href="/gp/help/seller.html">Marketplace Seller Inc</a></span>
      <span>$19.99</span>
    `;

  const items = parseOrderDetailsHtmlRegexFallback(mockHtml, "999");

  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].seller, "Marketplace Seller Inc");
  assert.strictEqual(
    items[0].imageUrl,
    "https://images-na.ssl-images-amazon.com/images/I/71xyz.jpg",
  );
});

test("12. parseTransactionElement() - Grocery order URL redirection overrides", () => {
  resetScrapingState();

  const mockGroceryText = `
      Amazon Fresh Grocery Purchase
      Order # 112-8888888-8888888
      -$29.40
      Payment Method: Visa ending in 1234
    `;

  // Mock an anchor link that points to standard details, but card states "Fresh Grocery"
  const mockEl = {
    innerText: mockGroceryText,
    querySelector(selector) {
      if (selector.includes("date") || selector.includes("secondary")) {
        return { innerText: "Apr 18, 2026" };
      }
      if (
        selector.includes("orderID") ||
        selector.includes("order-details") ||
        selector.includes("a[")
      ) {
        return {
          href: "https://www.amazon.com/gp/your-account/order-details?orderID=112-8888888-8888888",
        };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const parsed = parseTransactionElement(mockEl, 0);

  assert.ok(parsed);
  // Standard link MUST be dynamically overridden and rewritten to a Fresh/Whole Foods UFF link
  assert.ok(parsed.detailsLink.includes("/uff/your-account/order-details"));
  assert.ok(parsed.detailsLink.includes("page=itemmod"));
  assert.ok(parsed.detailsLink.includes("orderID=112-8888888-8888888"));
});

test("13. startScrapingLoop loop protection - Duplicate page content hash matching", () => {
  const pageTransactions = [
    { id: "tx-1-0", baseKey: "tx-1", date: "2026-06-01", amount: 10.0 },
    { id: "tx-2-0", baseKey: "tx-2", date: "2026-06-01", amount: 20.0 },
  ];

  // Case A: Page transaction baseKeys match previous page baseKeys completely (indicating a pagination failure)
  const lastPageTransactionBaseKeysMatches = ["tx-1", "tx-2"];
  const currentPageBaseKeys = pageTransactions.map((t) => t.baseKey);
  const isPageIdenticalMatches =
    currentPageBaseKeys.length > 0 &&
    lastPageTransactionBaseKeysMatches &&
    currentPageBaseKeys.length === lastPageTransactionBaseKeysMatches.length &&
    currentPageBaseKeys.every(
      (key, idx) => key === lastPageTransactionBaseKeysMatches[idx],
    );

  assert.strictEqual(isPageIdenticalMatches, true);

  // Case B: Page transaction baseKeys differ from previous page (successful pagination navigation)
  const lastPageTransactionBaseKeysDiffers = ["tx-3", "tx-4"];
  const isPageIdenticalDiffers =
    currentPageBaseKeys.length > 0 &&
    lastPageTransactionBaseKeysDiffers &&
    currentPageBaseKeys.length === lastPageTransactionBaseKeysDiffers.length &&
    currentPageBaseKeys.every(
      (key, idx) => key === lastPageTransactionBaseKeysDiffers[idx],
    );

  assert.strictEqual(isPageIdenticalDiffers, false);
});

test("14. parseTransactionElement() - Missing or invalid fields handling", () => {
  resetScrapingState();

  // Case A: Missing transaction amount
  const mockTextNoAmount = `
      Amazon.com Order # 114-1111111-1111111
      Payment Method: Visa ending in 9876
    `;
  const mockElNoAmount = {
    innerText: mockTextNoAmount,
    querySelector(selector) {
      if (selector.includes("date")) return { innerText: "Jan 12, 2026" };
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  assert.strictEqual(parseTransactionElement(mockElNoAmount, 0), null);

  // Case B: Invalid date text
  const mockTextBadDate = `
      Amazon.com Order # 114-1111111-1111111
      -$20.00
      Payment Method: Visa ending in 9876
    `;
  const mockElBadDate = {
    innerText: mockTextBadDate,
    querySelector(selector) {
      if (selector.includes("date")) return { innerText: "Not A Date String" };
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  assert.strictEqual(parseTransactionElement(mockElBadDate, 0), null);
});

test("15. parseOrderDetailsHtmlRegexFallback() - Seller fallback when absent", () => {
  const mockHtmlNoSeller = `
      <a href="/gp/product/B078NOSELL">Product No Seller</a>
      <span>Quantity: 1</span>
      <span>$50.00</span>
    `;

  const items = parseOrderDetailsHtmlRegexFallback(mockHtmlNoSeller, "555");
  assert.strictEqual(items.length, 1);
  // Should fallback cleanly to "Amazon.com"
  assert.strictEqual(items[0].seller, "Amazon.com");
});

test("16. parseOrderDetailsHtmlRegexFallback() - Multiple digital synthetic ASIN indexing bounds", () => {
  const mockHtmlMultipleDigital = `
      <a href="/gp/video/detail/B001">Video Course A</a>
      <span>$1.99</span>
      ${" ".repeat(1500)}
      <a href="/gp/video/detail/B002">Video Course B</a>
      <span>$2.99</span>
    `;

  const items = parseOrderDetailsHtmlRegexFallback(
    mockHtmlMultipleDigital,
    "D01-99999",
  );
  assert.strictEqual(items.length, 2);
  // Verify separate synthetic ASIN IDs are generated sequentially (digital-orderId-0, digital-orderId-1)
  assert.strictEqual(items[0].url.includes("B001"), true);
  assert.strictEqual(items[1].url.includes("B002"), true);
});

test("17. startScrapingLoop() - Date range accumulation boundary logic", () => {
  resetScrapingState();

  // Setup scraping range constraints
  scrapingState.startDate = "2026-05-10";
  scrapingState.endDate = "2026-05-20";

  const t1 = { id: "tx-1", date: "2026-05-22", amount: 10.0 }; // Case A: Too new (> endDate)
  const t2 = { id: "tx-2", date: "2026-05-15", amount: 15.0 }; // Case B: In-range (added!)
  const t3 = { id: "tx-3", date: "2026-05-05", amount: 20.0 }; // Case C: Too old (< startDate, triggers finish)

  const scrapedMockList = [t1, t2, t3];
  let outOfRangeStartReached = false;
  const filterStart = scrapingState.startDate
    ? new Date(scrapingState.startDate)
    : null;
  const filterEnd = scrapingState.endDate
    ? new Date(scrapingState.endDate)
    : null;
  const filterStartTs =
    filterStart && !isNaN(filterStart.getTime()) ? filterStart.getTime() : null;
  const filterEndTs =
    filterEnd && !isNaN(filterEnd.getTime()) ? filterEnd.getTime() : null;

  for (const tx of scrapedMockList) {
    const txDate = new Date(tx.date);
    const txTime = txDate.getTime();
    if (filterEndTs && txTime > filterEndTs) {
      continue; // skip
    }
    if (filterStartTs && txTime < filterStartTs) {
      outOfRangeStartReached = true;
      break; // stop
    }
    scrapingState.scrapedTransactions.push(tx);
  }

  assert.strictEqual(scrapingState.scrapedTransactions.length, 1);
  assert.strictEqual(scrapingState.scrapedTransactions[0].id, "tx-2");
  assert.strictEqual(outOfRangeStartReached, true);
});

test("18. findPreviousButton() - Page 1 checking assertions", () => {
  // We temporarily override standard global document queries to simulate pagination states
  const originalQuerySelector = globalThis.document
    ? globalThis.document.querySelector
    : null;
  const originalQuerySelectorAll = globalThis.document
    ? globalThis.document.querySelectorAll
    : null;

  globalThis.document = {
    body: {
      appendChild() {},
    },
    createElement() {
      return {
        id: "",
        style: {},
        appendChild() {},
        addEventListener() {},
        remove() {},
        innerHTML: "",
        innerText: "",
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      };
    },
    querySelector(selector) {
      if (selector.includes("PreviousPage")) {
        return {
          tagName: "INPUT",
          offsetWidth: 20,
          offsetHeight: 20,
          getClientRects() {
            return [{}];
          },
          disabled: false,
          getAttribute() {
            return null;
          },
          classList: {
            contains() {
              return false;
            },
          },
          closest() {
            return null;
          },
        };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const prevButton = findPreviousButton();
  assert.ok(prevButton);
  assert.strictEqual(prevButton.tagName, "INPUT");

  // Cleanup global mock
  if (originalQuerySelector) {
    globalThis.document.querySelector = originalQuerySelector;
    globalThis.document.querySelectorAll = originalQuerySelectorAll;
  } else {
    delete globalThis.document;
  }
});

test("19. parseTransactionElement() - Current-year transaction dates parsing (no year present)", () => {
  resetScrapingState();

  const mockText = `
      Amazon.com Order # 114-1234567-1234567
      -$19.99
      Payment Method: Visa ending in 1234
    `;

  const mockEl = {
    innerText: mockText,
    querySelector(selector) {
      if (selector.includes("date") || selector.includes("secondary")) {
        return { innerText: "May 25" };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const parsed = parseTransactionElement(mockEl, 0);

  assert.ok(parsed);
  assert.strictEqual(parsed.orderId, "114-1234567-1234567");

  // Construct expected ISO date using current year and timezone logic resiliently
  const expectedYear = new Date().getFullYear();
  const expectedDate = new Date(Date.parse(`May 25, ${expectedYear}`))
    .toISOString()
    .split("T")[0];
  assert.strictEqual(parsed.date, expectedDate);
  assert.strictEqual(parsed.amount, 19.99);
});

test("20. findNextButton() - Next page control checking & circular link filtering", () => {
  // Override global document queries to simulate a pagination container with individual page numbers
  const originalQuerySelector = globalThis.document
    ? globalThis.document.querySelector
    : null;

  globalThis.document = {
    body: { appendChild() {} },
    createElement() {
      return {
        id: "",
        style: {},
        appendChild() {},
        addEventListener() {},
        remove() {},
        innerHTML: "",
        innerText: "",
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      };
    },
    querySelector(selector) {
      // Mock a real Next Page button input or element
      if (selector.includes("NextPage") || selector.includes("a.next")) {
        return {
          tagName: "INPUT",
          name: "DefaultNextPageNavigationEvent",
          offsetWidth: 20,
          offsetHeight: 20,
          getClientRects() {
            return [{}];
          },
          disabled: false,
          getAttribute() {
            return null;
          },
          classList: {
            contains() {
              return false;
            },
          },
          closest() {
            return null;
          },
        };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const nextButton = findNextButton();
  assert.ok(nextButton);
  assert.strictEqual(nextButton.name, "DefaultNextPageNavigationEvent");

  // Cleanup global mock
  if (originalQuerySelector) {
    globalThis.document.querySelector = originalQuerySelector;
  } else {
    delete globalThis.document;
  }
});

/**
 * Test 21: Verify that promotional items (credit card ads, Prime Video recommendations)
 * that are parsed as $0.00 fallback items are correctly detected and excluded.
 */
test("21. parseOrderDetailsHtmlRegexFallback() - Skip promotional/advertisement items", () => {
  const mockHtml = `
      <div class="orderDetails">
        <!-- Valid purchase item -->
        <div class="a-row">
          <a href="/gp/product/B07PROD123" class="yohtmlc-product-title">
            Valid Purchase Item
          </a>
          <span class="yohtmlc-item-price">$12.99</span>
          <span class="yohtmlc-item-quantity">Qty: 1</span>
          <span>Sold by: Amazon.com</span>
        </div>
        ${" ".repeat(1500)}
        <!-- Amazon Secured Card Ad -->
        <div class="a-row">
          <a href="/dp/B08SECURED" class="yohtmlc-product-title">
            Amazon Secured Card
          </a>
          <span class="yohtmlc-item-quantity">Qty: 1</span>
          <span>Sold by: Amazon</span>
        </div>
        ${" ".repeat(1500)}
        <!-- Prime Video Ad Link -->
        <div class="a-row">
          <a href="/gp/video/detail/B09VIDEO" class="yohtmlc-product-title">
            Prime Video - Stream Movies
          </a>
          <span class="yohtmlc-item-quantity">Qty: 1</span>
          <span>Sold by: Amazon</span>
        </div>
      </div>
    `;

  const items = parseOrderDetailsHtmlRegexFallback(
    mockHtml,
    "111-2222222-3333333",
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, "Valid Purchase Item");
  assert.strictEqual(items[0].price, 12.99);
});

test("22. parseOrderSummary() - Parsing full and refund summaries", () => {
  const mockHtml = `
    <div class="a-column a-span12">
        <div class="a-row a-spacing-small">
            <h5>Order Summary</h5>
        </div>
        <ul class="a-unordered-list a-nostyle a-vertical">
            <li>
                <div class="a-row od-line-item-row">
                    <div class="a-column a-span7 od-line-item-row-label">
                        <span class="a-size-base"><span>Item(s) Subtotal: </span></span>
                    </div>
                    <div class="a-column a-span5 od-line-item-row-content a-span-last">
                        <span class="a-size-base a-color-base">$115.95</span>
                    </div>
                </div>
            </li>
            <li>
                <div class="a-row od-line-item-row">
                    <div class="a-column a-span7 od-line-item-row-label">
                        <span class="a-size-base"><span>Shipping &amp; Handling:</span></span>
                    </div>
                    <div class="a-column a-span5 od-line-item-row-content a-span-last">
                        <span class="a-size-base a-color-base">$0.00</span>
                    </div>
                </div>
            </li>
            <li>
                <div class="a-row od-line-item-row">
                    <div class="a-column a-span7 od-line-item-row-label">
                        <span class="a-size-base"><span>Estimated tax to be collected:</span></span>
                    </div>
                    <div class="a-column a-span5 od-line-item-row-content a-span-last">
                        <span class="a-size-base a-color-base">$10.60</span>
                    </div>
                </div>
            </li>
            <li>
                <div class="a-row od-line-item-row">
                    <div class="a-column a-span7 od-line-item-row-label">
                        <span class="a-size-base a-color-base a-text-bold"><span>Grand Total:</span></span>
                    </div>
                    <div class="a-column a-span5 od-line-item-row-content a-span-last">
                        <span class="a-size-base a-color-base a-text-bold">$126.83</span>
                    </div>
                </div>
            </li>
            <li>
                <div class="a-row od-line-item-row">
                    <div class="a-column a-span7 od-line-item-row-label">
                        <span class="a-declarative" data-action="a-popover" data-a-popover="{&quot;closeButton&quot;:&quot;false&quot;,&quot;name&quot;:&quot;charge-summary-inline-popover-6&quot;,&quot;width&quot;:&quot;350&quot;,&quot;inlineContent&quot;:&quot;\\u003cdiv class=\\&quot;a-row od-line-item-row\\&quot;&gt;\\n                        \\u003cdiv class=\\&quot;a-column a-span9 od-line-item-row-label\\&quot;&gt;\\n                            \\n                            \\n\\n\\n\\n\\n\\n\\n\\n    \\n    \\n    \\n        \\u003cspan class=\\&quot;a-size-base\\&quot;&gt;\\n            \\u003cspan&gt;Item(s) refund\\u003c/span&gt;\\n        \\u003c/span&gt;\\n    \\n\\n                        \\u003c/div&gt;\\n                        \\u003cdiv class=\\&quot;a-column a-span3 od-line-item-row-content a-span-last\\&quot;&gt;\\n                            \\n                            \\n\\n\\n\\n\\n\\n\\n            \\n                \\u003cspan class=\\&quot;a-size-base a-color-base\\&quot;&gt;\\n                    $54.98\\n                \\u003c/span&gt;\\n            \\n            \\n            \\n            \\n        \\n                        \\u003c/div&gt;\\n                    \\u003c/div&gt;\\n                \\n                \\n            \\n        \\n            \\n                \\n                    \\u003cdiv class=\\&quot;a-row od-line-item-row\\&quot;&gt;\\n                        \\u003cdiv class=\\&quot;a-column a-span9 od-line-item-row-label\\&quot;&gt;\\n                            \\n                            \\n\\n\\n\\n\\n\\n\\n\\n    \\n    \\n    \\n        \\u003cspan class=\\&quot;a-size-base\\&quot;&gt;\\n            \\u003cspan&gt;Tax refund\\u003c/span&gt;\\n        \\u003c/span&gt;\\n    \\n\\n                        \\u003c/div&gt;\\n                        \\u003cdiv class=\&quot;a-column a-span3 od-line-item-row-content a-span-last\\&quot;&gt;\\n                            \\n                            \\n\\n\\n\\n\\n\\n\\n            \\n                \\u003cspan class=\&quot;a-size-base a-color-base\\&quot;&gt;\\n                    $5.03\\n                \\u003c/span&gt;\\n            \\n            \\n            \\n            \\n        \\n                        \\u003c/div&gt;\\n                    \\u003c/div&gt;\\n                \\n                \\n            \\n        \\n            \\n                \\n                    \\u003cdiv class=\\&quot;a-row od-line-item-row\\&quot;&gt;\\n                        \\u003cdiv class=\\&quot;a-column a-span9 od-line-item-row-label\\&quot;&gt;\\n                            \\n                            \\n\\n\\n\\n\\n\\n\\n\\n    \\n    \\n        \\n        \\n\\n\\n\\n\\n\\n\\u003cspan class=\\&quot;a-size-base a-color-base a-text-bold\\&quot;&gt;\\n    \\u003cspan&gt;Refund Total\\u003c/span&gt;\\n\\u003c/span&gt;\\n    \\n    \\n\\n                        \\u003c/div&gt;\\n                        \\u003cdiv class=\&quot;a-column a-span3 od-line-item-row-content a-span-last\\&quot;&gt;\\n                            \\n                            \\n\\n\\n\\n\\n\\n\\n            \\n            \\n                \\n                \\n\\n\\n\\n\\n\\u003cspan class=\\&quot;a-size-base a-color-base a-text-bold\\&quot;&gt;\\n    $60.01\\n\\u003c/span&gt;\\n            \\n            \\n            \\n        \\n                        \\u003c/div&gt;\\n                    \\u003c/div&gt;&quot;,&quot;position&quot;:&quot;triggerBottom&quot;}">
                            <a href="javascript:void(0)" role="button" class="a-popover-trigger a-declarative">
                                <span class="a-size-base a-color-base a-text-bold"><span>Refund Total</span></span>
                                <i class="a-icon a-icon-popover"></i>
                            </a>
                        </span>
                    </div>
                    <div class="a-column a-span5 od-line-item-row-content a-span-last">
                        <span class="a-size-base a-color-base a-text-bold">$60.01</span>
                    </div>
                </div>
            </li>
        </ul>
    </div>
  `;

  const summary = parseOrderSummary(mockHtml);
  assert.ok(summary);
  assert.strictEqual(summary.itemSubtotal, 115.95);
  assert.strictEqual(summary.shippingHandling, 0.0);
  assert.strictEqual(summary.taxCollected, 10.6);
  assert.strictEqual(summary.grandTotal, 126.83);
  assert.strictEqual(summary.itemsRefund, 54.98);
  assert.strictEqual(summary.taxRefund, 5.03);
  assert.strictEqual(summary.refundTotal, 60.01);
});
