/**
 * DataPrime Extension Popup Controller
 */

document.addEventListener("DOMContentLoaded", async () => {
  // DOM Elements
  const panelConfig = document.getElementById("panelConfig");
  const panelProgress = document.getElementById("panelProgress");
  const panelComplete = document.getElementById("panelComplete");

  const statusBadge = document.getElementById("statusBadge");
  const presetBtns = document.querySelectorAll(".preset-btn");
  const customDatesRow = document.getElementById("customDatesRow");
  const startDateInput = document.getElementById("startDate");
  const endDateInput = document.getElementById("endDate");

  const btnStartScrape = document.getElementById("btnStartScrape");
  const btnCancelScrape = document.getElementById("btnCancelScrape");
  const btnLoadDemo = document.getElementById("btnLoadDemo");
  const btnClearSaved = document.getElementById("btnClearSaved");
  const btnOpenDashboard = document.getElementById("btnOpenDashboard");
  const btnGoBack = document.getElementById("btnGoBack");
  const linkDashboard = document.getElementById("linkDashboard");

  const progressCircleOuter = document.getElementById("progressCircleOuter");
  const progressCircleInner = document.getElementById("progressCircleInner");
  const progressPercentage = document.getElementById("progressPercentage");
  const statusMessage = document.getElementById("statusMessage");
  const progressCount = document.getElementById("progressCount");
  const progressPageCount = document.getElementById("progressPageCount");
  const progressCountLabel = document.getElementById("progressCountLabel");
  const progressPageLabel = document.getElementById("progressPageLabel");
  const progressCacheBubble = document.getElementById("progressCacheBubble");
  const progressCacheCount = document.getElementById("progressCacheCount");

  const sumTotalSpend = document.getElementById("sumTotalSpend");
  const sumTxCount = document.getElementById("sumTxCount");

  // Local state
  let currentPreset = "30";

  // Circular progress calculations
  const outerCircumference = 2 * Math.PI * 44;
  const innerCircumference = 2 * Math.PI * 34;
  progressCircleOuter.style.strokeDasharray = `${outerCircumference} ${outerCircumference}`;
  progressCircleInner.style.strokeDasharray = `${innerCircumference} ${innerCircumference}`;

  // 1. Initial State Check
  // Check if background worker is already scraping
  chrome.runtime.sendMessage({ action: "GET_SCRAPE_STATE" }, (state) => {
    if (state) {
      updateUIFromState(state);
    }
  });

  // Listen for state changes from background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SCRAPE_STATE_CHANGED") {
      updateUIFromState(message.payload);
    }
  });

  // 2. Preset Selection
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      presetBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPreset = btn.dataset.range;

      if (currentPreset === "custom") {
        customDatesRow.style.display = "flex";
        // Default to last 30 days in custom inputs
        const today = new Date();
        const thirtyDaysAgo = new Date(
          today.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        startDateInput.value = thirtyDaysAgo.toISOString().split("T")[0];
        endDateInput.value = today.toISOString().split("T")[0];
      } else {
        customDatesRow.style.display = "none";
      }
    });
  });

  // 3. Start Scraping Button
  btnStartScrape.addEventListener("click", async () => {
    let startDate = null;
    let endDate = null;

    const today = new Date();
    if (currentPreset !== "custom") {
      const days = parseInt(currentPreset);
      startDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      endDate = today.toISOString().split("T")[0];
    } else {
      startDate = startDateInput.value;
      endDate = endDateInput.value;
    }

    const fetchItemized = true;

    statusMessage.innerText = "Opening background Amazon tab...";
    switchPanel(panelProgress);
    updateBadge("Analyzing...", "scraping");

    chrome.runtime.sendMessage(
      {
        action: "LAUNCH_BACKGROUND_SCRAPE",
        startDate,
        endDate,
        fetchItemized,
      },
      (_res) => {
        if (chrome.runtime.lastError) {
          alert(
            "Failed to start background analysis: " +
              chrome.runtime.lastError.message,
          );
          switchPanel(panelConfig);
          updateBadge("Idle", "");
        }
      },
    );
  });

  // 4. Cancel Scraping Button
  btnCancelScrape.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "STOP_SCRAPE" });
    switchPanel(panelConfig);
    updateBadge("Idle", "");
  });

  // 5. Open Dashboard Button
  const openDashboardHandler = () => {
    if (window.self !== window.top) {
      window.parent.postMessage({ action: "CLOSE_ANALYZE_MODAL" }, "*");
      return;
    }
    const url = chrome.runtime.getURL("dashboard/results.html");
    chrome.tabs.query({}, (tabs) => {
      const existingTab = (tabs || []).find(
        (t) => t.url && t.url.startsWith(url),
      );
      if (existingTab) {
        chrome.tabs.update(existingTab.id, { active: true }, () => {
          chrome.runtime.lastError;
        });
        chrome.windows.update(existingTab.windowId, { focused: true }, () => {
          chrome.runtime.lastError;
        });
      } else {
        chrome.tabs.create({ url: url });
      }
    });
  };
  btnOpenDashboard.addEventListener("click", openDashboardHandler);

  if (btnGoBack) {
    btnGoBack.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "RESET_SCRAPE_STATE" }, () => {
        switchPanel(panelConfig);
        updateBadge("Idle", "");
      });
    });
  }

  linkDashboard.addEventListener("click", (e) => {
    e.preventDefault();
    openDashboardHandler();
  });

  // 6. Test-Drive Demo Data
  btnLoadDemo.addEventListener("click", () => {
    statusBadge.innerText = "Seeding...";
    btnLoadDemo.disabled = true;
    btnLoadDemo.innerText = "Generating Demo Records...";

    chrome.runtime.sendMessage({ action: "SEED_DEMO_DATA" }, (res) => {
      if (res && res.status === "SUCCESS") {
        setTimeout(() => {
          // Update complete summary
          sumTotalSpend.innerText = "$2,450.75";
          sumTxCount.innerText = "27";

          switchPanel(panelComplete);
          updateBadge("Demo Data", "completed");
          btnLoadDemo.disabled = false;
          btnLoadDemo.innerText = "Test-Drive with Demo Data";

          // Open results tab automatically after seed
          openDashboardHandler();
        }, 1200);
      }
    });
  });

  // 7. Clear Saved Transactions
  if (btnClearSaved) {
    btnClearSaved.addEventListener("click", () => {
      // First cancel any active scraping running in the background cleanly!
      chrome.runtime.sendMessage({ action: "STOP_SCRAPE" }, () => {
        // Suppress any runtime errors if background was inactive
        chrome.runtime.lastError;

        chrome.storage.local.clear(() => {
          const originalText = btnClearSaved.innerText;
          btnClearSaved.innerText = "✓ Database Wiped!";
          btnClearSaved.style.color = "#10b981"; // success emerald
          setTimeout(() => {
            btnClearSaved.innerText = originalText;
            btnClearSaved.style.color = "";
          }, 1500);
        });
      });
    });
  }

  /**
   * Refreshes the popup interface components based on service worker state
   */
  function updateUIFromState(state) {
    const status = state.status;
    const msg = state.message;
    const list = state.transactions || [];

    if (status === "IDLE") {
      switchPanel(panelConfig);
      updateBadge("Idle", "");
    } else if (status === "RUNNING") {
      switchPanel(panelProgress);
      updateBadge("Analyzing...", "scraping");

      // Update progress metrics
      progressCountLabel.innerText = "Parsed";
      progressPageLabel.innerText = "Pages";
      statusMessage.innerText = msg || "Analyzing Amazon list page...";
      progressCount.innerText = list.length;
      progressPageCount.innerText = state.page || 1;
      if (progressCacheBubble) progressCacheBubble.style.display = "none";

      // Calculate page scraping progress based on date range coverage
      let pageProgress = 0;
      if (state.startDate && state.endDate && list.length > 0) {
        const startMs = new Date(state.startDate).getTime();
        const endMs = new Date(state.endDate).getTime();
        const totalDuration = Math.max(1, endMs - startMs);

        // Get the oldest scraped transaction date
        const txDates = list.map((t) => new Date(t.date).getTime());
        const oldestTxMs = Math.min(...txDates);

        // Scraped duration covers from endMs going back to oldestTxMs
        const coveredDuration = Math.max(0, endMs - oldestTxMs);
        pageProgress = Math.min(
          100,
          Math.round((coveredDuration / totalDuration) * 100),
        );
      } else {
        const pageNum = state.page || 1;
        pageProgress = Math.min(95, pageNum * 20);
      }

      setOuterProgress(pageProgress);
      setInnerProgress(0);
      progressPercentage.innerText = `${pageProgress}%`;
    } else if (status === "ITEMIZING") {
      switchPanel(panelProgress);
      updateBadge("Itemizing...", "scraping");

      progressCountLabel.innerText = "Itemized";
      progressPageLabel.innerText = "Transactions";
      progressCount.innerText = `${state.currentFetchIndex}`;
      progressPageCount.innerText = `${state.totalFetchCount}`;
      if (progressCacheBubble) progressCacheBubble.style.display = "flex";
      if (progressCacheCount)
        progressCacheCount.innerText = `${state.cachedCount || 0}`;

      // Update percentage circles
      setOuterProgress(100);
      setInnerProgress(state.progress || 0);
      if (state.progress === 100) {
        progressPercentage.innerHTML = `<div class="progress-spinner"></div>`;
        statusMessage.innerText = "Processing Data...";
      } else {
        progressPercentage.innerText = `${state.progress || 0}%`;
        statusMessage.innerText = msg || "Fetching item details...";
      }
    } else if (status === "COMPLETED") {
      switchPanel(panelComplete);
      updateBadge("Done", "completed");

      // Compute total spent
      const total = list.reduce((acc, t) => acc + t.paymentAmount, 0);
      sumTotalSpend.innerText = formatCurrency(total);
      sumTxCount.innerText = list.length;
    } else if (status === "ERROR") {
      switchPanel(panelConfig);
      updateBadge("Error", "");
      alert(`Analysis Error occurred: ${msg}`);
    }
  }

  /**
   * Animates transition between panels
   */
  function switchPanel(panelEl) {
    [panelConfig, panelProgress, panelComplete].forEach((p) => {
      p.classList.remove("active");
    });
    panelEl.classList.add("active");
  }

  /**
   * Modifies top header badge text and theme
   */
  function updateBadge(text, className) {
    statusBadge.innerText = text;
    statusBadge.className = "status-badge";
    if (className) {
      statusBadge.classList.add(className);
    }
  }

  /**
   * Sets progress ring fill percent
   */
  function setOuterProgress(percent) {
    const offset = outerCircumference - (percent / 100) * outerCircumference;
    progressCircleOuter.style.strokeDashoffset = offset;
  }

  function setInnerProgress(percent) {
    const offset = innerCircumference - (percent / 100) * innerCircumference;
    progressCircleInner.style.strokeDashoffset = offset;
  }

  function formatCurrency(val) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(val);
  }
});
