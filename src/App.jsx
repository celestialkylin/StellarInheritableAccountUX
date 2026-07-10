import AppShell from "./app/AppShell.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import "./App.css";

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}