import { useLayoutEffect, useRef, useState } from "react";
import AppTopBar from "../components/AppTopBar.jsx";
import InfoTab from "../tabs/InfoTab.jsx";
import OperationsTab from "../tabs/OperationsTab.jsx";
import SigningTab from "../tabs/SigningTab.jsx";
import CandidatesTab from "../tabs/CandidatesTab.jsx";
import NotesTab from "../tabs/NotesTab.jsx";

const TABS = [
  { id: "info", label: "Info" },
  { id: "ops", label: "Operations" },
  { id: "signing", label: "Signing" },
  { id: "candidates", label: "Candidates" },
  { id: "notes", label: "Notes" },
];

export default function MainTabs({ publicKey, config, onLogout }) {
  const [active, setActive] = useState("info");
  const [mountedTabs, setMountedTabs] = useState(() => new Set(["info"]));
  const pageScrollRef = useRef(null);
  const scrollTopsRef = useRef({});

  function saveScrollTop(tabId) {
    const el = pageScrollRef.current;
    if (el) scrollTopsRef.current[tabId] = el.scrollTop;
  }

  function handleScroll() {
    saveScrollTop(active);
  }

  function selectTab(id) {
    saveScrollTop(active);
    setActive(id);
    setMountedTabs((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  useLayoutEffect(() => {
    const el = pageScrollRef.current;
    if (!el) return;
    el.scrollTop = scrollTopsRef.current[active] ?? 0;
  }, [active]);

  return (
    <div className="app-shell app-shell--tabs">
      <div className="page-scroll" ref={pageScrollRef} onScroll={handleScroll}>
        <div className="page-scroll-inner">
          <AppTopBar
            actions={
              <button type="button" className="secondary" onClick={onLogout}>Lock</button>
            }
          >
            <p className="meta">
              <span className="badge admin">Admin</span>{" "}
              {publicKey.slice(0, 8)}…{publicKey.slice(-6)}
            </p>
          </AppTopBar>

          <p className="meta mb-1">
            Contract: {config.inheritableAccountContractId}
          </p>

          <nav className="tabs-rail" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab-btn ${active === t.id ? "active" : ""}`}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="main-content">
            {mountedTabs.has("info") && (
              <div className="tab-panel" hidden={active !== "info"}>
                <InfoTab
                  publicKey={publicKey}
                  isActive={active === "info"}
                  onGoToCandidates={() => selectTab("candidates")}
                />
              </div>
            )}
            {mountedTabs.has("ops") && (
              <div className="tab-panel" hidden={active !== "ops"}>
                <OperationsTab publicKey={publicKey} />
              </div>
            )}
            {mountedTabs.has("signing") && (
              <div className="tab-panel" hidden={active !== "signing"}>
                <SigningTab publicKey={publicKey} />
              </div>
            )}
            {mountedTabs.has("candidates") && (
              <div className="tab-panel" hidden={active !== "candidates"}>
                <CandidatesTab publicKey={publicKey} isActive={active === "candidates"} />
              </div>
            )}
            {mountedTabs.has("notes") && (
              <div className="tab-panel" hidden={active !== "notes"}>
                <NotesTab publicKey={publicKey} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
