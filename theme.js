/**
 * DataPrime Shared Theme Manager
 *
 * Manages dark/light theme modes across the popup and dashboard.
 * Defaults to the OS preference if no explicit user choice is saved.
 * Persists the user's preference in chrome.storage.local.
 */

/* eslint-disable no-unused-vars */
/* exported initTheme, setTheme, getThemeMode, nextThemeMode */

const STORAGE_KEY = "dataprime_theme";
const VALID_MODES = ["light", "dark"];

/**
 * Media query list for detecting OS-level color scheme preference.
 * @type {MediaQueryList}
 */
const prefersDarkMQ = window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Applies the visual theme to the document root element.
 *
 * @param {string} mode - "light" or "dark"
 */
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
}

/**
 * Initializes the theme system on page load.
 */
function initTheme() {
  const defaultMode = prefersDarkMQ.matches ? "dark" : "light";
  applyTheme(defaultMode);

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && VALID_MODES.includes(saved)) {
        applyTheme(saved);
      }
    });

    // Listen for cross-context theme changes (e.g. popup -> dashboard)
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "local" && changes[STORAGE_KEY]) {
        const newMode = changes[STORAGE_KEY].newValue;
        if (newMode && VALID_MODES.includes(newMode)) {
          applyTheme(newMode);
          window.dispatchEvent(
            new CustomEvent("themeChanged", { detail: newMode }),
          );
        }
      }
    });
  }

  // Live-update when OS preference changes IF no explicit override is saved
  prefersDarkMQ.addEventListener("change", (e) => {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const saved = result[STORAGE_KEY];
        if (!saved || !VALID_MODES.includes(saved)) {
          applyTheme(e.matches ? "dark" : "light");
        }
      });
    } else {
      applyTheme(e.matches ? "dark" : "light");
    }
  });
}

/**
 * Sets the theme mode, persists it, and applies it immediately.
 *
 * @param {string} mode - "light" or "dark"
 */
function setTheme(mode) {
  if (!VALID_MODES.includes(mode)) return;
  applyTheme(mode);
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [STORAGE_KEY]: mode });
  }
}

/**
 * Returns the currently active theme mode preference.
 *
 * @param {function} callback - Called with the mode string ("light" or "dark").
 */
function getThemeMode(callback) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && VALID_MODES.includes(saved)) {
        callback(saved);
      } else {
        callback(prefersDarkMQ.matches ? "dark" : "light");
      }
    });
  } else {
    callback(prefersDarkMQ.matches ? "dark" : "light");
  }
}

/**
 * Toggles to the other theme mode.
 *
 * @param {string} current - The current mode.
 * @returns {string} The toggled mode.
 */
function nextThemeMode(current) {
  return current === "dark" ? "light" : "dark";
}

// Initialize theme immediately upon script execution (prevents FOUC)
initTheme();
