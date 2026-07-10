import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { applyTheme, getStoredTheme } from "../services/theme.js";

/** @typedef {import("../services/theme.js").Theme} Theme */

/** @type {React.Context<{ theme: Theme, setTheme: (theme: Theme) => void, toggleTheme: () => void } | null>} */
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeState,
      toggleTheme: () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}