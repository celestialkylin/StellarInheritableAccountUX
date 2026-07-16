import { useEffect, useMemo, useState } from "react";
import {
  copyTextToClipboard,
  inspectTxXdr,
  signAuthTxXdr,
  signEnvelopeTxXdr,
  simulateTxXdr,
  submitTxXdr,
} from "../services/stellar/signingWorkbench.js";

function formatTimebounds(tb) {
  if (!tb) return "—";
  const min = Number(tb.minTime);
  const max = Number(tb.maxTime);
  const fmt = (n) => {
    if (!n) return "0";
    try {
      return new Date(n * 1000).toLocaleString();
    } catch {
      return String(n);
    }
  };
  return `${fmt(min)} → ${fmt(max)} (unix ${tb.minTime}…${tb.maxTime})`;
}

export default function SigningTab({ publicKey }) {
  const [xdr, setXdr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copyFlash, setCopyFlash] = useState(false);

  const info = useMemo(() => {
    if (!xdr.trim()) {
      return null;
    }
    return inspectTxXdr(xdr);
  }, [xdr]);

  useEffect(() => {
    if (!copyFlash) return undefined;
    const t = setTimeout(() => setCopyFlash(false), 1500);
    return () => clearTimeout(t);
  }, [copyFlash]);

  async function run(action, okMessage) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = await action();
      if (typeof next === "string") {
        setXdr(next);
        if (okMessage) setSuccess(okMessage);
      } else if (next && typeof next === "object") {
        // simulate / re-sim: { xdr, returnValueText }; submit: { hash, returnValueText, … }
        if (typeof next.xdr === "string") {
          setXdr(next.xdr);
        }
        const base = typeof okMessage === "function" ? okMessage(next) : okMessage;
        const rv =
          next.returnValueText != null
            ? `\nReturn value:\n${next.returnValueText}`
            : "";
        if (base || rv) setSuccess(`${base || ""}${rv}`.trim());
      } else if (okMessage) {
        setSuccess(typeof okMessage === "function" ? okMessage(next) : okMessage);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!xdr.trim()) return;
    try {
      await copyTextToClipboard(xdr.trim());
      setCopyFlash(true);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Signing</h3>
        <p className="meta">
          Paste an external transaction XDR. The buttons below follow the next required step
          based on the current envelope (simulate, sign auth, sign envelope, or submit).
        </p>

        <label htmlFor="signing-xdr">Transaction XDR</label>
        <div className="xdr-input-wrap">
          <textarea
            id="signing-xdr"
            className="xdr-textarea"
            rows={10}
            value={xdr}
            onChange={(e) => {
              setXdr(e.target.value);
              setError("");
              setSuccess("");
            }}
            placeholder="AAAA… (base64 transaction envelope XDR)"
            spellCheck={false}
          />
          <button
            type="button"
            className="icon-btn xdr-copy-btn"
            title="Copy XDR to clipboard"
            disabled={!xdr.trim() || busy}
            onClick={handleCopy}
            aria-label="Copy XDR"
          >
            {copyFlash ? "✓" : "⧉"}
          </button>
        </div>

        {info?.ok && (
          <p className="meta next-step-hint">
            Next step: <strong>{info.nextStepLabel}</strong>
            {info.phase === "needs_simulate" && " — fill footprint & auth via RPC simulate"}
            {info.phase === "needs_sign_auth" && " — wrap CAP-71 and sign admin delegate"}
            {info.phase === "needs_sign_envelope" && " — sign the transaction envelope with admin"}
            {info.phase === "ready_submit" && " — broadcast to the network"}
          </p>
        )}

        <div className="row-actions signing-actions">
          {info?.showSimulate && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => simulateTxXdr(xdr), "Simulated — XDR updated.")
              }
            >
              {busy ? "Working…" : "Simulate"}
            </button>
          )}
          {info?.showSignAuth && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => signAuthTxXdr(xdr),
                  "Auth signed (wrap + admin delegate) — XDR updated. Simulate was not run.",
                )
              }
            >
              {busy ? "Working…" : info.signAuthLabel}
            </button>
          )}
          {info?.showSignEnvelope && (
            <button
              type="button"
              className={info.showSimulate || info.showSignAuth ? "secondary" : undefined}
              disabled={busy}
              onClick={() =>
                run(() => signEnvelopeTxXdr(xdr), "Envelope signed by admin — XDR updated.")
              }
            >
              {busy ? "Working…" : "Sign Envelope"}
            </button>
          )}
          {info?.showSubmit && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => submitTxXdr(xdr),
                  (result) =>
                    result.status === "SUCCESS"
                      ? `Submitted successfully.\nHash: ${result.hash}`
                      : `Submitted (${result.status}).\nHash: ${result.hash}${
                          result.message ? `\n${result.message}` : ""
                        }`,
                )
              }
            >
              {busy ? "Working…" : "Submit to Network"}
            </button>
          )}
          {info?.showReSimulate && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              title="Refresh footprint/auth via RPC (optional)"
              onClick={() =>
                run(() => simulateTxXdr(xdr), "Re-simulated — XDR updated.")
              }
            >
              Re-simulate
            </button>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {success && <div className="success" style={{ whiteSpace: "pre-wrap" }}>{success}</div>}
      </div>

      <div className="card signing-status">
        <h3>Transaction &amp; Signature Status</h3>
        {!xdr.trim() && <p className="meta">Paste an XDR to inspect it.</p>}
        {xdr.trim() && info && !info.ok && (
          <div className="error">{info.error}</div>
        )}
        {xdr.trim() && info?.ok && (
          <div className="status-grid">
            <div className="status-row">
              <span className="status-label">Next step</span>
              <span className="status-value"><strong>{info.nextStepLabel}</strong></span>
            </div>
            <div className="status-row">
              <span className="status-label">Source</span>
              <span className="status-value mono">{info.source}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Fee / Seq</span>
              <span className="status-value mono">
                {info.fee} / {info.sequence}
              </span>
            </div>
            <div className="status-row">
              <span className="status-label">Timebounds</span>
              <span className="status-value">{formatTimebounds(info.timebounds)}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Simulated</span>
              <span className="status-value">
                {info.isContractInvoke
                  ? (info.simulated ? "yes (has Soroban resources)" : "no (raw envelope)")
                  : "n/a"}
              </span>
            </div>
            <div className="status-row">
              <span className="status-label">Operation</span>
              <span className="status-value">
                {info.isContractInvoke
                  ? `Contract invoke${info.method ? `: ${info.method}` : ""}`
                  : info.opType || "—"}
              </span>
            </div>
            {info.isContractInvoke && (
              <div className="status-row">
                <span className="status-label">Contract</span>
                <span className="status-value mono">{info.contractId || "—"}</span>
              </div>
            )}
            <div className="status-row">
              <span className="status-label">Session admin</span>
              <span className="status-value mono">{publicKey || info.adminAddress || "—"}</span>
            </div>

            <h4 className="status-section-title">Auth entries</h4>
            {!info.isContractInvoke ? (
              <p className="meta">Not a contract invoke — no Soroban auth.</p>
            ) : !info.simulated ? (
              <p className="meta">
                No simulation yet — run <strong>Simulate</strong> to populate auth and resources.
              </p>
            ) : info.authSubjects.length === 0 ? (
              <p className="meta">
                Simulated with no auth subjects (read-only or invoker-only auth).
              </p>
            ) : (
              <ul className="auth-list">
                {info.authSubjects.map((s) => (
                  <li key={`${s.entryIndex}:${s.address}`}>
                    <span className={`badge ${s.signed ? "waiting" : "candidate"}`}>
                      {s.signed ? "signed" : "unsigned"}
                    </span>{" "}
                    {s.role && <strong>{s.role} </strong>}
                    <span className="mono">{s.address}</span>
                  </li>
                ))}
              </ul>
            )}
            {info.isContractInvoke && info.simulated && (
              <p className="meta">
                Auth complete: {info.fullyAuthSigned ? "yes" : "no"}
                {info.wrapInfo?.cRootFound && (
                  <>
                    {" · "}CAP-71 wrap:{" "}
                    {info.wrapInfo.cRootWithDelegates ? "yes (WithDelegates)" : "no (plain Address)"}
                  </>
                )}
              </p>
            )}

            <h4 className="status-section-title">Envelope signatures</h4>
            {info.envelopeSigners.length === 0 ? (
              <p className="meta">No envelope signatures yet.</p>
            ) : (
              <ul className="auth-list">
                {info.envelopeSigners.map((s, i) => (
                  <li key={`${s.hint}-${i}`}>
                    <span className={`badge ${s.matchesAdmin ? "admin" : "waiting"}`}>
                      {s.matchesAdmin ? "admin" : "signer"}
                    </span>{" "}
                    hint <span className="mono">{s.hint}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="meta">
              Admin envelope sig: {info.hasAdminEnvelopeSig ? "yes" : "no"}
              {" · "}
              Ready to submit: {info.phase === "ready_submit" ? "yes" : "no"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
