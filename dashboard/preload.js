/**
 * DataPrime Dashboard — Preload State Restore
 *
 * Runs before the DOM is fully parsed to apply persisted theme and sidebar
 * state, preventing a flash of wrong theme or sidebar on page load.
 */
(function () {
  // Set OS-default theme immediately (sync) to prevent white flash
  document.documentElement.dataset.theme = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches
    ? "dark"
    : "light";

  // Override with persisted preferences
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(
      ["sidebarCollapsed", "dataprime_theme"],
      function (result) {
        if (result.sidebarCollapsed) {
          document.documentElement.classList.add("sidebar-collapsed");
        }
        if (result.dataprime_theme) {
          document.documentElement.dataset.theme = result.dataprime_theme;
        }
      },
    );
  }
})();
