import ThemeToggle from "./ThemeToggle.jsx";

export default function AppTopBar({ title = "InheritableAccount", children, actions }) {
  return (
    <div className="app-header">
      <div>
        <h1>{title}</h1>
        {children}
      </div>
      <div className="app-header-actions">
        <ThemeToggle />
        {actions}
      </div>
    </div>
  );
}