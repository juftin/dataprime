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
  const fetchItemizedCheck = document.getElementById("fetchItemized");
  
  const btnStartScrape = document.getElementById("btnStartScrape");
  const btnCancelScrape = document.getElementById("btnCancelScrape");
  const btnLoadDemo = document.getElementById("btnLoadDemo");
  const btnClearSaved = document.getElementById("btnClearSaved");
  const btnOpenDashboard = document.getElementById("btnOpenDashboard");
  const btnGoBack = document.getElementById("btnGoBack");
  const linkDashboard = document.getElementById("linkDashboard");
  
  const progressCircle = document.getElementById("progressCircle");
  const progressPercentage = document.getElementById("progressPercentage");
  const statusMessage = document.getElementById("statusMessage");
  const progressCount = document.getElementById("progressCount");
  const progressPageCount = document.getElementById("progressPageCount");
  
  const sumTotalSpend = document.getElementById("sumTotalSpend");
  const sumTxCount = document.getElementById("sumTxCount");

  // Local state
  let currentPreset = "30";

  // Circular progress calculations
  const circleRadius = 44;
  const circumference = 2 * Math.PI * circleRadius;
  progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;

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
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentPreset = btn.dataset.range;

      if (currentPreset === "custom") {
        customDatesRow.style.display = "flex";
        // Default to last 30 days in custom inputs
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        startDateInput.value = thirtyDaysAgo.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
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
      startDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      endDate = today.toISOString().split('T')[0];
    } else {
      startDate = startDateInput.value;
      endDate = endDateInput.value;
    }

    const fetchItemized = fetchItemizedCheck.checked;

    statusMessage.innerText = "Opening background Amazon tab...";
    switchPanel(panelProgress);
    updateBadge("Analyzing...", "scraping");

    chrome.runtime.sendMessage({
      action: "LAUNCH_BACKGROUND_SCRAPE",
      startDate,
      endDate,
      fetchItemized
    }, (res) => {
      if (chrome.runtime.lastError) {
        alert("Failed to start background analysis: " + chrome.runtime.lastError.message);
        switchPanel(panelConfig);
        updateBadge("Idle", "");
      }
    });
  });

  // 4. Cancel Scraping Button
  btnCancelScrape.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "STOP_SCRAPE" });
    switchPanel(panelConfig);
    updateBadge("Idle", "");
  });

  // 5. Open Dashboard Button
  const openDashboardHandler = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/results.html") });
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
        const err = chrome.runtime.lastError;
        
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
    } 
    else if (status === "RUNNING") {
      switchPanel(panelProgress);
      updateBadge("Scraping...", "scraping");
      
      // Update progress metrics
      statusMessage.innerText = msg || "Scraping Amazon list page...";
      progressCount.innerText = list.length;
      progressPageCount.innerText = state.page || 1;
      
      // Infinite scroll pulsing effect for percentage ring during list scraping
      setProgress(50);
      progressPercentage.innerText = "•••";
    } 
    else if (status === "ITEMIZING") {
      switchPanel(panelProgress);
      updateBadge("Itemizing...", "scraping");
      
      statusMessage.innerText = msg || "Fetching item details...";
      progressCount.innerText = list.length;
      progressPageCount.innerText = `${state.currentFetchIndex}/${state.totalFetchCount}`;
      
      // Update percentage circle
      setProgress(state.progress || 0);
      progressPercentage.innerText = `${state.progress || 0}%`;
    } 
    else if (status === "COMPLETED") {
      switchPanel(panelComplete);
      updateBadge("Done", "completed");
      
      // Compute total spent
      const total = list.reduce((acc, t) => acc + t.amount, 0);
      sumTotalSpend.innerText = formatCurrency(total);
      sumTxCount.innerText = list.length;
    } 
    else if (status === "ERROR") {
      switchPanel(panelConfig);
      updateBadge("Error", "");
      alert(`Scraping Error occurred: ${msg}`);
    }
  }

  /**
   * Animates transition between panels
   */
  function switchPanel(panelEl) {
    [panelConfig, panelProgress, panelComplete].forEach(p => {
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
  function setProgress(percent) {
    const offset = circumference - (percent / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;
  }

  function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(val);
  }
});
