import { useEffect, useRef, useState } from "react";

/**
 * Modal for approving a Soroban restoreFootprint fee.
 *
 * @param {object} props
 * @param {object} props.info - { feePayer, minResourceFee, feeXlm, performRestore }
 * @param {(ok: boolean) => void} props.onDone - called with true after successful restore, false on cancel
 */
export default function RestoreConfirmModal({ info, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmRef = useRef(null);
  const settled = useRef(false);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        finish(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  function finish(ok) {
    if (settled.current) return;
    settled.current = true;
    onDone(ok);
  }

  async function handleConfirm() {
    if (busy || settled.current) return;
    setBusy(true);
    setError("");
    try {
      if (typeof info.performRestore !== "function") {
        throw new Error("Restore action is not available");
      }
      await info.performRestore();
      finish(true);
    } catch (e) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  }

  function handleCancel() {
    if (busy) return;
    finish(false);
  }

  const feeXlm = info.feeXlm ?? "—";
  const stroops = info.minResourceFee ?? "—";
  const feePayer = info.feePayer ?? "—";

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="restore-modal-title" className="modal-title">
          Restore archived contract state
        </h2>
        <p className="modal-body">
          Some ledger entries needed for this action have expired on Stellar and
          must be restored before the operation can continue. Restoring writes
          those entries back to live storage and charges a network fee.
        </p>
        <dl className="modal-facts">
          <div className="modal-fact">
            <dt>Fee payer</dt>
            <dd className="mono">{feePayer}</dd>
          </div>
          <div className="modal-fact">
            <dt>Estimated fee</dt>
            <dd>
              <strong>{feeXlm} XLM</strong>
              <span className="meta"> ({stroops} stroops min resource fee)</span>
            </dd>
          </div>
        </dl>
        <p className="meta modal-note">
          This is the minimum resource fee from simulation. After a successful
          restore, the original operation will continue automatically.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? "Restoring…" : "Restore and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
