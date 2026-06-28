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
  let registryMode = "table"; // table or json
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

  const btnExportCSV = document.getElementById("btnExportCSV");
  const btnExportJSON = document.getElementById("btnExportJSON");
  const btnResetFilters = document.getElementById("btnResetFilters");
  const btnSeedDemo = document.getElementById("btnSeedDemo");
  const btnClearData = document.getElementById("btnClearData");

  // DOM Elements - Header & Stats
  const syncTimeText = document.getElementById("syncTime");
  const btnRefreshData = document.getElementById("btnRefreshData");
  const btnAnalyzeMore = document.getElementById("btnAnalyzeMore");
  const syncIcon = document.getElementById("syncIcon");

  const kpiTotalSpent = document.getElementById("kpiTotalSpent");
  const kpiSpentSub = document.getElementById("kpiSpentSub");
  const kpiTotalItems = document.getElementById("kpiTotalItems");
  const kpiItemsSub = document.getElementById("kpiItemsSub");
  const kpiAvgOrder = document.getElementById("kpiAvgOrder");
  const kpiAvgSub = document.getElementById("kpiAvgSub");
  const kpiTopMonth = document.getElementById("kpiTopMonth");
  const kpiTopMonthSub = document.getElementById("kpiTopMonthSub");

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
  const btnTableView = document.getElementById("btnTableView");
  const btnJsonView = document.getElementById("btnJsonView");
  const tableViewContainer = document.getElementById("tableViewContainer");
  const jsonViewContainer = document.getElementById("jsonViewContainer");
  const jsonViewerBlock = document.getElementById("jsonViewerBlock");
  const btnCopyJson = document.getElementById("btnCopyJson");

  // 1. Initialize Dashboard
  loadData();

  // Listen to live scrape updates to refresh dashboard on the fly
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SCRAPE_STATE_CHANGED") {
      const payload = message.payload;
      if (payload.status === "COMPLETED" || payload.status === "ITEMIZING") {
        loadData();
      }
      if (payload.status === "COMPLETED") {
        closeAnalyzeModal();
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

  // 3b. Registry View Toggles
  btnTableView.addEventListener("click", () => {
    btnTableView.classList.add("active");
    btnJsonView.classList.remove("active");
    registryMode = "table";
    tableViewContainer.style.display = "block";
    jsonViewContainer.style.display = "none";
    renderTable();
  });

  btnJsonView.addEventListener("click", () => {
    btnJsonView.classList.add("active");
    btnTableView.classList.remove("active");
    registryMode = "json";
    tableViewContainer.style.display = "none";
    jsonViewContainer.style.display = "block";
    renderJsonView();
  });

  btnCopyJson.addEventListener("click", () => {
    const enhanced = filteredTransactions.map((tx) => {
      const isRefund = tx.amount < 0;
      let displayItems = tx.items || [];

      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.itemsRefund ?? tx.amount,
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
              (tx.summary.refundTotal ?? 0) - (tx.summary.itemsRefund ?? 0);
            shippingAndTax = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.grandTotal ?? 0) - (tx.summary.itemSubtotal ?? 0);
            shippingAndTax = Math.abs(diff);
          }
        } else {
          const subtotalSum = displayItems.reduce(
            (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
            0,
          );
          const diff = Math.abs(tx.amount) - Math.abs(subtotalSum);
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
          loadData();
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
          allTransactions = [];
          updateView();
          syncTimeText.innerText = "Database: Wiped clean";
        });
      });
    }
  });

  btnRefreshData.addEventListener("click", () => {
    btnRefreshData.classList.add("spinning");
    syncIcon.style.animation = "spin 1s linear infinite";
    loadData().finally(() => {
      setTimeout(() => {
        btnRefreshData.classList.remove("spinning");
        syncIcon.style.animation = "";
      }, 800);
    });
  });

  function openAnalyzeModal() {
    if (analyzeModal) {
      if (analyzeIframe) {
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

  // 5. Data Exporters Wrapper Functions
  function exportToCSV() {
    exportToCSVEngine(filteredTransactions);
  }

  function exportToJSON() {
    exportToJSONEngine(filteredTransactions);
  }

  btnExportCSV.addEventListener("click", exportToCSV);
  btnExportJSON.addEventListener("click", exportToJSON);

  /**
   * Reads transactions from local storage and hydrates state
   */
  async function loadData() {
    const result = await chrome.storage.local.get([
      "transactions",
      "lastScraped",
    ]);
    allTransactions = result.transactions || [];

    if (result.lastScraped) {
      const syncDate = new Date(result.lastScraped);
      syncTimeText.innerText = `Database: Scraped on ${syncDate.toLocaleDateString()} at ${syncDate.toLocaleTimeString()}`;
    } else {
      syncTimeText.innerText = "Database: No active scrape records";
    }

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
    if (registryMode === "table") {
      renderTable();
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
      const isRefund = tx.amount < 0;
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
        const absAmount = Math.abs(tx.amount);
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
        comparison = Math.abs(a.amount) - Math.abs(b.amount);
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
          const isRefund = tx.amount < 0;
          const displayItems = tx.items || [];
          if (displayItems.length === 0) return 0;
          if (tx.summary) {
            if (isRefund) {
              return -Math.abs(
                (tx.summary.refundTotal ?? 0) - (tx.summary.itemsRefund ?? 0),
              );
            } else {
              return Math.abs(
                (tx.summary.grandTotal ?? 0) - (tx.summary.itemSubtotal ?? 0),
              );
            }
          } else {
            const subtotalSum = displayItems.reduce(
              (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
              0,
            );
            const diff = Math.abs(tx.amount) - Math.abs(subtotalSum);
            return isRefund ? -Math.abs(diff) : Math.abs(diff);
          }
        };
        comparison = getShippingAndTax(a) - getShippingAndTax(b);
      }

      return sortDir === "asc" ? comparison : -comparison;
    });

    resultsCount.innerText = `Showing ${filteredTransactions.length} matching records`;
  }

  /**
   * Computes KPI summary panel metrics
   */
  function calculateKPIs() {
    if (filteredTransactions.length === 0) {
      kpiTotalSpent.innerText = "$0.00";
      kpiSpentSub.innerText = "Includes $0.00 in refunds";
      kpiTotalItems.innerText = "0";
      kpiItemsSub.innerText = "Avg. 0.0 items per order";
      kpiAvgOrder.innerText = "$0.00";
      kpiAvgSub.innerText = "Median order size: $0.00";
      kpiTopMonth.innerText = "N/A";
      kpiTopMonthSub.innerText = "Peak month: $0.00";
      return;
    }

    let purchasesSum = 0;
    let refundsSum = 0;
    let totalItemsCount = 0;
    let ordersWithItemsCount = 0;

    const purchaseAmounts = [];

    filteredTransactions.forEach((tx) => {
      const isRefund = tx.amount < 0;
      if (isRefund) {
        refundsSum += Math.abs(tx.amount);
      } else {
        purchasesSum += tx.amount;
        purchaseAmounts.push(tx.amount);
      }

      if (tx.items && tx.items.length > 0) {
        ordersWithItemsCount++;
        tx.items.forEach((item) => {
          totalItemsCount += item.quantity || 1;
        });
      }
    });

    const netSpent = purchasesSum - refundsSum;
    kpiTotalSpent.innerText = formatCurrency(netSpent);
    kpiSpentSub.innerText = `Spent ${formatCurrency(purchasesSum)} | Refunded ${formatCurrency(refundsSum)}`;

    kpiTotalItems.innerText = totalItemsCount;
    const avgItems =
      ordersWithItemsCount > 0
        ? (totalItemsCount / ordersWithItemsCount).toFixed(1)
        : "0.0";
    kpiItemsSub.innerText = `Across ${ordersWithItemsCount} itemized order listings (Avg ${avgItems}/order)`;

    const orderCount = purchaseAmounts.length;
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
    kpiAvgSub.innerText = `Median order size: ${formatCurrency(median)} (${orderCount} total orders)`;

    const monthlyGroups = {};
    filteredTransactions.forEach((tx) => {
      const isRefund = tx.amount < 0;
      if (isRefund) return;

      const date = new Date(tx.date);
      const monthKey = date.toLocaleString("default", {
        month: "short",
        year: "numeric",
      });
      monthlyGroups[monthKey] = (monthlyGroups[monthKey] || 0) + tx.amount;
    });

    let topMonthName = "N/A";
    let topMonthMax = 0;

    Object.entries(monthlyGroups).forEach(([month, sum]) => {
      if (sum > topMonthMax) {
        topMonthMax = sum;
        topMonthName = month;
      }
    });

    kpiTopMonth.innerText = topMonthName;
    kpiTopMonthSub.innerText =
      topMonthMax > 0
        ? `Peak month volume: ${formatCurrency(topMonthMax)}`
        : "No purchases recorded";
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
      const isRefund = tx.amount < 0;
      let displayItems = tx.items || [];
      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.itemsRefund ?? tx.amount,
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
              (tx.summary.refundTotal ?? 0) - (tx.summary.itemsRefund ?? 0);
            shippingAndTaxVal = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.grandTotal ?? 0) - (tx.summary.itemSubtotal ?? 0);
            shippingAndTaxVal = Math.abs(diff);
          }
        } else {
          const diff = Math.abs(tx.amount) - Math.abs(subtotalSum);
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
          ${isRefund ? `+${formatCurrency(Math.abs(tx.amount))}` : formatCurrency(tx.amount)}
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
              (tx.summary.refundTotal ?? 0) - (tx.summary.itemsRefund ?? 0);
          } else {
            receiptDiff =
              (tx.summary.grandTotal ?? 0) - (tx.summary.itemSubtotal ?? 0);
          }
        } else {
          receiptDiff = Math.abs(tx.amount) - Math.abs(subtotalSum);
        }
      } else {
        itemsListHtml = `
          <div class="empty-inner" style="padding: 20px 0;">
            <p style="color: var(--text-dark); font-size:12px;">Order details have not been fetched for this transaction. Run scraping with 'Fetch Itemized Details' enabled.</p>
          </div>
        `;
        subtotalSum = Math.abs(tx.amount);
        receiptDiff = 0;
      }

      let invoiceUrl = tx.detailsLink;
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
                  <span>${formatCurrency(Math.abs(tx.amount))}</span>
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
      const isRefund = tx.amount < 0;
      let displayItems = tx.items || [];

      if (isRefund && displayItems.length > 0) {
        displayItems = getRefundItems(
          displayItems,
          tx.summary?.itemsRefund ?? tx.amount,
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
              (tx.summary.refundTotal ?? 0) - (tx.summary.itemsRefund ?? 0);
            shippingAndTax = -Math.abs(diff);
          } else {
            const diff =
              (tx.summary.grandTotal ?? 0) - (tx.summary.itemSubtotal ?? 0);
            shippingAndTax = Math.abs(diff);
          }
        } else {
          const subtotalSum = displayItems.reduce(
            (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
            0,
          );
          const diff = Math.abs(tx.amount) - Math.abs(subtotalSum);
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

    jsonViewerBlock.innerHTML = syntaxHighlightJson(enhancedTransactions);
  }

  /**
   * Formats a JSON object with HTML classes for color-coded syntax highlighting.
   */
  function syntaxHighlightJson(jsonObj) {
    let json = JSON.stringify(jsonObj, null, 2);
    json = json
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = "number";
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = "key";
          } else {
            cls = "string";
          }
        } else if (/true|false/.test(match)) {
          cls = "boolean";
        } else if (/null/.test(match)) {
          cls = "null";
        }
        return `<span class="json-${cls}">${match}</span>`;
      },
    );
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
