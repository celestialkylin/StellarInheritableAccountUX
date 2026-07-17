import { useCallback, useEffect, useState } from "react";
import RefreshBar from "../components/RefreshBar.jsx";
import MissingMigrationDataBanner from "../components/MissingMigrationDataBanner.jsx";
import { setCache, useCacheState } from "../services/cache.js";
import {
  addCandidateWithMigration,
  candidatesMissingMigrationData,
  syncCandidateMigrationKeys,
} from "../services/adminSuccession.js";
import { fetchCandidatesData } from "../services/stellar/candidatesList.js";
import {
  removeCandidate,
  updateCandidate,
} from "../services/stellar/candidates.js";
import { formatDuration, SECONDS_PER_YEAR } from "../utils/formatDuration.js";

const DEFAULT_WAITING_TIME = String(SECONDS_PER_YEAR);

export default function CandidatesTab({ publicKey, isActive = true }) {
  const [data, meta] = useCacheState("candidates");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [newAddr, setNewAddr] = useState("");
  const [newWait, setNewWait] = useState(DEFAULT_WAITING_TIME);
  const [editAddr, setEditAddr] = useState("");
  const [editWait, setEditWait] = useState(DEFAULT_WAITING_TIME);

  const loadCandidates = useCallback(async () => {
    const fetched = await fetchCandidatesData();
    setCache("candidates", fetched);
    return fetched;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await loadCandidates();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [loadCandidates]);

  // First open (or after invalidate): load once. Switching tabs while loaded does not re-fetch.
  useEffect(() => {
    if (isActive && !meta.loaded) refresh();
  }, [isActive, meta.loaded, refresh]);

  async function runAction(action, successMessage) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await action();
      await loadCandidates();
      setSuccess(successMessage || "Updated.");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const showMissingMigrationBanner = candidatesMissingMigrationData(data?.items ?? []);

  return (
    <div>
      <RefreshBar onRefresh={refresh} loading={loading} fetchedAt={meta.fetchedAt} />
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      {showMissingMigrationBanner && (
        <MissingMigrationDataBanner variant="candidates" />
      )}

      <div className="card">
        <h3>Add Candidate</h3>
        <label>Candidate Address (G…)</label>
        <input value={newAddr} onChange={(e) => setNewAddr(e.target.value)} placeholder="G…" />
        <label>Waiting Time (seconds)</label>
        <input value={newWait} onChange={(e) => setNewWait(e.target.value)} type="number" min="1" />
        <p className="meta">
          A PRE re-encryption key (admin → candidate) is generated and stored with the candidate in one transaction.
        </p>
        <button
          type="button"
          disabled={loading || !newAddr.trim()}
          onClick={() => runAction(async () => {
            await addCandidateWithMigration(
              publicKey,
              newAddr.trim(),
              Number(newWait),
            );
            setNewAddr("");
          }, "Candidate added.")}
        >
          Add Candidate
        </button>
      </div>

      <div className="card">
        <h3>Update Candidate</h3>
        <label>Candidate</label>
        <select
          value={editAddr}
          onChange={(e) => {
            const addr = e.target.value;
            setEditAddr(addr);
            if (!addr) {
              setEditWait(DEFAULT_WAITING_TIME);
              return;
            }
            const item = data?.items?.find((c) => c.address === addr);
            if (item != null) setEditWait(String(item.waitingTime));
          }}
        >
          <option value="">— select —</option>
          {data?.items?.map((c) => (
            <option key={c.address} value={c.address}>{c.address}</option>
          ))}
        </select>
        <label>New Waiting Time (seconds)</label>
        <input value={editWait} onChange={(e) => setEditWait(e.target.value)} type="number" min="1" />
        <button
          type="button"
          disabled={loading || !editAddr}
          onClick={() =>
            runAction(
              () => updateCandidate(publicKey, editAddr, Number(editWait)),
              "Waiting time updated.",
            )
          }
        >
          Update Waiting Time
        </button>
      </div>

      <div className="card">
        <h3>Re-sync PRE Keys</h3>
        <p className="meta">
          New candidates receive a re-encryption key automatically when added. After admin
          claim or transfer, the contract clears remaining candidates&apos; migration_data so
          the new admin can review who should stay eligible. Remove or adjust heirs first if
          needed, then use this to publish fresh PRE keys for everyone still on the list
          (also useful if keys are corrupted or missing).
        </p>
        <button
          type="button"
          disabled={loading || !data?.items?.length}
          onClick={() =>
            runAction(
              () => syncCandidateMigrationKeys(),
              "Rewrote PRE keys. List refreshed.",
            )
          }
        >
          Re-sync All PRE Keys
        </button>
      </div>

      <div className="card">
        <h3>Registered Candidates</h3>
        {!data?.items?.length ? (
          <p className="meta">No candidates.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Address</th><th>Waiting</th><th>To Claim</th><th>PRE</th><th></th></tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.address}>
                  <td>{c.address}</td>
                  <td>{formatDuration(c.waitingTime)}</td>
                  <td>{c.remaining <= 0 ? "Ready" : formatDuration(c.remaining)}</td>
                  <td>{c.hasPreKey ? <span className="badge admin">Set</span> : <span className="meta">—</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      disabled={loading}
                      onClick={() =>
                        runAction(
                          () => removeCandidate(publicKey, c.address),
                          "Candidate removed.",
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
