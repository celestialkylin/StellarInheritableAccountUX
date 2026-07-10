import { useTheme } from "../context/ThemeContext.jsx";

export default function ThemeToggle({ className = "" }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`theme-toggle ${className}`.trim()} role="group" aria-label="Color theme">
      <button
        type="button"
        className={`theme-toggle-btn ${theme === "dark" ? "active" : ""}`}
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
      >
        Dark
      </button>
      <button
        type="button"
        className={`theme-toggle-btn ${theme === "light" ? "active" : ""}`}
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
      >
        Light
      </button>
    </div>
  );
}