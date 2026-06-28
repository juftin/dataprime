/**
 * DataPrime Content Scraper - Visual HUD & Tab Title Controller
 */

// HUD references (shared global state)
var hudElement = null;
var hudConsole = null;

/**
 * Ensures the scraper progress HUD overlay is created and styled in the document.
 */
function ensureHUD() {
  if (hudElement) return;

  hudElement = document.createElement("div");
  hudElement.id = "dataprime-hud";
  hudElement.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    width: 340px;
    background: rgba(11, 15, 25, 0.9);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.15);
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    z-index: 2147483647;
    padding: 18px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 10px;
    margin-bottom: 14px;
  `;
  header.innerHTML = `
    <span style="font-weight: 700; font-size: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">DataPrime Analyzer</span>
    <span id="pl-hud-status" style="font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 9999px; background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.25);">IDLE</span>
  `;
  hudElement.appendChild(header);

  // Add a clear warning banner to keep the tab open
  const warningBanner = document.createElement("div");
  warningBanner.id = "pl-hud-warning-banner";
  warningBanner.style.cssText = `
    font-size: 11px;
    font-weight: 500;
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 10px;
    padding: 8px 12px;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    line-height: 1.4;
  `;
  warningBanner.innerHTML = `
    <span style="font-size: 14px;">⚠️</span>
    <span><strong>Keep this tab open!</strong> Closing it will stop the analysis. This tab will close automatically when complete.</span>
  `;
  hudElement.appendChild(warningBanner);

  const stats = document.createElement("div");
  stats.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  `;
  stats.innerHTML = `
    <div style="background: rgba(255, 255, 255, 0.02); border-radius: 10px; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.04); text-align: center;">
      <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 2px;">Active Page</div>
      <div id="pl-hud-page" style="font-size: 20px; font-weight: 800; color: #f1f5f9; text-shadow: 0 0 10px rgba(255,255,255,0.1);">0</div>
    </div>
    <div style="background: rgba(255, 255, 255, 0.02); border-radius: 10px; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.04); text-align: center;">
      <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 2px;">Analyzed Items</div>
      <div id="pl-hud-matches" style="font-size: 20px; font-weight: 800; color: #f1f5f9; text-shadow: 0 0 10px rgba(255,255,255,0.1);">0</div>
    </div>
  `;
  hudElement.appendChild(stats);

  const consoleTitle = document.createElement("div");
  consoleTitle.style.cssText = `
    color: #94a3b8;
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  `;
  consoleTitle.innerText = "Analyzer Feedback Loop Logs";
  hudElement.appendChild(consoleTitle);

  hudConsole = document.createElement("div");
  hudConsole.id = "pl-hud-console";
  hudConsole.style.cssText = `
    height: 120px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 10px;
    padding: 10px;
    overflow-y: auto;
    font-family: "Fira Code", Monaco, Consolas, "Ubuntu Mono", monospace;
    font-size: 11px;
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.04);
    line-height: 1.4;
  `;
  hudElement.appendChild(hudConsole);

  const stopButton = document.createElement("button");
  stopButton.style.cssText = `
    width: 100%;
    margin-top: 14px;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    border: none;
    border-radius: 10px;
    color: white;
    padding: 10px;
    font-weight: 700;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
  `;
  stopButton.innerText = "Cancel Analysis";
  stopButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "STOP_SCRAPE" });
    removeHUD();
  });
  stopButton.addEventListener("mouseenter", () => {
    stopButton.style.opacity = "0.9";
  });
  stopButton.addEventListener("mouseleave", () => {
    stopButton.style.opacity = "1";
  });
  hudElement.appendChild(stopButton);

  document.body.appendChild(hudElement);
}

/**
 * Removes the scraper progress HUD overlay from the document.
 */
function removeHUD() {
  if (hudElement) {
    hudElement.remove();
    hudElement = null;
    hudConsole = null;
  }
}

/**
 * Appends a log line message to the HUD overlay console.
 * @param {string} msg - The log message to display.
 */
function logToHUD(msg) {
  ensureHUD();
  console.log("[DataPrime HUD]", msg);
  if (hudConsole) {
    const logLine = document.createElement("div");
    logLine.style.cssText =
      "margin-bottom: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.02); padding-bottom: 3px; word-break: break-all;";
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    logLine.innerHTML = `<span style="color: #818cf8; font-weight: 600;">[${timestamp}]</span> ${msg}`;
    hudConsole.appendChild(logLine);
    hudConsole.scrollTop = hudConsole.scrollHeight;
  }
}

