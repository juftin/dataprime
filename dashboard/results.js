/**
 * DataPrime Purchase Analytics Dashboard Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  // Local state variables
  let allTransactions = [];
  let filteredTransactions = [];
  let chartMode = "monthly"; // monthly or cumulative

  // DOM Elements - Sidebar Filters
  const searchInput = document.getElementById("searchInput");
  const filterStartDate = document.getElementById("filterStartDate");
  const filterEndDate = document.getElementById("filterEndDate");
  const filterMinPrice = document.getElementById("filterMinPrice");
  const filterMaxPrice = document.getElementById("filterMaxPrice");
  const chkShowOrders = document.getElementById("chkShowOrders");
  const chkShowRefunds = document.getElementById("chkShowRefunds");
  const chkShowItemizedOnly = document.getElementById("chkShowItemizedOnly");

  const btnExportCSV = document.getElementById("btnExportCSV");
  const btnExportJSON = document.getElementById("btnExportJSON");
  const btnResetFilters = document.getElementById("btnResetFilters");
  const btnSeedDemo = document.getElementById("btnSeedDemo");
  const btnClearData = document.getElementById("btnClearData");

  // DOM Elements - Header & Stats
  const syncTimeText = document.getElementById("syncTime");
  const btnRefreshData = document.getElementById("btnRefreshData");
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

  const resultsCount = document.getElementById("resultsCount");
  const sortBySelect = document.getElementById("sortBySelect");
  const transactionsTableBody = document.getElementById(
    "transactionsTableBody",
  );

  // 1. Initialize Dashboard
  loadData();

  // Listen to live scrape updates to refresh dashboard on the fly
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SCRAPE_STATE_CHANGED") {
      const payload = message.payload;
      if (payload.status === "COMPLETED" || payload.status === "ITEMIZING") {
        loadData();
      }
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
    chkShowItemizedOnly,
  ].forEach((el) => el.addEventListener("change", updateView));

  searchInput.addEventListener("input", debounce(updateView, 250));
  sortBySelect.addEventListener("change", updateView);
  window.addEventListener("resize", debounce(renderChart, 150));

  btnResetFilters.addEventListener("click", () => {
    searchInput.value = "";
    filterStartDate.value = "";
    filterEndDate.value = "";
    filterMinPrice.value = "";
    filterMaxPrice.value = "";
    chkShowOrders.checked = true;
    chkShowRefunds.checked = true;
    chkShowItemizedOnly.checked = false;
    updateView();
  });

  // 3. Chart Mode Toggles
  btnMonthlyTrend.addEventListener("click", () => {
    btnMonthlyTrend.classList.add("active");
    btnCumulativeSpend.classList.remove("active");
    chartMode = "monthly";
    renderChart();
  });

  btnCumulativeSpend.addEventListener("click", () => {
    btnCumulativeSpend.classList.add("active");
    btnMonthlyTrend.classList.remove("active");
    chartMode = "cumulative";
    renderChart();
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
        // Suppress any runtime errors if background was inactive
        const err = chrome.runtime.lastError;

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

  // 5. Data Exporters
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
    renderTable();
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
    const showItemizedOnly = chkShowItemizedOnly.checked;

    filteredTransactions = allTransactions.filter((tx) => {
      // 1. Transaction Category Toggles
      const isRefund = tx.amount < 0;
      if (isRefund && !showRefunds) return false;
      if (!isRefund && !showOrders) return false;

      // 2. Only Itemized toggle
      const hasItems = tx.items && tx.items.length > 0;
      if (showItemizedOnly && !hasItems) return false;

      // 3. Search box (searches desc, order ID, card name, and itemized product names!)
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

      // 5. Price range (absolute amount value)
      if (minVal !== null || maxVal !== null) {
        const absAmount = Math.abs(tx.amount);
        if (minVal !== null && absAmount < minVal) return false;
        if (maxVal !== null && absAmount > maxVal) return false;
      }

      return true;
    });

    // Sort operations
    const sortVal = sortBySelect.value;
    filteredTransactions.sort((a, b) => {
      if (sortVal === "date-desc") {
        return new Date(b.date) - new Date(a.date);
      } else if (sortVal === "date-asc") {
        return new Date(a.date) - new Date(b.date);
      } else if (sortVal === "amount-desc") {
        return Math.abs(b.amount) - Math.abs(a.amount);
      } else if (sortVal === "amount-asc") {
        return Math.abs(a.amount) - Math.abs(b.amount);
      }
      return 0;
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

    // 1. Total Spending (Separate Purchases vs Refunds)
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

      // Count itemized quantities
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

    // 2. Total Items Metrics
    kpiTotalItems.innerText = totalItemsCount;
    const avgItems =
      ordersWithItemsCount > 0
        ? (totalItemsCount / ordersWithItemsCount).toFixed(1)
        : "0.0";
    kpiItemsSub.innerText = `Across ${ordersWithItemsCount} itemized order listings (Avg ${avgItems}/order)`;

    // 3. Average & Median Order Sizes
    const orderCount = purchaseAmounts.length;
    const avgOrderValue = orderCount > 0 ? purchasesSum / orderCount : 0;
    kpiAvgOrder.innerText = formatCurrency(avgOrderValue);

    // Compute median order size
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

    // 4. Top Spending Month
    const monthlyGroups = {};
    filteredTransactions.forEach((tx) => {
      const isRefund = tx.amount < 0;
      if (isRefund) return; // skip refunds in monthly peak calculation

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
   * Generates a modern interactive SVG chart programmatically
   */
  function renderChart() {
    spendingChart.innerHTML = ""; // Clear existing

    const chartW = spendingChart.clientWidth || 800;
    const chartH = spendingChart.clientHeight || 240;

    spendingChart.setAttribute("viewBox", `0 0 ${chartW} ${chartH}`);
    spendingChart.removeAttribute("preserveAspectRatio");

    if (filteredTransactions.length === 0) {
      spendingChart.innerHTML = `<text x="${chartW / 2}" y="${chartH / 2}" fill="var(--text-dark)" text-anchor="middle" font-size="13">No transaction data available for the selected filters</text>`;
      return;
    }

    // Set SVG gradients inside definitions
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="100%" stop-color="#c084fc" />
      </linearGradient>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25" />
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0.0" />
      </linearGradient>
      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.8" />
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0.3" />
      </linearGradient>
    `;
    spendingChart.appendChild(defs);

    const padding = { top: 20, right: 30, bottom: 30, left: 60 };
    const plotW = chartW - padding.left - padding.right;
    const plotH = chartH - padding.top - padding.bottom;

    if (chartMode === "monthly") {
      // MODE 1: Monthly Grouped Spent (Bar Chart representation)
      // Group by month
      const monthlyData = {};

      // Get all unique months in range (sort ascending)
      const dates = filteredTransactions.map((t) => new Date(t.date));
      if (dates.length === 0) return;
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));

      let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

      // Seed all months in range with 0
      while (curr <= end) {
        const key = curr.toLocaleString("default", {
          month: "short",
          year: "2-digit",
        });
        monthlyData[key] = { label: key, net: 0, purchases: 0, refunds: 0 };
        curr.setMonth(curr.getMonth() + 1);
      }

      // Populate monthly spent
      filteredTransactions.forEach((tx) => {
        const date = new Date(tx.date);
        const key = date.toLocaleString("default", {
          month: "short",
          year: "2-digit",
        });

        if (monthlyData[key]) {
          if (tx.amount < 0) {
            monthlyData[key].refunds += Math.abs(tx.amount);
            monthlyData[key].net -= Math.abs(tx.amount);
          } else {
            monthlyData[key].purchases += tx.amount;
            monthlyData[key].net += tx.amount;
          }
        }
      });

      const dataArray = Object.values(monthlyData);

      // If we only have 1 month, let's keep it clean
      if (dataArray.length === 0) return;

      // Find max spending for scale
      const maxSpent = Math.max(
        ...dataArray.map((d) => Math.max(d.purchases, Math.abs(d.net))),
        50,
      );

      // Draw Grid & Y-Axis
      drawGridLines(spendingChart, padding, plotW, plotH, maxSpent);

      // Draw Bars
      const barCount = dataArray.length;
      const barW = Math.min(48, (plotW / barCount) * 0.6);
      const spacing = plotW / barCount;

      dataArray.forEach((d, idx) => {
        const x = padding.left + idx * spacing + (spacing - barW) / 2;

        // Use purchases for display bar height, net for hover details
        const barVal = Math.max(0, d.purchases);
        const barHeight = (barVal / maxSpent) * plotH;
        const y = padding.top + plotH - barHeight;

        // Render rounded bar (using SVG path or rect)
        const bar = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        const rx = 4; // rounded corner radius
        const pathString = `
          M ${x},${y + barHeight}
          L ${x},${y + rx}
          Q ${x},${y} ${x + rx},${y}
          L ${x + barW - rx},${y}
          Q ${x + barW},${y} ${x + barW},${y + rx}
          L ${x + barW},${y + barHeight}
          Z
        `;
        bar.setAttribute("d", pathString);
        bar.setAttribute("class", "chart-bar");

        // Show tooltip on hover
        bar.addEventListener("mousemove", (e) => {
          showTooltip(
            e,
            `
            <div class="date">${d.label} Spending Details</div>
            <div class="val">Purchased: ${formatCurrency(d.purchases)}</div>
            <div class="val" style="color: var(--success-emerald)">Refunded: ${formatCurrency(d.refunds)}</div>
            <div class="val" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:4px;">Net Total: ${formatCurrency(d.net)}</div>
          `,
          );
        });

        bar.addEventListener("mouseleave", hideTooltip);
        spendingChart.appendChild(bar);

        // Draw X Axis labels
        drawLabel(
          spendingChart,
          d.label,
          x + barW / 2,
          padding.top + plotH + 16,
          "middle",
        );
      });
    } else {
      // MODE 2: Cumulative Sum (Line Chart representation)
      // Sort oldest first for running total calculation
      const cumulativeData = [...filteredTransactions]
        .filter((t) => t.amount > 0) // chart cumulative purchases
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (cumulativeData.length === 0) return;

      let runningTotal = 0;
      const points = cumulativeData.map((tx) => {
        runningTotal += tx.amount;
        return {
          date: tx.date,
          orderId: tx.id,
          amount: tx.amount,
          cumulative: runningTotal,
        };
      });

      const maxTotal = runningTotal || 100;

      // Draw Grid & Y-Axis
      drawGridLines(spendingChart, padding, plotW, plotH, maxTotal);

      // Map coordinates
      const count = points.length;
      const coords = points.map((p, idx) => {
        const x = padding.left + (idx / (count - 1 || 1)) * plotW;
        const y = padding.top + plotH - (p.cumulative / maxTotal) * plotH;
        return { x, y, ...p };
      });

      // Construct Smooth SVG Path
      if (coords.length > 0) {
        let lineD = `M ${coords[0].x},${coords[0].y}`;
        let areaD = `M ${coords[0].x},${padding.top + plotH} L ${coords[0].x},${coords[0].y}`;

        for (let i = 1; i < coords.length; i++) {
          // Linear line matching standard progression
          lineD += ` L ${coords[i].x},${coords[i].y}`;
          areaD += ` L ${coords[i].x},${coords[i].y}`;
        }

        areaD += ` L ${coords[coords.length - 1].x},${padding.top + plotH} Z`;

        // Render Area Fill
        const areaPath = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        areaPath.setAttribute("d", areaD);
        areaPath.setAttribute("class", "chart-area");
        spendingChart.appendChild(areaPath);

        // Render Line Stroke
        const linePath = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        linePath.setAttribute("d", lineD);
        linePath.setAttribute("class", "chart-line");
        spendingChart.appendChild(linePath);

        // Render interactive overlay circles (dots) at vertices
        // If there are too many items, sample them to avoid rendering 500 dots
        const dotModulo = Math.max(1, Math.floor(coords.length / 50));

        coords.forEach((c, idx) => {
          if (idx % dotModulo !== 0 && idx !== coords.length - 1) return;

          const dot = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
          dot.setAttribute("cx", c.x);
          dot.setAttribute("cy", c.y);
          dot.setAttribute("r", 4);
          dot.setAttribute("class", "chart-point");

          dot.addEventListener("mousemove", (e) => {
            showTooltip(
              e,
              `
              <div class="date">${new Date(c.date).toLocaleDateString()}</div>
              <div class="val">Transaction: ${formatCurrency(c.amount)}</div>
              <div class="val" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:4px;">Cumulative Spend: ${formatCurrency(c.cumulative)}</div>
              <div class="date" style="font-family:monospace;margin-top:2px;">Order ${c.orderId}</div>
            `,
            );
          });

          dot.addEventListener("mouseleave", hideTooltip);
          spendingChart.appendChild(dot);
        });

        // Draw start and end date labels on X axis
        const startDateText = new Date(coords[0].date).toLocaleDateString(
          "default",
          { month: "short", day: "numeric", year: "2-digit" },
        );
        const endDateText = new Date(
          coords[coords.length - 1].date,
        ).toLocaleDateString("default", {
          month: "short",
          day: "numeric",
          year: "2-digit",
        });

        drawLabel(
          spendingChart,
          startDateText,
          padding.left,
          padding.top + plotH + 16,
          "start",
        );
        drawLabel(
          spendingChart,
          endDateText,
          padding.left + plotW,
          padding.top + plotH + 16,
          "end",
        );
      }
    }
  }

  function drawGridLines(svg, padding, w, h, maxVal) {
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const yVal = (i / ticks) * maxVal;
      const y = padding.top + h - (i / ticks) * h;

      // Dotted horizontal grid line
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", padding.left);
      line.setAttribute("y1", y);
      line.setAttribute("x2", padding.left + w);
      line.setAttribute("y2", y);
      line.setAttribute("class", "chart-grid-line");
      svg.appendChild(line);

      // Y-axis label text
      drawLabel(
        svg,
        formatCurrencyCompact(yVal),
        padding.left - 10,
        y + 3,
        "end",
      );
    }

    // Baseline axis line
    const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    axis.setAttribute("x1", padding.left);
    axis.setAttribute("y1", padding.top + h);
    axis.setAttribute("x2", padding.left + w);
    axis.setAttribute("y2", padding.top + h);
    axis.setAttribute("class", "chart-axis-line");
    svg.appendChild(axis);
  }

  function drawLabel(svg, text, x, y, align = "start") {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
    el.setAttribute("x", x);
    el.setAttribute("y", y);
    el.setAttribute("class", "chart-axis-text");
    el.setAttribute(
      "text-anchor",
      align === "start" ? "start" : align === "end" ? "end" : "middle",
    );
    el.textContent = text;
    svg.appendChild(el);
  }

  function showTooltip(e, content) {
    chartTooltip.innerHTML = content;
    chartTooltip.style.display = "block";

    // Center tooltip above active mouse position
    const box = spendingChart.getBoundingClientRect();
    const scrollLeft =
      window.pageXOffset || document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    const x = e.clientX - box.left - chartTooltip.offsetWidth / 2;
    const y = e.clientY - box.top - chartTooltip.offsetHeight - 12;

    chartTooltip.style.left = `${x}px`;
    chartTooltip.style.top = `${y}px`;
  }

  function handleMouseMoveOnContainer(e) {
    // Left empty for direct bubble updates
  }

  function hideTooltip() {
    chartTooltip.style.display = "none";
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
      if (hasItems) {
        itemsCount = displayItems.reduce(
          (acc, i) => acc + (i.quantity || 1),
          0,
        );
      }

      // Calculate shipping and tax for UI column
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

      // Master Row
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

      // Expandable Details Sub-Row
      const detailsRow = document.createElement("tr");
      detailsRow.className = "details-row";
      detailsRow.id = `details-${tx.id}`;

      // Hydrate itemized templates inside drawer
      let itemsListHtml = "";
      let subtotalSum = 0;
      let receiptDiff = 0;

      if (hasItems) {
        itemsListHtml = displayItems
          .map((item) => {
            const itemSubtotal = (item.price || 0) * (item.quantity || 1);
            subtotalSum += itemSubtotal;

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

      // Accordion click interactions
      row.addEventListener("click", () => {
        const isCurrentlyExpanded = row.classList.contains("expanded");

        // Collapse all expanded rows in the table (keeps UI extremely tidy)
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
   * Generates and downloads a CSV export of the currently filtered transactions dataset.
   * Compiles the data into a CSV string, constructs a Blob, triggers a browser download
   * using a transient Object URL, and cleans up memory immediately.
   */
  function exportToCSV() {
    if (filteredTransactions.length === 0) return;

    // Build Headers
    let csvContent =
      "Date,Order ID,Description,Card/Payment Method,Amount Paid,Shipping & Tax,Item Title,Item Unit Price,Item Qty,Seller,Item Link\n";

    filteredTransactions.forEach((tx) => {
      const isRefund = tx.amount < 0;
      const baseAmt = isRefund ? -Math.abs(tx.amount) : tx.amount;

      const escapedDesc = `"${tx.description.replace(/"/g, '""')}"`;
      const escapedPm = `"${(tx.paymentMethod || "Amazon Bal").replace(/"/g, '""')}"`;

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

      // Compute shipping & tax for this transaction
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
        // Round to 2 decimals
        shippingAndTax = parseFloat(shippingAndTax.toFixed(2));
      }

      if (displayItems.length > 0) {
        displayItems.forEach((item) => {
          const escapedTitle = `"${item.title.replace(/"/g, '""')}"`;
          const escapedSeller = `"${(item.seller || "Amazon").replace(/"/g, '""')}"`;
          const rowData = [
            tx.date,
            tx.orderId || "N/A",
            escapedDesc,
            escapedPm,
            baseAmt,
            shippingAndTax,
            escapedTitle,
            item.price,
            item.quantity,
            escapedSeller,
            item.url || "",
          ].join(",");
          csvContent += rowData + "\n";
        });
      } else {
        // Non-itemized flat row fallback
        const rowData = [
          tx.date,
          tx.orderId || "N/A",
          escapedDesc,
          escapedPm,
          baseAmt,
          0.0,
          "Unitemized Transaction",
          baseAmt,
          1,
          "Amazon",
          tx.detailsLink || "",
        ].join(",");
        csvContent += rowData + "\n";
      }
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `DataPrime_Spending_Export_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Downloads a full formatted JSON dump of the currently filtered transaction dataset.
   * Serializes the array, constructs a Blob, triggers a browser download using a
   * transient Object URL, and cleans up memory immediately.
   */
  function exportToJSON() {
    if (filteredTransactions.length === 0) return;

    const exportedTransactions = filteredTransactions.map((tx) => {
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
        // Round to 2 decimals
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

    const blob = new Blob([JSON.stringify(exportedTransactions, null, 2)], {
      type: "application/json;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `DataPrime_Analytics_Export_${new Date().toISOString().split("T")[0]}.json`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // --- Helpers ---

  function formatCurrency(val) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(val);
  }

  function formatCurrencyCompact(val) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      compactDisplay: "short",
    }).format(val);
  }

  function escapeHtml(text) {
    if (!text) return "";
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.toString().replace(/[&<>"']/g, (m) => map[m]);
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Finds the subset of items that best matches the refund amount.
   */
  function getRefundItems(items, refundAmount) {
    if (!items || items.length === 0) return [];
    const target = Math.abs(refundAmount);

    // Flatten items by quantity to handle individual unit returns
    const flatItems = [];
    items.forEach((item, index) => {
      const qty = item.quantity || 1;
      for (let q = 0; q < qty; q++) {
        flatItems.push({
          ...item,
          originalIndex: index,
          quantity: 1,
        });
      }
    });

    // If total sum of all items is less than target, or very close (e.g. target includes tax/shipping)
    const totalSum = flatItems.reduce(
      (acc, item) => acc + (item.price || 0),
      0,
    );
    if (totalSum <= target * 1.02) {
      return items;
    }

    // Generate all subsets of flatItems (limit size to prevent slow loops)
    let bestSubset = [];
    let bestDiff = Infinity;

    if (flatItems.length <= 10) {
      const n = flatItems.length;
      const limit = 1 << n;
      for (let i = 1; i < limit; i++) {
        const subset = [];
        let sum = 0;
        for (let j = 0; j < n; j++) {
          if ((i & (1 << j)) !== 0) {
            subset.push(flatItems[j]);
            sum += flatItems[j].price || 0;
          }
        }

        if (sum <= target * 1.02) {
          const diff = target - sum;
          if (diff < bestDiff) {
            bestDiff = diff;
            bestSubset = subset;
          }
        }
      }
    }

    // Greedy fallback if flatItems size > 10 or subset search found nothing
    if (bestSubset.length === 0 || flatItems.length > 10) {
      const sortedItems = [...flatItems].sort(
        (a, b) => (b.price || 0) - (a.price || 0),
      );
      let currentSum = 0;
      const subset = [];
      for (const item of sortedItems) {
        if (currentSum + (item.price || 0) <= target * 1.02) {
          subset.push(item);
          currentSum += item.price || 0;
        }
      }
      if (subset.length > 0) {
        bestSubset = subset;
      }
    }

    // Closest single item fallback
    if (bestSubset.length === 0) {
      let closestItem = flatItems[0];
      let closestDiff = Infinity;
      flatItems.forEach((item) => {
        const diff = Math.abs((item.price || 0) - target);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestItem = item;
        }
      });
      if (closestItem) {
        bestSubset = [closestItem];
      }
    }

    // Re-group flat items back by their original index
    const groupedMap = new Map();
    bestSubset.forEach((flatItem) => {
      const orig = items[flatItem.originalIndex];
      if (!groupedMap.has(flatItem.originalIndex)) {
        groupedMap.set(flatItem.originalIndex, {
          ...orig,
          quantity: 0,
        });
      }
      groupedMap.get(flatItem.originalIndex).quantity += 1;
    });

    return Array.from(groupedMap.values());
  }
});
