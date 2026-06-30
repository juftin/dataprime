/**
 * DataPrime Dashboard - Data Exporters & Format Utilities
 */

/**
 * Formats a numeric value as standard USD currency.
 * @param {number} val - Numeric value.
 * @returns {string}
 */
export function formatCurrency(val) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);
}

/**
 * Formats a numeric value as a compact USD currency string.
 * @param {number} val - Numeric value.
 * @returns {string}
 */
export function formatCurrencyCompact(val) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    compactDisplay: "short",
  }).format(val);
}

/**
 * Escapes special HTML characters in a string to prevent XSS.
 * @param {string} text - Raw string.
 * @returns {string}
 */
export function escapeHtml(text) {
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

/**
 * Returns a debounced version of the input function.
 * @param {Function} func - Function to debounce.
 * @param {number} wait - Debounce timeout in milliseconds.
 * @returns {Function}
 */
export function debounce(func, wait) {
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

/**
 * Pauses execution for a specified duration in milliseconds.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds the subset of items that best matches the refund amount.
 * @param {Array<Object>} items - Array of items in the order.
 * @param {number} refundAmount - Numeric refund amount.
 * @returns {Array<Object>}
 */
export function getRefundItems(items, refundAmount) {
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

  // If total sum of all items is less than target, or very close
  const totalSum = flatItems.reduce((acc, item) => acc + (item.price || 0), 0);
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

/**
 * Generates and downloads a CSV export of the currently filtered transactions dataset.
 * @param {Array<Object>} transactions - Transactions list to export.
 * @param {string} [mode="line-item"] - Export format mode: 'line-item' or 'transaction'.
 */
export function exportToCSV(transactions, mode = "line-item") {
  if (!transactions || transactions.length === 0) return;

  let csvContent = "";

  if (mode === "transaction") {
    // Build Headers for Transaction-Level
    csvContent =
      "id,date,orderId,description,paymentMethod,paymentAmount,orderSubtotal,shippingHandling,orderTax,orderTotal,refundSubtotal,refundTax,refundTotal,items\n";

    transactions.forEach((tx) => {
      const isRefund = tx.paymentAmount < 0;
      const baseAmt = isRefund ? -Math.abs(tx.paymentAmount) : tx.paymentAmount;

      const escapedDesc = `"${tx.description.replace(/"/g, '""')}"`;
      const escapedPm = `"${(tx.paymentMethod || "Amazon Bal").replace(/"/g, '""')}"`;

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

      // Compute shipping & tax for this transaction
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
        // Round to 2 decimals
        shippingAndTax = parseFloat(shippingAndTax.toFixed(2));
      }

      let itemsString = "";
      if (displayItems.length > 0) {
        itemsString = displayItems
          .map((item) => {
            const qty = item.quantity || 1;
            return qty > 1 ? `${item.title} (x${qty})` : item.title;
          })
          .join("; ");
      } else {
        itemsString = "Unitemized Transaction";
      }

      const escapedItems = `"${itemsString.replace(/"/g, '""')}"`;

      const summary = tx.summary || {};
      const orderSubtotal =
        summary.orderSubtotal !== undefined ? summary.orderSubtotal : "";
      const shippingHandlingVal =
        summary.shippingHandling !== undefined
          ? summary.shippingHandling
          : tx.paymentAmount >= 0
            ? shippingAndTax
            : "";
      const orderTax = summary.orderTax !== undefined ? summary.orderTax : "";
      const orderTotalVal =
        summary.orderTotal !== undefined
          ? summary.orderTotal
          : tx.paymentAmount >= 0
            ? baseAmt
            : "";
      const refundSubtotal =
        summary.refundSubtotal !== undefined ? summary.refundSubtotal : "";
      const refundTax =
        summary.refundTax !== undefined ? summary.refundTax : "";
      const refundTotalVal =
        summary.refundTotal !== undefined
          ? summary.refundTotal
          : tx.paymentAmount < 0
            ? baseAmt
            : "";

      const rowData = [
        tx.id || "",
        tx.date,
        tx.orderId || "N/A",
        escapedDesc,
        escapedPm,
        baseAmt,
        orderSubtotal,
        shippingHandlingVal,
        orderTax,
        orderTotalVal,
        refundSubtotal,
        refundTax,
        refundTotalVal,
        escapedItems,
      ].join(",");
      csvContent += rowData + "\n";
    });
  } else {
    // Build Headers for Line-Item Level
    csvContent =
      "date,orderId,description,paymentMethod,paymentAmount,shippingHandling,title,price,quantity,seller,url,asin\n";

    transactions.forEach((tx) => {
      const isRefund = tx.paymentAmount < 0;
      const baseAmt = isRefund ? -Math.abs(tx.paymentAmount) : tx.paymentAmount;

      const escapedDesc = `"${tx.description.replace(/"/g, '""')}"`;
      const escapedPm = `"${(tx.paymentMethod || "Amazon Bal").replace(/"/g, '""')}"`;

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

      // Compute shipping & tax for this transaction
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
            item.asin || "",
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
          tx.orderDetailsUrl || "",
          "",
        ].join(",");
        csvContent += rowData + "\n";
      }
    });
  }

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const filename =
    mode === "transaction"
      ? "DataPrime_Grouped_Export.csv"
      : "DataPrime_Itemized_Export.csv";
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a full formatted JSON dump of the currently filtered transaction dataset.
 * @param {Array<Object>} transactions - Transactions list to export.
 */
export function exportToJSON(transactions) {
  if (!transactions || transactions.length === 0) return;

  const exportedTransactions = transactions.map((tx) => {
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
  link.setAttribute("download", "DataPrime_JSON_Export.json");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
