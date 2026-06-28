/**
 * DataPrime Dashboard - Spending Trends SVG Chart Renderer
 */

import { formatCurrency, formatCurrencyCompact } from "./exporters.js";

/**
 * Generates an interactive SVG chart programmatically in the provided container.
 * @param {SVGElement} spendingChart - SVG container element.
 * @param {HTMLElement} chartTooltip - Tooltip overlay element.
 * @param {Array<Object>} filteredTransactions - Filtered transactions dataset.
 * @param {string} chartMode - Active mode ("monthly" or "cumulative").
 * @param {boolean} includeReturns - Whether to include returns in cumulative sum.
 */
export function renderChart(
  spendingChart,
  chartTooltip,
  filteredTransactions,
  chartMode,
  includeReturns,
) {
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

  // Tooltip display helpers
  const showTooltip = (e, content) => {
    chartTooltip.innerHTML = content;
    chartTooltip.style.display = "block";

    const box = spendingChart.getBoundingClientRect();
    const x = e.clientX - box.left - chartTooltip.offsetWidth / 2;
    const y = e.clientY - box.top - chartTooltip.offsetHeight - 12;

    chartTooltip.style.left = `${x}px`;
    chartTooltip.style.top = `${y}px`;
  };

  const hideTooltip = () => {
    chartTooltip.style.display = "none";
  };

  if (chartMode === "monthly") {
    // MODE 1: Monthly Grouped Spent (Bar Chart representation)
    const monthlyData = {};

    const dates = filteredTransactions.map((t) => new Date(t.date));
    if (dates.length === 0) return;
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

    while (curr <= end) {
      const key = curr.toLocaleString("default", {
        month: "short",
        year: "2-digit",
      });
      monthlyData[key] = { label: key, net: 0, purchases: 0, refunds: 0 };
      curr.setMonth(curr.getMonth() + 1);
    }

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
    if (dataArray.length === 0) return;

    const maxSpent = Math.max(
      ...dataArray.map((d) => Math.max(d.purchases, Math.abs(d.net))),
      50,
    );

    drawGridLines(spendingChart, padding, plotW, plotH, 0, maxSpent);

    const barCount = dataArray.length;
    const barW = Math.min(48, (plotW / barCount) * 0.6);
    const spacing = plotW / barCount;

    dataArray.forEach((d, idx) => {
      const x = padding.left + idx * spacing + (spacing - barW) / 2;
      const barVal = Math.max(0, d.purchases);
      const barHeight = (barVal / maxSpent) * plotH;
      const y = padding.top + plotH - barHeight;

      const bar = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      const rx = 4;
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
    const cumulativeData = [...filteredTransactions]
      .filter((t) => (includeReturns ? t.amount !== 0 : t.amount > 0))
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

    const cumulativeVals = points.map((p) => p.cumulative);
    const maxVal = Math.max(...cumulativeVals, 10);
    const minVal = Math.min(...cumulativeVals, 0);
    const range = maxVal - minVal || 10;

    drawGridLines(spendingChart, padding, plotW, plotH, minVal, maxVal);

    const count = points.length;
    const coords = points.map((p, idx) => {
      const x = padding.left + (idx / (count - 1 || 1)) * plotW;
      const y = padding.top + plotH - ((p.cumulative - minVal) / range) * plotH;
      return { x, y, ...p };
    });

    if (coords.length > 0) {
      let lineD = `M ${coords[0].x},${coords[0].y}`;
      let areaD = `M ${coords[0].x},${padding.top + plotH} L ${coords[0].x},${coords[0].y}`;

      for (let i = 1; i < coords.length; i++) {
        lineD += ` L ${coords[i].x},${coords[i].y}`;
        areaD += ` L ${coords[i].x},${coords[i].y}`;
      }

      areaD += ` L ${coords[coords.length - 1].x},${padding.top + plotH} Z`;

      const areaPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      areaPath.setAttribute("d", areaD);
      areaPath.setAttribute("class", "chart-area");
      spendingChart.appendChild(areaPath);

      const linePath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      linePath.setAttribute("d", lineD);
      linePath.setAttribute("class", "chart-line");
      spendingChart.appendChild(linePath);

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

/**
 * Draws background grid lines and Y-axis labels.
 */
function drawGridLines(svg, padding, w, h, minVal, maxVal) {
  const ticks = 4;
  const range = maxVal - minVal;
  for (let i = 0; i <= ticks; i++) {
    const yVal = minVal + (i / ticks) * range;
    const y = padding.top + h - (i / ticks) * h;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padding.left);
    line.setAttribute("y1", y);
    line.setAttribute("x2", padding.left + w);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chart-grid-line");
    svg.appendChild(line);

    drawLabel(
      svg,
      formatCurrencyCompact(yVal),
      padding.left - 10,
      y + 3,
      "end",
    );
  }

  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("x1", padding.left);
  axis.setAttribute("y1", padding.top + h);
  axis.setAttribute("x2", padding.left + w);
  axis.setAttribute("y2", padding.top + h);
  axis.setAttribute("class", "chart-axis-line");
  svg.appendChild(axis);
}

/**
 * Renders axis labels.
 */
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
