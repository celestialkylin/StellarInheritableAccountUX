import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import AppTopBar from "../components/AppTopBar.jsx";
import ScTxtImporter from "../components/ScTxtImporter.jsx";
import { exportScContent } from "../services/config.js";
import { decryptSc } from "../services/decrypt.js";
import { unlockSession, clearSession } from "../services/session.js";
import {
  formatMigrationResult,
  migrateNotesAfterAdminChange,
  readAdminMigrationState,
} from "../services/adminSuccession.js";
import { migrationInProgress } from "../services/crypto/migrationStatus.js";
import {
  canClaim,
  claimAdmin,
  getAdmin,
  getCandidate,
  getInactiveTime,
} from "../services/stellar/inheritable.js";

function formatDuration(seconds) {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function UnlockPage({ config, onUnlocked, scContent, scSource, onScResolved }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState(null);
  const [publicKey, setPublicKey] = useState("");
  const [candidateInfo, setCandidateInfo] = useState(null);
  const [inactiveTime, setInactiveTime] = useState(0);
  const [claimable, setClaimable] = useState(false);
  const [claimResult, setClaimResult] = useState("");
  const [replacingSc, setReplacingSc] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const countdownBase = useRef({ inactive: 0, startedAt: Date.now() });

  useEffect(() => {
    if (role !== "candidate" || !candidateInfo) return;
    countdownBase.current = { inactive: Number(inactiveTime), startedAt: Date.now() };
    const timer = setInterval(() => {
      const { inactive, startedAt } = countdownBase.current;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const current = inactive + elapsed;
      setInactiveTime(current);
      setClaimable(current >= Number(candidateInfo.waiting_time));
    }, 1000);
    return () => clearInterval(timer);
  }, [role, candidateInfo]);

  function handleUnlock(e) {
    e.preventDefault();
    if (!scContent) {
      setError("sc.txt content is required");
      return;
    }
    flushSync(() => {
      setLoading(true);
      setError("");
      setRole(null);
    });
    void performUnlock();
  }

  async function performUnlock() {
    try {
      const secret = await decryptSc(scContent, password);
      const pk = unlockSession(secret);
      await invoke("unlock_keypair", { secret: secret.trim() });

      const admin = await getAdmin();
      if (admin === pk) {
        const migrationMessage = await completePendingMigration(pk);
        onUnlocked({ role: "admin", publicKey: pk, migrationMessage });
        return;
      }

      try {
        const cand = await getCandidate(pk);
        const inactive = await getInactiveTime();
        const canClaimNow = await canClaim(pk);
        setPublicKey(pk);
        setCandidateInfo(cand);
        setInactiveTime(inactive);
        countdownBase.current = { inactive: Number(inactive), startedAt: Date.now() };
        setClaimable(canClaimNow);
        setRole("candidate");
      } catch {
        clearSession();
        await invoke("clear_session");
        setError(
          `This key is neither admin nor a registered candidate. Public key: ${pk}`,
        );
      }
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg || "Decryption failed. Check password.");
    } finally {
      setLoading(false);
    }
  }

  async function completePendingMigration(pk) {
    const status = await readAdminMigrationState();
    if (!migrationInProgress(status)) {
      return "";
    }
    const result = await migrateNotesAfterAdminChange(pk);
    if (result.skipped) return "";
    return formatMigrationResult(result);
  }

  async function handleClaim() {
    flushSync(() => setLoading(true));
    setClaimResult("");
    setError("");
    try {
      await claimAdmin(publicKey);
      const migrationMessage = await completePendingMigration(publicKey);
      const base = "Claim successful! You are now admin.";
      setClaimResult(migrationMessage ? `${base} ${migrationMessage}` : base);
      onUnlocked({ role: "admin", publicKey, migrationMessage });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleScReplaced(content) {
    setReplacingSc(false);
    setPassword("");
    setError("");
    setExportMessage("");
    onScResolved(content);
  }

  async function handleExportSc() {
    if (!scContent) {
      setError("sc.enc content is required");
      return;
    }
    setError("");
    setExportMessage("");
    try {
      const path = await exportScContent(scContent);
      if (path) {
        setExportMessage(`Exported ciphertext to ${path}`);
      }
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  if (!scContent || replacingSc) {
    return (
      <div className="app-shell">
        <AppTopBar />
        <ScTxtImporter
          mode={replacingSc ? "replace" : "initial"}
          onImported={handleScReplaced}
        />
        {replacingSc && (
          <button type="button" className="secondary" onClick={() => setReplacingSc(false)}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (role === "candidate") {
    const remaining = Math.max(0, Number(candidateInfo.waiting_time) - Number(inactiveTime));
    return (
      <div className="app-shell">
        <AppTopBar />
        <div className="card">
          <span className="badge candidate">Candidate</span>
          <h2>Successor Information</h2>
          <p><strong>Your key:</strong> {publicKey}</p>
          <p><strong>Required waiting time:</strong> {formatDuration(candidateInfo.waiting_time)}</p>
          <p><strong>Current inactive time:</strong> {formatDuration(inactiveTime)}</p>
          <p><strong>Time until claim:</strong> {remaining <= 0 ? "Ready now" : formatDuration(remaining)}</p>
          {claimable ? (
            <button type="button" onClick={handleClaim} disabled={loading}>
              {loading ? "Claiming…" : "Claim Admin"}
            </button>
          ) : (
            <p className="meta">Waiting for admin inactivity threshold.</p>
          )}
          {claimResult && <div className="success">{claimResult}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppTopBar>
        <p className="meta">Contract: {config.inheritableAccountContractId}</p>
      </AppTopBar>
      {scSource && (
        <p className="meta">
          Secret source: {scSource === "sc_enc" ? "sc.enc (app data)" : scSource === "config_file" ? "config scTxtPath" : "sc.txt"}
        </p>
      )}
      <div className="card">
        <h2>Unlock</h2>
        <form onSubmit={handleUnlock}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to decrypt sc.txt"
            autoComplete="off"
            required
          />
          <div className="row-actions">
            <button type="submit" disabled={loading}>
              {loading ? "Unlocking…" : "Unlock"}
            </button>
            {scSource === "sc_enc" && (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={loading}
                  onClick={() => setReplacingSc(true)}
                >
                  Replace sc.enc
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={loading}
                  onClick={() => void handleExportSc()}
                >
                  Export sc.enc
                </button>
              </>
            )}
          </div>
        </form>
        {exportMessage && <div className="success">{exportMessage}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}