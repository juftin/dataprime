/**
 * DataPrime Purchase Analytics Dashboard Controller
 */

import {
  formatCurrency,
  escapeHtml,
  debounce,
  getRefundItems,
  exportToCSV as exportToCSVEngine,
  exportToJSON as exportToJSONEngine,
} from "./exporters.js";

import { renderChart as renderChartEngine } from "./charts.js";

document.addEventListener("DOMContentLoaded", () => {
  // Local state variables
  let allTransactions = [];
  let filteredTransactions = [];
  let chartMode = "monthly"; // monthly or cumulative
  let registryMode = "grouped"; // grouped, itemized or json
  let sidebarCollapsed = false;
  let sortField = "date"; // active sorting column field
  let sortDir = "desc"; // sort order direction (asc or desc)

  // DOM Elements - Sidebar Filters
  const searchInput = document.getElementById("searchInput");
  const filterStartDate = document.getElementById("filterStartDate");
  const filterEndDate = document.getElementById("filterEndDate");
  const filterMinPrice = document.getElementById("filterMinPrice");
  const filterMaxPrice = document.getElementById("filterMaxPrice");
  const chkShowOrders = document.getElementById("chkShowOrders");
  const chkShowRefunds = document.getElementById("chkShowRefunds");

  const btnExportData = document.getElementById("btnExportData");
  const btnResetFilters = document.getElementById("btnResetFilters");
  const btnSeedDemo = document.getElementById("btnSeedDemo");
  const btnClearData = document.getElementById("btnClearData");
  const btnThemeToggle = document.getElementById("btnThemeToggle");
  const btnToggleSidebar = document.getElementById("btnToggleSidebar");
  const btnExpandSidebar = document.getElementById("btnExpandSidebar");
  const sidebarEl = document.querySelector(".sidebar");
  const mainContentEl = document.querySelector(".main-content");

  // DOM Elements - Header & Stats
  const btnAnalyzeMore = document.getElementById("btnAnalyzeMore");

  const kpiSpending = document.getElementById("kpiSpending");
  const kpiSpendingSub = document.getElementById("kpiSpendingSub");
  const kpiRefunds = document.getElementById("kpiRefunds");
  const kpiRefundsSub = document.getElementById("kpiRefundsSub");
  const kpiTxCount = document.getElementById("kpiTxCount");
  const kpiTxSub = document.getElementById("kpiTxSub");
  const kpiTotalItems = document.getElementById("kpiTotalItems");
  const kpiItemsSub = document.getElementById("kpiItemsSub");
  const kpiAvgOrder = document.getElementById("kpiAvgOrder");
  const kpiAvgSub = document.getElementById("kpiAvgSub");
  const kpiLastAnalysis = document.getElementById("kpiLastAnalysis");
  const kpiAnalysisSub = document.getElementById("kpiAnalysisSub");

  // DOM Elements - Chart & Registry Table
  const btnMonthlyTrend = document.getElementById("btnMonthlyTrend");
  const btnCumulativeSpend = document.getElementById("btnCumulativeSpend");
  const spendingChart = document.getElementById("spendingChart");
  const chartTooltip = document.getElementById("chartTooltip");
  const chkIncludeReturns = document.getElementById("chkIncludeReturns");
  const lblIncludeReturns = document.getElementById("lblIncludeReturns");

  // Modal elements
  const analyzeModal = document.getElementById("analyzeModal");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const analyzeIframe = document.getElementById("analyzeIframe");

  const resultsCount = document.getElementById("resultsCount");
  const sortBySelect = document.getElementById("sortBySelect");
  const transactionsTableBody = document.getElementById(
    "transactionsTableBody",
  );

  // View toggle selectors
  const btnGroupedView = document.getElementById("btnGroupedView");
  const btnItemizedView = document.getElementById("btnItemizedView");
  const btnJsonView = document.getElementById("btnJsonView");
  const tableViewContainer = document.getElementById("tableViewContainer");
  const itemizedViewContainer = document.getElementById(
    "itemizedViewContainer",
  );
  const jsonViewContainer = document.getElementById("jsonViewContainer");
  const jsonViewerBlock = document.getElementById("jsonViewerBlock");
  const btnCopyJson = document.getElementById("btnCopyJson");

  // Theme toggle icons keyed by mode
  const themeIcons = { light: "\u2600\ufe0f", dark: "\ud83c\udf19" };

  // Initialize theme toggle button state
  if (btnThemeToggle) {
    getThemeMode((mode) => {
      btnThemeToggle.innerText = themeIcons[mode] || themeIcons.dark;
      btnThemeToggle.title = `Theme: ${mode}`;
    });

    btnThemeToggle.addEventListener("click", () => {
      getThemeMode((current) => {
        setTheme(nextThemeMode(current));
      });
    });

    window.addEventListener("themeChanged", (e) => {
      const mode = e.detail;
      btnThemeToggle.innerText = themeIcons[mode] || themeIcons.dark;
      btnThemeToggle.title = `Theme: ${mode}`;
    });
  }

  // Sidebar collapse / expand
  function collapseSidebar() {
    sidebarCollapsed = true;
    document.documentElement.classList.add("sidebar-collapsed");
    sidebarEl.classList.add("collapsed");
    mainContentEl.style.marginLeft = "0";
    btnExpandSidebar.style.display = "flex";
    chrome.storage.local.set({ sidebarCollapsed: true });
  }

  function expandSidebar() {
    sidebarCollapsed = false;
    document.documentElement.classList.remove("sidebar-collapsed");
    sidebarEl.classList.remove("collapsed");
    mainContentEl.style.marginLeft = "";
    btnExpandSidebar.style.display = "none";
    chrome.storage.local.set({ sidebarCollapsed: false });
  }

  btnToggleSidebar.addEventListener("click", () => {
    if (sidebarCollapsed) {
      expandSidebar();
    } else {
      collapseSidebar();
    }
  });

  btnExpandSidebar.addEventListener("click", expandSidebar);

  // 1. Initialize Dashboard
  loadData();

  // Listen to live scrape updates to refresh dashboard on the fly
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SCRAPE_STATE_CHANGED") {
      const payload = message.payload;
      if (payload.status === "COMPLETED") {
        window.location.reload();
      } else if (payload.status === "ITEMIZING") {
        loadData();
      }
    }
  });

  // Listen to window messages from the iframe (e.g. closing the modal)
  window.addEventListener("message", (event) => {
    if (event.data && event.data.action === "CLOSE_ANALYZE_MODAL") {
      closeAnalyzeModal();
    }
  });

  // 2. Add Filter Event Listeners
  [
    filterStartDate,
    filterEndDate,
    filterMinPrice,
    filterMaxPrice,
    chkShowOrders,
    chkShowRefunds,
  ].forEach((el) => el.addEventListener("change", updateView));

  searchInput.addEventListener("input", debounce(updateView, 250));
  sortBySelect.addEventListener("change", () => {
    const parts = sortBySelect.value.split("-");
    if (parts.length === 2) {
      sortField = parts[0];
      sortDir = parts[1];
    }
    updateView();
  });
  window.addEventListener("resize", debounce(renderChart, 150));

  btnResetFilters.addEventListener("click", () => {
    searchInput.value = "";
    filterStartDate.value = "";
    filterEndDate.value = "";
    filterMinPrice.value = "";
    filterMaxPrice.value = "";
    chkShowOrders.checked = true;
    chkShowRefunds.checked = true;
    if (chkIncludeReturns) chkIncludeReturns.checked = false;
    if (lblIncludeReturns) lblIncludeReturns.style.display = "none";
    chartMode = "monthly";
    btnMonthlyTrend.classList.add("active");
    btnCumulativeSpend.classList.remove("active");
    updateView();
  });

  // 3. Chart Mode Toggles
  btnMonthlyTrend.addEventListener("click", () => {
    btnMonthlyTrend.classList.add("active");
    btnCumulativeSpend.classList.remove("active");
    chartMode = "monthly";
    if (lblIncludeReturns) lblIncludeReturns.style.display = "none";
    renderChart();
  });

  btnCumulativeSpend.addEventListener("click", () => {
    btnCumulativeSpend.classList.add("active");
    btnMonthlyTrend.classList.remove("active");
    chartMode = "cumulative";
    if (lblIncludeReturns) lblIncludeReturns.style.display = "flex";
    renderChart();
  });

  if (chkIncludeReturns) {
    chkIncludeReturns.addEventListener("change", renderChart);
  }

  // 3b. Registry View Toggles (persist mode across sessions)
  btnGroupedView.addEventListener("click", () => {
    btnGroupedView.classList.add("active");
    btnItemizedView.classList.remove("active");
    btnJsonView.classList.remove("active");
    registryMode = "grouped";
    document.documentElement.classList.remove(
      "registry-itemized",
      "registry-json",
    );
    chrome.storage.local.set({ registryMode: "grouped" });
    tableViewContainer.style.display = "block";
    itemizedViewContainer.style.display = "none";
    jsonViewContainer.style.display = "none";
    renderTable();
    updateResultsCount();
  });

  btnItemizedView.addEventListener("click", () => {
    btnItemizedView.classList.add("active");
    btnGroupedView.classList.remove("active");
    btnJsonView.classList.remove("active");
    registryMode = "itemized";
    document.documentElement.classList.remove("registry-json");
    document.documentElement.classList.add("registry-itemized");
    chrome.storage.local.set({ registryMode: "itemized" });
    tableViewContainer.style.display = "none";
    itemizedViewContainer.style.display = "block";
    jsonViewContainer.style.display = "none";
    renderItemizedTable();
    updateResultsCount();
  });

  btnJsonView.addEventListener("click", () => {
    btnJsonView.classList.add("active");
    btnGroupedView.classList.remove("active");
    btnItemizedView.classList.remove("active");
    registryMode = "json";
    document.documentElement.classList.remove("registry-itemized");
    document.documentElement.classList.add("registry-json");
    chrome.storage.local.set({ registryMode: "json" });
    tableViewContainer.style.display = "none";
    itemizedViewContainer.style.display = "none";
    jsonViewContainer.style.display = "block";
    renderJsonView();
    updateResultsCount();
  });

  // Handle collapsible JSON clicks (event delegation on jsonViewerBlock)
  jsonViewerBlock.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest(".json-toggle-btn");
    if (!toggleBtn) return;

    const wrapper = toggleBtn.closest(".json-collapsible-wrapper");
    if (!wrapper) return;

    const block = wrapper.querySelector(".json-collapsible-block");
    const collapsedText = wrapper.querySelector(".json-collapsed-text");

    if (block && collapsedText) {
      const isCollapsed = block.classList.toggle("collapsed");
      toggleBtn.classList.toggle("collapsed", isCollapsed);
      if (isCollapsed) {
        collapsedText.style.display = "inline";
        toggleBtn.innerText = "▶";
      } else {
        collapsedText.style.display = "none";
        toggleBtn.innerText = "▼";
      }
    }
  });

  btnCopyJson.addEventListener("click", () => {
    const enhanced = filteredTransactions.map((tx) => {
      const isRefund = tx.paymentAmount < 0;
      let displayItems = tx.items || [];

      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.refundSubtotal ?? tx.paymentAmount,
        ).map((item) => ({
          ...item,
          price: -Math.abs(item.price),
        }));
      }

      let shippingAndTax = 0;
      if (displayItems.length > 0) {
        if (tx.summary) {
          if (isRefund) {
            const diff =
              (tx.summary.refundTotal ?? 0) - (tx.summary.refundSubtotal ?? 0);
            shippingAndTax = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.orderTotal ?? 0) - (tx.summary.orderSubtotal ?? 0);
            shippingAndTax = Math.abs(diff);
          }
        } else {
          const subtotalSum = displayItems.reduce(
            (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
            0,
          );
          const diff = Math.abs(tx.paymentAmount) - Math.abs(subtotalSum);
          shippingAndTax = isRefund ? -Math.abs(diff) : Math.abs(diff);
        }
        shippingAndTax = parseFloat(shippingAndTax.toFixed(2));
      }

      const updatedTx = {
        ...tx,
        shippingAndTax,
      };
      if (tx.items) {
        updatedTx.items = displayItems;
      }
      return updatedTx;
    });

    const jsonStr = JSON.stringify(enhanced, null, 2);
    navigator.clipboard
      .writeText(jsonStr)
      .then(() => {
        const originalText = btnCopyJson.innerHTML;
        btnCopyJson.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success-emerald)" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span style="color: var(--success-emerald)">Copied!</span>
      `;
        btnCopyJson.style.borderColor = "var(--success-emerald)";
        setTimeout(() => {
          btnCopyJson.innerHTML = originalText;
          btnCopyJson.style.borderColor = "";
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy JSON:", err);
      });
  });

  // 3c. Registry Table Header Sorting
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.getAttribute("data-sort");
      if (sortField === field) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortField = field;
        sortDir = "desc";
      }
      sortBySelect.value = `${sortField}-${sortDir}`;
      updateView();
    });
  });

  // 4. Manual Database Actions
  btnSeedDemo.addEventListener("click", () => {
    if (confirm("Inject realistic demo transactions for spending analytics?")) {
      chrome.runtime.sendMessage({ action: "SEED_DEMO_DATA" }, (res) => {
        if (res && res.status === "SUCCESS") {
          window.location.reload();
        }
      });
    }
  });

  btnClearData.addEventListener("click", () => {
    if (
      confirm("Wipe all transaction history? This actions cannot be undone.")
    ) {
      // First cancel any active scraping running in the background cleanly!
      chrome.runtime.sendMessage({ action: "STOP_SCRAPE" }, () => {
        chrome.runtime.lastError;

        chrome.storage.local.clear(() => {
          window.location.reload();
        });
      });
    }
  });

  function openAnalyzeModal() {
    if (analyzeModal) {
      if (analyzeIframe) {
        analyzeIframe.onload = () => {
          try {
            const body = analyzeIframe.contentDocument.body;
            setTimeout(() => {
              const height = body.scrollHeight;
              if (height) analyzeIframe.style.height = height + "px";
            });
          } catch {
            /* cross-origin, ignore */
          }
        };
        analyzeIframe.src = analyzeIframe.src;
      }
      analyzeModal.style.display = "flex";
      setTimeout(() => {
        analyzeModal.classList.add("show");
      }, 10);
    }
  }

  function closeAnalyzeModal() {
    if (analyzeModal) {
      analyzeModal.classList.remove("show");
      setTimeout(() => {
        analyzeModal.style.display = "none";
      }, 300);
    }
  }

  if (btnAnalyzeMore) {
    btnAnalyzeMore.addEventListener("click", openAnalyzeModal);
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener("click", closeAnalyzeModal);
  }

  if (analyzeModal) {
    analyzeModal.addEventListener("click", (e) => {
      if (e.target === analyzeModal) {
        closeAnalyzeModal();
      }
    });
  }

  // 5. Data Exporter — adapts format to current registry view
  btnExportData.addEventListener("click", () => {
    if (filteredTransactions.length === 0) return;

    if (registryMode === "itemized") {
      exportToCSVEngine(filteredTransactions, "line-item");
    } else if (registryMode === "json") {
      exportToJSONEngine(filteredTransactions);
    } else {
      exportToCSVEngine(filteredTransactions, "transaction");
    }
  });

  /**
   * Reads transactions from local storage and hydrates state
   */
  async function loadData() {
    const result = await chrome.storage.local.get([
      "transactions",
      "lastScraped",
      "scrapeStartDate",
      "scrapeEndDate",
      "registryMode",
      "sidebarCollapsed",
    ]);
    allTransactions = result.transactions || [];

    // Populate last analysis KPI card
    if (result.lastScraped) {
      const fmt = { month: "short", day: "numeric", year: "numeric" };
      const syncDate = new Date(result.lastScraped);
      kpiLastAnalysis.innerText = relativeTime(syncDate);
      if (result.scrapeStartDate && result.scrapeEndDate) {
        const start = new Date(result.scrapeStartDate).toLocaleDateString(
          "en-US",
          fmt,
        );
        const end = new Date(result.scrapeEndDate).toLocaleDateString(
          "en-US",
          fmt,
        );
        kpiAnalysisSub.innerText = `${start} – ${end}`;
      } else {
        kpiAnalysisSub.innerText = "Date range unavailable";
      }
    } else {
      kpiLastAnalysis.innerText = "N/A";
      kpiAnalysisSub.innerText = "No active analysis records";
    }

    // Restore persisted sidebar collapsed state (inline script may have already
    // applied the html class; sync JS-side state with it)
    const storedCollapsed =
      result.sidebarCollapsed ||
      document.documentElement.classList.contains("sidebar-collapsed");
    if (storedCollapsed) {
      sidebarCollapsed = true;
      document.documentElement.classList.add("sidebar-collapsed");
      sidebarEl.classList.add("collapsed");
      mainContentEl.style.marginLeft = "0";
      btnExpandSidebar.style.display = "flex";
    }

    // Restore persisted registry view mode (preload.js may have already
    // applied the html class; sync JS-side state with it)
    const storedMode =
      result.registryMode ||
      (document.documentElement.classList.contains("registry-itemized")
        ? "itemized"
        : document.documentElement.classList.contains("registry-json")
          ? "json"
          : null);
    if (storedMode) {
      registryMode = storedMode;
      document.documentElement.classList.add("registry-" + storedMode);
    }
    btnGroupedView.classList.toggle("active", registryMode === "grouped");
    btnItemizedView.classList.toggle("active", registryMode === "itemized");
    btnJsonView.classList.toggle("active", registryMode === "json");
    tableViewContainer.style.display =
      registryMode === "grouped" ? "block" : "none";
    itemizedViewContainer.style.display =
      registryMode === "itemized" ? "block" : "none";
    jsonViewContainer.style.display =
      registryMode === "json" ? "block" : "none";

    updateView();
  }

  /**
   * Refreshes stats, chart, and table based on current filters
   */
  function updateView() {
    applyFilters();
    calculateKPIs();
    renderChart();
    updateHeaderUI();
    if (registryMode === "grouped") {
      renderTable();
    } else if (registryMode === "itemized") {
      renderItemizedTable();
    } else {
      renderJsonView();
    }
  }

  /**
   * Filters the main transaction list according to sidebar inputs
   */
  function applyFilters() {
    const searchVal = searchInput.value.toLowerCase().trim();
    const startVal = filterStartDate.value
      ? new Date(filterStartDate.value)
      : null;
    const endVal = filterEndDate.value ? new Date(filterEndDate.value) : null;
    const minVal = filterMinPrice.value
      ? parseFloat(filterMinPrice.value)
      : null;
    const maxVal = filterMaxPrice.value
      ? parseFloat(filterMaxPrice.value)
      : null;

    const showOrders = chkShowOrders.checked;
    const showRefunds = chkShowRefunds.checked;

    filteredTransactions = allTransactions.filter((tx) => {
      // 1. Transaction Category Toggles
      const isRefund = tx.paymentAmount < 0;
      if (isRefund && !showRefunds) return false;
      if (!isRefund && !showOrders) return false;

      // 3. Search box
      if (searchVal) {
        const matchesDesc = tx.description.toLowerCase().includes(searchVal);
        const matchesId = tx.id.toLowerCase().includes(searchVal);
        const matchesPm =
          tx.paymentMethod &&
          tx.paymentMethod.toLowerCase().includes(searchVal);

        let matchesItems = false;
        if (tx.items) {
          matchesItems = tx.items.some(
            (item) =>
              item.title.toLowerCase().includes(searchVal) ||
              (item.seller && item.seller.toLowerCase().includes(searchVal)),
          );
        }

        if (!matchesDesc && !matchesId && !matchesPm && !matchesItems)
          return false;
      }

      // 4. Date filtering
      if (startVal || endVal) {
        const txDate = new Date(tx.date);
        if (startVal && txDate < startVal) return false;
        if (endVal && txDate > endVal) return false;
      }

      // 5. Price range
      if (minVal !== null || maxVal !== null) {
        const absAmount = Math.abs(tx.paymentAmount);
        if (minVal !== null && absAmount < minVal) return false;
        if (maxVal !== null && absAmount > maxVal) return false;
      }

      return true;
    });

    // Sort operations
    filteredTransactions.sort((a, b) => {
      let comparison = 0;

      if (sortField === "date") {
        comparison = new Date(a.date) - new Date(b.date);
      } else if (sortField === "amount") {
        comparison = a.paymentAmount - b.paymentAmount;
      } else if (sortField === "orderId") {
        comparison = (a.orderId || "").localeCompare(b.orderId || "");
      } else if (sortField === "description") {
        comparison = (a.description || "").localeCompare(b.description || "");
      } else if (sortField === "items") {
        const countA = a.items
          ? a.items.reduce((acc, i) => acc + (i.quantity || 1), 0)
          : 0;
        const countB = b.items
          ? b.items.reduce((acc, i) => acc + (i.quantity || 1), 0)
          : 0;
        comparison = countA - countB;
      } else if (sortField === "paymentMethod") {
        comparison = (a.paymentMethod || "").localeCompare(
          b.paymentMethod || "",
        );
      } else if (sortField === "shippingAndTax") {
        const getShippingAndTax = (tx) => {
          const isRefund = tx.paymentAmount < 0;
          const displayItems = tx.items || [];
          if (displayItems.length === 0) return 0;
          if (tx.summary) {
            if (isRefund) {
              return -Math.abs(
                (tx.summary.refundTotal ?? 0) -
                  (tx.summary.refundSubtotal ?? 0),
              );
            } else {
              return Math.abs(
                (tx.summary.orderTotal ?? 0) - (tx.summary.orderSubtotal ?? 0),
              );
            }
          } else {
            const subtotalSum = displayItems.reduce(
              (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
              0,
            );
            const diff = Math.abs(tx.paymentAmount) - Math.abs(subtotalSum);
            return isRefund ? -Math.abs(diff) : Math.abs(diff);
          }
        };
        comparison = getShippingAndTax(a) - getShippingAndTax(b);
      }

      return sortDir === "asc" ? comparison : -comparison;
    });

    updateResultsCount();
  }

  /**
   * Computes KPI summary panel metrics
   */
  function calculateKPIs() {
    if (filteredTransactions.length === 0) {
      kpiSpending.innerText = "$0.00";
      kpiSpendingSub.innerText = "0 purchases";
      kpiRefunds.innerText = "$0.00";
      kpiRefundsSub.innerText = "0 refunds";
      kpiTxCount.innerText = "0";
      kpiTxSub.innerText = "0 purchases, 0 refunds";
      kpiTotalItems.innerText = "0";
      kpiItemsSub.innerText = "Avg 0.0 items/order";
      kpiAvgOrder.innerText = "$0.00";
      kpiAvgSub.innerText = "Median $0.00";
      return;
    }

    let purchasesSum = 0;
    let refundsSum = 0;
    let orderCount = 0;
    let refundCount = 0;
    let totalItemsCount = 0;
    let ordersWithItemsCount = 0;

    const purchaseAmounts = [];

    filteredTransactions.forEach((tx) => {
      const isRefund = tx.paymentAmount < 0;
      if (isRefund) {
        refundsSum += Math.abs(tx.paymentAmount);
        refundCount++;
      } else {
        purchasesSum += tx.paymentAmount;
        purchaseAmounts.push(tx.paymentAmount);
        orderCount++;
      }

      if (tx.items && tx.items.length > 0) {
        ordersWithItemsCount++;
        tx.items.forEach((item) => {
          totalItemsCount += item.quantity || 1;
        });
      }
    });

    kpiSpending.innerText = formatCurrency(purchasesSum);
    kpiSpendingSub.innerText = `${orderCount} purchases`;
    kpiRefunds.innerText = formatCurrency(refundsSum);
    kpiRefundsSub.innerText = `${refundCount} refunds`;

    kpiTxCount.innerText = filteredTransactions.length;
    kpiTxSub.innerText = `${orderCount} purchases, ${refundCount} refunds`;

    kpiTotalItems.innerText = totalItemsCount;
    const avgItemsPer =
      ordersWithItemsCount > 0
        ? (totalItemsCount / ordersWithItemsCount).toFixed(1)
        : "0.0";
    kpiItemsSub.innerText = `Avg ${avgItemsPer} items/order`;

    const avgOrderValue = orderCount > 0 ? purchasesSum / orderCount : 0;
    kpiAvgOrder.innerText = formatCurrency(avgOrderValue);

    let median = 0;
    if (orderCount > 0) {
      purchaseAmounts.sort((a, b) => a - b);
      const mid = Math.floor(orderCount / 2);
      median =
        orderCount % 2 !== 0
          ? purchaseAmounts[mid]
          : (purchaseAmounts[mid - 1] + purchaseAmounts[mid]) / 2;
    }
    kpiAvgSub.innerText = `Median ${formatCurrency(median)}`;
  }

  /**
   * Local wrapper for rendering chart.
   */
  function renderChart() {
    renderChartEngine(
      spendingChart,
      chartTooltip,
      filteredTransactions,
      chartMode,
      chkIncludeReturns && chkIncludeReturns.checked,
    );
  }

  /**
   * Renders rows into the Detailed Registry Table
   */
  function renderTable() {
    transactionsTableBody.innerHTML = "";

    if (filteredTransactions.length === 0) {
      transactionsTableBody.innerHTML = `
        <tr class="empty-state">
          <td colspan="7">
            <div class="empty-inner">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>
              <h4>No matching records</h4>
              <p>Try resetting filters or adjusting search queries to locate transactions.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    filteredTransactions.forEach((tx) => {
      const isRefund = tx.paymentAmount < 0;
      let displayItems = tx.items || [];
      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.refundSubtotal ?? tx.paymentAmount,
        ).map((item) => ({
          ...item,
          price: -Math.abs(item.price),
        }));
      }
      const hasItems = displayItems.length > 0;
      let itemsCount = 0;
      let subtotalSum = 0;
      if (hasItems) {
        itemsCount = displayItems.reduce(
          (acc, i) => acc + (i.quantity || 1),
          0,
        );
        subtotalSum = displayItems.reduce(
          (acc, i) => acc + (i.price || 0) * (i.quantity || 1),
          0,
        );
      }

      let shippingAndTaxVal = 0;
      if (hasItems) {
        if (tx.summary) {
          if (isRefund) {
            const diff =
              (tx.summary.refundTotal ?? 0) - (tx.summary.refundSubtotal ?? 0);
            shippingAndTaxVal = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.orderTotal ?? 0) - (tx.summary.orderSubtotal ?? 0);
            shippingAndTaxVal = Math.abs(diff);
          }
        } else {
          const diff = Math.abs(tx.paymentAmount) - Math.abs(subtotalSum);
          shippingAndTaxVal = isRefund ? -Math.abs(diff) : Math.abs(diff);
        }
        shippingAndTaxVal = parseFloat(shippingAndTaxVal.toFixed(2));
      }

      const row = document.createElement("tr");
      row.className = "tx-row";
      row.setAttribute("data-id", tx.id);

      row.innerHTML = `
        <td class="date-col">${new Date(tx.date).toLocaleDateString()}</td>
        <td class="order-id-col">${tx.orderId || "N/A"}</td>
        <td class="desc-col" title="${escapeHtml(tx.description)}">${escapeHtml(tx.description)}</td>
        <td class="text-center">
          <span class="items-badge ${hasItems ? "itemized" : ""}">
            ${hasItems ? `${itemsCount} item${itemsCount > 1 ? "s" : ""}` : "N/A"}
          </span>
        </td>
        <td class="pm-col">${escapeHtml(tx.paymentMethod || "Account Bal")}</td>
        <td class="text-right amount-col ${isRefund && shippingAndTaxVal !== 0 ? "refund" : ""}">
          ${hasItems ? (isRefund && shippingAndTaxVal !== 0 ? `+${formatCurrency(Math.abs(shippingAndTaxVal))}` : formatCurrency(shippingAndTaxVal)) : "—"}
        </td>
        <td class="text-right amount-col ${isRefund ? "refund" : ""}">
          ${isRefund ? `+${formatCurrency(Math.abs(tx.paymentAmount))}` : formatCurrency(tx.paymentAmount)}
        </td>
      `;

      const detailsRow = document.createElement("tr");
      detailsRow.className = "details-row";
      detailsRow.id = `details-${tx.id}`;

      let itemsListHtml = "";
      let receiptDiff = 0;

      if (hasItems) {
        itemsListHtml = displayItems
          .map((item) => {
            const itemSubtotal = (item.price || 0) * (item.quantity || 1);

            const thumbHtml = item.imageUrl
              ? `<div class="item-thumb"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" onerror="this.outerHTML='<div class=\\'no-img\\'>🛒</div>'"></div>`
              : `<div class="item-thumb"><div class="no-img">🛒</div></div>`;

            return `
            <div class="item-card">
              ${thumbHtml}
              <div class="item-info">
                <h5>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" class="item-title-link">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</h5>
                <p>Sold by: <strong>${escapeHtml(item.seller || "Amazon.com")}</strong></p>
                <p>ASIN: <strong>${escapeHtml(item.asin || "N/A")}</strong></p>
              </div>
              <div class="item-financials">
                <span class="price">${formatCurrency(item.price)}</span>
                <span class="qty">Qty: ${item.quantity || 1}</span>
                <span class="subtotal">${formatCurrency(itemSubtotal)}</span>
              </div>
            </div>
          `;
          })
          .join("");

        if (tx.summary) {
          if (isRefund) {
            receiptDiff =
              (tx.summary.refundTotal ?? 0) - (tx.summary.refundSubtotal ?? 0);
          } else {
            receiptDiff =
              (tx.summary.orderTotal ?? 0) - (tx.summary.orderSubtotal ?? 0);
          }
        } else {
          receiptDiff = Math.abs(tx.paymentAmount) - Math.abs(subtotalSum);
        }
      } else {
        itemsListHtml = `
          <div class="empty-inner" style="padding: 20px 0;">
            <p style="color: var(--text-dark); font-size:12px;">Order details have not been fetched for this transaction. Run analysis with 'Fetch Itemized Details' enabled.</p>
          </div>
        `;
        subtotalSum = Math.abs(tx.paymentAmount);
        receiptDiff = 0;
      }

      let invoiceUrl = tx.orderDetailsUrl;
      if (!invoiceUrl && tx.orderId) {
        const descLower = (tx.description || "").toLowerCase();
        const isGrocery =
          descLower.includes("fresh") ||
          descLower.includes("whole foods") ||
          descLower.includes("grocery") ||
          descLower.includes("groceries") ||
          descLower.includes("prime now");
        if (isGrocery) {
          invoiceUrl = `https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=${tx.orderId}&page=itemmod`;
        } else if (tx.orderId.toUpperCase().startsWith("D")) {
          invoiceUrl = `https://www.amazon.com/your-orders/order-details?orderID=${tx.orderId}`;
        } else {
          invoiceUrl = `https://www.amazon.com/gp/your-account/order-details?orderID=${tx.orderId}`;
        }
      }

      detailsRow.innerHTML = `
        <td colspan="7" class="details-cell">
          <div class="items-container">
            <div class="details-subheader">
              <h4>Itemized Invoice Records</h4>
              ${
                invoiceUrl
                  ? `<a href="${escapeHtml(invoiceUrl)}" target="_blank">
                <span>View Amazon Order Details</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>`
                  : ""
              }
            </div>

            <div class="items-list">
              ${itemsListHtml}
            </div>

            <div class="details-receipt">
              <div class="receipt-summary">
                <div class="receipt-row">
                  <span>Subtotal</span>
                  <span>${formatCurrency(Math.abs(subtotalSum))}</span>
                </div>
                ${
                  Math.abs(receiptDiff) > 0.02
                    ? `
                <div class="receipt-row">
                  <span>Shipping & Tax</span>
                  <span>${formatCurrency(Math.abs(receiptDiff))}</span>
                </div>
                `
                    : ""
                }
                <div class="receipt-row total">
                  <span>${isRefund ? "Refund Issued" : "Total Amount Paid"}</span>
                  <span>${formatCurrency(Math.abs(tx.paymentAmount))}</span>
                </div>
              </div>
            </div>
          </div>
        </td>
      `;

      row.addEventListener("click", () => {
        const isCurrentlyExpanded = row.classList.contains("expanded");

        document.querySelectorAll(".tx-row.expanded").forEach((r) => {
          r.classList.remove("expanded");
        });
        document.querySelectorAll(".details-row.show").forEach((dr) => {
          dr.classList.remove("show");
        });

        if (!isCurrentlyExpanded) {
          row.classList.add("expanded");
          detailsRow.classList.add("show");
        }
      });

      transactionsTableBody.appendChild(row);
      transactionsTableBody.appendChild(detailsRow);
    });
  }

  /**
   * Renders the filtered and sorted transactions list as a formatted JSON document.
   */
  function renderJsonView() {
    if (filteredTransactions.length === 0) {
      jsonViewerBlock.innerHTML = `<span class="json-null">[]</span>`;
      return;
    }

    const enhancedTransactions = filteredTransactions.map((tx) => {
      const isRefund = tx.paymentAmount < 0;
      let displayItems = tx.items || [];

      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.refundSubtotal ?? tx.paymentAmount,
        ).map((item) => ({
          ...item,
          price: -Math.abs(item.price),
        }));
      }

      let shippingAndTax = 0;
      if (displayItems.length > 0) {
        if (tx.summary) {
          if (isRefund) {
            const diff =
              (tx.summary.refundTotal ?? 0) - (tx.summary.refundSubtotal ?? 0);
            shippingAndTax = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.orderTotal ?? 0) - (tx.summary.orderSubtotal ?? 0);
            shippingAndTax = Math.abs(diff);
          }
        } else {
          const subtotalSum = displayItems.reduce(
            (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
            0,
          );
          const diff = Math.abs(tx.paymentAmount) - Math.abs(subtotalSum);
          shippingAndTax = isRefund ? -Math.abs(diff) : Math.abs(diff);
        }
        shippingAndTax = parseFloat(shippingAndTax.toFixed(2));
      }

      const updatedTx = {
        ...tx,
        shippingAndTax,
      };
      if (tx.items) {
        updatedTx.items = displayItems;
      }
      return updatedTx;
    });

    jsonViewerBlock.innerHTML = formatJsonToHtml(enhancedTransactions);
  }

  /**
   * Formats a JSON object/array recursively into interactive, collapsible HTML nodes.
   */
  function formatJsonToHtml(val, isLast = true) {
    if (val === null) {
      return `<span class="json-null">null</span>${isLast ? "" : ","}`;
    }
    if (typeof val === "boolean") {
      return `<span class="json-boolean">${val}</span>${isLast ? "" : ","}`;
    }
    if (typeof val === "number") {
      return `<span class="json-number">${val}</span>${isLast ? "" : ","}`;
    }
    if (typeof val === "string") {
      return `<span class="json-string">"${escapeHtml(val)}"</span>${isLast ? "" : ","}`;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) {
        return `<span class="json-bracket">[ ]</span>${isLast ? "" : ","}`;
      }
      const children = val
        .map((item, index) => {
          return `<div class="json-nested-item">${formatJsonToHtml(item, index === val.length - 1)}</div>`;
        })
        .join("");
      const count = val.length;
      const label = `${count} Item${count !== 1 ? "s" : ""}`;
      return `<span class="json-collapsible-wrapper"><span class="json-toggle-btn">▼</span><span class="json-bracket">[</span><span class="json-collapsed-text" style="display: none;">${label}</span><div class="json-collapsible-block">${children}</div><span class="json-bracket">]</span>${isLast ? "" : ","}</span>`;
    }
    if (typeof val === "object") {
      const keys = Object.keys(val);
      if (keys.length === 0) {
        return `<span class="json-bracket">{ }</span>${isLast ? "" : ","}`;
      }
      const children = keys
        .map((key, index) => {
          const keyHtml = `<span class="json-key">"${escapeHtml(key)}"</span>: `;
          const valHtml = formatJsonToHtml(val[key], index === keys.length - 1);
          return `<div class="json-nested-item">${keyHtml}${valHtml}</div>`;
        })
        .join("");
      return `<span class="json-collapsible-wrapper"><span class="json-toggle-btn">▼</span><span class="json-bracket">{</span><span class="json-collapsed-text" style="display: none;">...</span><div class="json-collapsible-block">${children}</div><span class="json-bracket">}</span>${isLast ? "" : ","}</span>`;
    }
    return escapeHtml(String(val)) + (isLast ? "" : ",");
  }

  /**
   * Flattens transactions into a list of individual items.
   */
  function getItemizedRows(transactions) {
    const rows = [];
    transactions.forEach((tx) => {
      const isRefund = tx.paymentAmount < 0;
      let displayItems = tx.items || [];

      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.refundSubtotal ?? tx.paymentAmount,
        ).map((item) => ({
          ...item,
          price: -Math.abs(item.price),
        }));
      }

      if (displayItems.length > 0) {
        displayItems.forEach((item) => {
          const total = (item.price || 0) * (item.quantity || 1);
          rows.push({
            date: tx.date,
            orderId: tx.orderId || "N/A",
            title: item.title,
            seller: item.seller || "Amazon.com",
            paymentMethod: tx.paymentMethod || "Account Bal",
            price: item.price,
            quantity: item.quantity || 1,
            total: total,
            url: item.url || "",
            imageUrl: item.imageUrl || "",
            asin: item.asin || "",
            txId: tx.id,
          });
        });
      } else {
        // Fallback for unitemized transactions
        rows.push({
          date: tx.date,
          orderId: tx.orderId || "N/A",
          title: tx.description || "Unitemized Transaction",
          seller: "Amazon",
          paymentMethod: tx.paymentMethod || "Account Bal",
          price: tx.paymentAmount,
          quantity: 1,
          total: tx.paymentAmount,
          url: tx.orderDetailsUrl || "",
          imageUrl: "",
          asin: "",
          txId: tx.id,
        });
      }
    });
    return rows;
  }

  /**
   * Renders the flat list of items in the Itemized Table View.
   */
  function renderItemizedTable() {
    const itemizedTableBody = document.getElementById("itemizedTableBody");
    if (!itemizedTableBody) return;
    itemizedTableBody.innerHTML = "";

    const itemRows = getItemizedRows(filteredTransactions);

    if (itemRows.length === 0) {
      itemizedTableBody.innerHTML = `
        <tr class="empty-state">
          <td colspan="8">
            <div class="empty-inner">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>
              <h4>No matching records</h4>
              <p>Try resetting filters or adjusting search queries to locate items.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    // Sort itemRows based on sortField
    itemRows.sort((a, b) => {
      let comparison = 0;
      if (sortField === "date") {
        comparison = new Date(a.date) - new Date(b.date);
      } else if (sortField === "orderId") {
        comparison = (a.orderId || "").localeCompare(b.orderId || "");
      } else if (sortField === "itemTitle") {
        comparison = (a.title || "").localeCompare(b.title || "");
      } else if (sortField === "seller") {
        comparison = (a.seller || "").localeCompare(b.seller || "");
      } else if (sortField === "paymentMethod") {
        comparison = (a.paymentMethod || "").localeCompare(
          b.paymentMethod || "",
        );
      } else if (sortField === "price") {
        comparison = (a.price || 0) - (b.price || 0);
      } else if (sortField === "quantity") {
        comparison = (a.quantity || 0) - (b.quantity || 0);
      } else if (sortField === "total" || sortField === "amount") {
        comparison = (a.total || 0) - (b.total || 0);
      } else if (sortField === "description") {
        // Fallback for sorting compatibility
        comparison = (a.title || "").localeCompare(b.title || "");
      } else {
        comparison = new Date(a.date) - new Date(b.date);
      }
      return sortDir === "asc" ? comparison : -comparison;
    });

    itemRows.forEach((item) => {
      const isRefund = item.total < 0;
      const row = document.createElement("tr");
      row.className = "tx-row";
      row.setAttribute("data-tx-id", item.txId);

      const titleHtml = escapeHtml(item.title);

      row.innerHTML = `
        <td class="date-col">${new Date(item.date).toLocaleDateString()}</td>
        <td class="order-id-col">${item.orderId || "N/A"}</td>
        <td class="desc-col" title="${escapeHtml(item.title)}">${titleHtml}</td>
        <td class="pm-col">${escapeHtml(item.seller)}</td>
        <td class="pm-col">${escapeHtml(item.paymentMethod)}</td>
        <td class="text-right amount-col ${isRefund ? "refund" : ""}">
          ${isRefund ? `+${formatCurrency(Math.abs(item.price))}` : formatCurrency(item.price)}
        </td>
        <td class="text-center pm-col">${item.quantity}</td>
        <td class="text-right amount-col ${isRefund ? "refund" : ""}">
          ${isRefund ? `+${formatCurrency(Math.abs(item.total))}` : formatCurrency(item.total)}
        </td>
      `;

      // Find the parent transaction details
      const tx = filteredTransactions.find((t) => t.id === item.txId) || {};
      const isRefundTx = tx.paymentAmount < 0;
      let displayItems = tx.items || [];
      if (isRefundTx && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.refundSubtotal ?? tx.paymentAmount,
        ).map((item) => ({
          ...item,
          price: -Math.abs(item.price),
        }));
      }
      const hasItems = displayItems.length > 0;
      let subtotalSum = 0;
      if (hasItems) {
        subtotalSum = displayItems.reduce(
          (acc, i) => acc + (i.price || 0) * (i.quantity || 1),
          0,
        );
      } else {
        subtotalSum = Math.abs(tx.paymentAmount || item.total);
      }

      let shippingAndTaxVal = 0;
      if (hasItems) {
        if (tx.summary) {
          if (isRefundTx) {
            const diff =
              (tx.summary.refundTotal ?? 0) - (tx.summary.refundSubtotal ?? 0);
            shippingAndTaxVal = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.orderTotal ?? 0) - (tx.summary.orderSubtotal ?? 0);
            shippingAndTaxVal = Math.abs(diff);
          }
        } else {
          const diff =
            Math.abs(tx.paymentAmount || item.total) - Math.abs(subtotalSum);
          shippingAndTaxVal = isRefundTx ? -Math.abs(diff) : Math.abs(diff);
        }
        shippingAndTaxVal = parseFloat(shippingAndTaxVal.toFixed(2));
      }

      let invoiceUrl = tx.orderDetailsUrl;
      if (!invoiceUrl && tx.orderId) {
        const descLower = (tx.description || "").toLowerCase();
        const isGrocery =
          descLower.includes("fresh") ||
          descLower.includes("whole foods") ||
          descLower.includes("grocery") ||
          descLower.includes("groceries") ||
          descLower.includes("prime now");
        if (isGrocery) {
          invoiceUrl = `https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=${tx.orderId}&page=itemmod`;
        } else if (tx.orderId.toUpperCase().startsWith("D")) {
          invoiceUrl = `https://www.amazon.com/your-orders/order-details?orderID=${tx.orderId}`;
        } else {
          invoiceUrl = `https://www.amazon.com/gp/your-account/order-details?orderID=${tx.orderId}`;
        }
      }

      const thumbHtml = item.imageUrl
        ? `<div class="item-thumb" style="width: 60px; height: 60px; border-radius: 8px; background-color: white; display: flex; align-items: center; justify-content: center; padding: 4px; border: 1px solid var(--border-color); overflow: hidden; flex-shrink: 0;">${
            item.url
              ? `<a href="${escapeHtml(item.url)}" target="_blank" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" style="max-width: 100%; max-height: 100%; object-fit: contain;" onerror="this.outerHTML='<div class=\\'no-img\\'>🛒</div>'"></a>`
              : `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" style="max-width: 100%; max-height: 100%; object-fit: contain;" onerror="this.outerHTML='<div class=\\'no-img\\'>🛒</div>'">`
          }</div>`
        : `<div class="item-thumb" style="width: 60px; height: 60px; border-radius: 8px; background-color: white; display: flex; align-items: center; justify-content: center; padding: 4px; border: 1px solid var(--border-color); overflow: hidden; flex-shrink: 0;"><div class="no-img" style="font-size: 20px;">🛒</div></div>`;

      const detailsRow = document.createElement("tr");
      detailsRow.className = "details-row";
      detailsRow.id = `item-details-${item.txId}-${Math.random().toString(36).substr(2, 9)}`;
      detailsRow.innerHTML = `
        <td colspan="8" class="details-cell">
          <div class="items-container" style="padding: 10px 24px; display: flex !important; flex-direction: row !important; align-items: center; justify-content: space-between; gap: 20px;">
            <!-- Left: Picture of item -->
            ${thumbHtml}

            <!-- Center: Links to Amazon -->
            <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">
              <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">ASIN: ${escapeHtml(item.asin || "N/A")}</span>
              ${
                item.url
                  ? `<a href="${escapeHtml(item.url)}" target="_blank" style="font-size: 12px; color: var(--primary-violet); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                <span>View Product Page</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>`
                  : ""
              }
              ${
                invoiceUrl
                  ? `<a href="${escapeHtml(invoiceUrl)}" target="_blank" style="font-size: 12px; color: var(--primary-indigo); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                <span>View Amazon Order Details</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>`
                  : `<span style="color: var(--text-muted); font-size: 11px;">No Order Link Available</span>`
              }
            </div>

            <!-- Right: Order total info -->
            <div class="details-receipt" style="border-top: none; padding-top: 0; margin-top: 0; width: 220px; flex-shrink: 0;">
              <div class="receipt-summary">
                <div class="receipt-row">
                  <span>Order Subtotal</span>
                  <span>${formatCurrency(Math.abs(subtotalSum))}</span>
                </div>
                ${
                  Math.abs(shippingAndTaxVal) > 0.02
                    ? `
                <div class="receipt-row">
                  <span>Order Shipping & Tax</span>
                  <span>${formatCurrency(Math.abs(shippingAndTaxVal))}</span>
                </div>
                `
                    : ""
                }
                <div class="receipt-row total">
                  <span>${isRefundTx ? "Order Refund Issued" : "Order Total Paid"}</span>
                  <span>${formatCurrency(Math.abs(tx.paymentAmount || item.total))}</span>
                </div>
              </div>
            </div>
          </div>
        </td>
      `;

      row.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;

        const isCurrentlyExpanded = row.classList.contains("expanded");

        itemizedTableBody.querySelectorAll(".tx-row.expanded").forEach((r) => {
          r.classList.remove("expanded");
        });
        itemizedTableBody
          .querySelectorAll(".details-row.show")
          .forEach((dr) => {
            dr.classList.remove("show");
          });

        if (!isCurrentlyExpanded) {
          row.classList.add("expanded");
          detailsRow.classList.add("show");
        }
      });

      itemizedTableBody.appendChild(row);
      itemizedTableBody.appendChild(detailsRow);
    });
  }

  /**
   * Updates the results badge count based on active view.
   */
  /**
   * Returns a human-readable relative time string ("2 hours ago").
   * @param {Date} date
   * @returns {string}
   */
  function relativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
    if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
    if (diffDay < 30)
      return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function updateResultsCount() {
    if (registryMode === "itemized") {
      const itemRows = getItemizedRows(filteredTransactions);
      resultsCount.innerText = `Showing ${itemRows.length} matching records`;
    } else {
      resultsCount.innerText = `Showing ${filteredTransactions.length} matching transactions`;
    }
  }

  /**
   * Updates the UI indicators on the table headers.
   */
  function updateHeaderUI() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      const field = th.getAttribute("data-sort");
      const icon = th.querySelector(".sort-icon");
      if (!icon) return;

      if (field === sortField) {
        th.classList.add("active-sort");
        icon.textContent = sortDir === "asc" ? " ↑" : " ↓";
      } else {
        th.classList.remove("active-sort");
        icon.textContent = " ↕";
      }
    });
  }
});
