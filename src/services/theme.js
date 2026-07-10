const THEME_STORAGE_KEY = "inheritable-account-theme";

export const THEMES = /** @type {const} */ (["dark", "light"]);

/** @typedef {(typeof THEMES)[number]} Theme */

/** @returns {Theme} */
export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return "dark";
}

/** @param {Theme} theme */
export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function initTheme() {
  applyTheme(getStoredTheme());
}