/**
 * Updates the HUD statistics and layout status (e.g. COMPLETED, ERROR, RUNNING).
 * @param {string} status - Layout status.
 * @param {number} page - Active page number.
 * @param {number} matches - Total transaction matches scraped.
 */
function updateHUDStatus(status, page, matches) {
  ensureHUD();
  const statusEl = document.getElementById("pl-hud-status");
  const pageEl = document.getElementById("pl-hud-page");
  const matchesEl = document.getElementById("pl-hud-matches");
  const warningEl = document.getElementById("pl-hud-warning-banner");

  if (statusEl) {
    statusEl.innerText = status;
    if (status === "ERROR") {
      statusEl.style.background = "rgba(239, 68, 68, 0.15)";
      statusEl.style.color = "#f87171";
      statusEl.style.borderColor = "rgba(239, 68, 68, 0.25)";
      if (warningEl) warningEl.style.display = "none";
    } else if (status === "COMPLETED") {
      statusEl.style.background = "rgba(16, 185, 129, 0.15)";
      statusEl.style.color = "#34d399";
      statusEl.style.borderColor = "rgba(16, 185, 129, 0.25)";
      if (warningEl) {
        warningEl.style.color = "#a7f3d0";
        warningEl.style.background = "rgba(16, 185, 129, 0.08)";
        warningEl.style.borderColor = "rgba(16, 185, 129, 0.2)";
        warningEl.innerHTML = `
          <span style="font-size: 14px;">✅</span>
          <span><strong>Analysis complete!</strong> Opening the dashboard now...</span>
        `;
      }
    } else {
      statusEl.style.background = "rgba(99, 102, 241, 0.15)";
      statusEl.style.color = "#818cf8";
      statusEl.style.borderColor = "rgba(99, 102, 241, 0.25)";
      if (warningEl) {
        warningEl.style.display = "flex";
        warningEl.style.color = "#fca5a5";
        warningEl.style.background = "rgba(239, 68, 68, 0.08)";
        warningEl.style.borderColor = "rgba(239, 68, 68, 0.2)";
        warningEl.innerHTML = `
          <span style="font-size: 14px;">⚠️</span>
          <span><strong>Keep this tab open!</strong> Closing it will stop the analysis. This tab will close automatically when complete.</span>
        `;
      }
    }
  }
  if (pageEl) pageEl.innerText = page;
  if (matchesEl) matchesEl.innerText = matches;

  // Update browser tab title dynamically
  updateTabTitle(status);
}

/**
 * Dynamically updates the browser tab title to reflect scraping progress,
 * transaction counts, and the target or parsed time range.
 * @param {string} status - Layout status.
 */
function updateTabTitle(status) {
  if (typeof document === "undefined") return;

  let titleStatus = status || "Analyzing";
  let detailStr = "";

  if (titleStatus === "COMPLETED") {
    const txCount = scrapingState.scrapedTransactions.length;
    detailStr = `${txCount} txns`;
    titleStatus = "Done";
  } else if (titleStatus === "ERROR") {
    detailStr = "Failed";
    titleStatus = "Error";
  } else if (titleStatus === "ITEMIZING") {
    if (scrapingState.itemizationProgress) {
      detailStr = `${scrapingState.itemizationProgress.current}/${scrapingState.itemizationProgress.total} orders`;
    } else {
      detailStr = "Itemizing";
    }
    titleStatus = "Itemizing";
  } else {
    const pageNum = scrapingState.pageCount || 1;
    const txCount = scrapingState.scrapedTransactions.length;
    detailStr = `Pg ${pageNum} (${txCount} txns)`;
    titleStatus = "Analyzing";
  }

  // Determine time range dynamically
  let rangeStr = "";
  if (scrapingState.startDate || scrapingState.endDate) {
    const start = scrapingState.startDate
      ? scrapingState.startDate
      : "All Time";
    const end = scrapingState.endDate ? scrapingState.endDate : "Present";
    rangeStr = `${start} to ${end}`;
  } else if (scrapingState.scrapedTransactions.length > 0) {
    const dates = scrapingState.scrapedTransactions
      .map((t) => t.date)
      .filter((d) => d)
      .sort();
    if (dates.length > 0) {
      rangeStr = `${dates[0]} to ${dates[dates.length - 1]}`;
    }
  }
  if (!rangeStr) {
    rangeStr = "All Time";
  }

  document.title = `[DataPrime: ${titleStatus}] ${detailStr} | ${rangeStr}`;
}

// Exports for Node/Bun testing compatibility
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    hudElement,
    hudConsole,
    ensureHUD,
    removeHUD,
    logToHUD,
    updateHUDStatus,
    updateTabTitle,
  };
}
