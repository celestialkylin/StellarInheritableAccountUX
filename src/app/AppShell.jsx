import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AppTopBar from "../components/AppTopBar.jsx";
import RestoreConfirmModal from "../components/RestoreConfirmModal.jsx";
import UnlockPage from "./UnlockPage.jsx";
import MainTabs from "./MainTabs.jsx";
import { loadConfig, resolveScContent } from "../services/config.js";
import { initStellarContext, resetContext } from "../services/stellar/context.js";
import { setRestoreConfirmHandler } from "../services/stellar/restoreGate.js";
import { clearAllCaches } from "../services/cache.js";
import { clearDecimalsCache } from "../services/stellar/sep41.js";
import { clearSession } from "../services/session.js";

export default function AppShell() {
  const [config, setConfig] = useState(null);
  const [scContent, setScContent] = useState(null);
  const [scSource, setScSource] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [booting, setBooting] = useState(true);
  /** @type {[object | null, function]} restore confirm payload (no resolve in state) */
  const [restoreInfo, setRestoreInfo] = useState(null);
  const restoreResolveRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await loadConfig();
        setConfig(cfg);
        initStellarContext(cfg);
        const { content, source } = await resolveScContent(cfg);
        setScContent(content);
        setScSource(source);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    setRestoreConfirmHandler(
      (info) =>
        new Promise((resolve) => {
          restoreResolveRef.current = resolve;
          setRestoreInfo(info);
        }),
    );
    return () => {
      setRestoreConfirmHandler(null);
      restoreResolveRef.current = null;
    };
  }, []);

  function handleRestoreDone(ok) {
    const resolve = restoreResolveRef.current;
    restoreResolveRef.current = null;
    setRestoreInfo(null);
    resolve?.(ok);
  }

  async function handleLogout() {
    clearSession();
    await invoke("clear_session");
    clearAllCaches();
    clearDecimalsCache();
    resetContext();
    setSession(null);
    if (config) initStellarContext(config);
  }

  const restoreModal = restoreInfo ? (
    <RestoreConfirmModal info={restoreInfo} onDone={handleRestoreDone} />
  ) : null;

  if (booting) {
    return (
      <div className="app-shell">
        <AppTopBar />
        <p>Loading…</p>
        {restoreModal}
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell">
        <AppTopBar />
        <div className="error">{error}</div>
        {restoreModal}
      </div>
    );
  }

  if (session?.role === "admin") {
    return (
      <>
        <MainTabs
          publicKey={session.publicKey}
          config={config}
          onLogout={handleLogout}
        />
        {restoreModal}
      </>
    );
  }

  return (
    <>
      <UnlockPage
        config={config}
        scContent={scContent}
        scSource={scSource}
        onScResolved={(content) => {
          setScContent(content);
          setScSource("sc_enc");
        }}
        onUnlocked={(s) => setSession(s)}
      />
      {restoreModal}
    </>
  );
}